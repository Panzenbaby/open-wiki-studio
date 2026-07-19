// Filesystem operations on the workspace folders, returned as Result<T>.
//
// Concept reading (wiki .md: conceptId derivation, frontmatter metadata) is
// delegated to ConceptStore. This module keeps the non-concern parts:
//   - listFolder: listing input/wiki as FileNode (with size — a broader
//     shape than concepts, any file type). The OKF archive lives under
//     wiki/archive/ and shows up in the wiki listing.
//   - getPreview: single-file preview — wiki .md delegates to the store; text
//     and binary stay here
//   - addInputFiles / revealInFileManager: input-folder writes + OS integration
import { copyFile, lstat, mkdir, open, readFile, readdir, stat } from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { shell } from "electron";
import { ConceptStore } from "./concept-store.ts";
import { ok, err, errorMessage } from "../shared/result.ts";
import { mainT } from "./i18n.ts";
import type {
  AddFilesSummary,
  ConceptInfo,
  FileNode,
  FilePreview,
  Folder,
  Result,
} from "../shared/ipc-types.ts";

/** Resolve a `Folder` to its physical base directory under `workspace`.
 *
 *  `input` and `wiki` are top-level siblings (`workspace/input`,
 *  `workspace/wiki`). The OKF archive lives under `workspace/wiki/archive/`
 *  (since pi-okf-wiki 0.2.0) and is browsed as the `archive/` subdirectory of
 *  the wiki folder — it has no `Folder` entry of its own. Centralizing the
 *  translation here means every folder-path resolution in the app agrees on
 *  where each folder lives. */
export function workspaceDir(workspace: string, folder: Folder): string {
  return join(workspace, folder);
}

/**
 * Resolve `relativePath` under `baseDir` and guard against traversal. Returns
 * null when the resolved path escapes `baseDir` or `relativePath` is absolute.
 * The renderer is trusted, but IPC handlers are reachable from any renderer
 * frame, so we validate defensively.
 */
function safeResolve(baseDir: string, relativePath: string): string | null {
  if (relativePath === "" || isAbsolute(relativePath)) return null;
  const resolved = resolve(baseDir, relativePath);
  const rel = relative(baseDir, resolved);
  if (rel.startsWith(`..${sep}`) || rel === `..`) return null;
  return resolved;
}

/** Is `relativePath` a wiki markdown concept (starts with `wiki/` and ends
 *  with `.md`, but NOT under the `wiki/archive/` subtree)? The store handles
 *  only concept files; everything else (input/text/binary, and ALL archive
 *  originals — `.md.orig` by convention, but defensively any file under
 *  `wiki/archive/`, including a stray `.md`) is read directly here. The
 *  archive-subtree guard mirrors the ConceptStore walk's skip so a misplaced
 *  `.md` inside the archive can never be treated as a concept. */
function isWikiMarkdown(relativePath: string): boolean {
  if (relativePath.startsWith("wiki/archive/")) return false;
  return relativePath.startsWith("wiki/") && relativePath.endsWith(".md");
}

async function walk(dir: string, root: string): Promise<FileNode[]> {
  const out: FileNode[] = [];
  let entries: Dirent[];
  try {
    entries = await (await import("node:fs/promises")).readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(abs, root)));
    } else if (entry.isFile()) {
      const rel = relative(root, abs).split(sep).join("/");
      const stats = await stat(abs).catch(() => null);
      out.push({
        relativePath: rel,
        name: entry.name,
        isDirectory: false,
        size: stats?.size,
      });
    }
  }
  return out;
}

export async function listFolder(
  workspace: string,
  folder: Folder,
): Promise<Result<readonly FileNode[]>> {
  try {
    const nodes = await walk(workspaceDir(workspace, folder), workspaceDir(workspace, folder));
    return ok(nodes.sort((a, b) => a.relativePath.localeCompare(b.relativePath)));
  } catch (error) {
    return err<readonly FileNode[]>(mainT("error.listFolder", { folder, detail: errorMessage(error) }));
  }
}

export async function getPreview(
  workspace: string,
  relativePath: string,
): Promise<Result<FilePreview>> {
  // The renderer sends the selection key (`${folder}/${rel}`). The OKF
  // archive lives at `wiki/archive/<rel>` and is browsed as a subdirectory of
  // the wiki folder. Detect that prefix and confine archive previews to the
  // archive base (`workspace/wiki/archive/`) specifically — a
  // `wiki/archive/../../etc/passwd` (or `wiki/archive/../secret.md`)
  // selection can never read a file outside the archive, even if that file
  // exists in the workspace. The prefix check is case-insensitive so a
  // `wiki/Archive/…` link (e.g. from LLM output on a case-insensitive FS like
  // macOS APFS / Windows NTFS) is still confined to the archive base rather
  // than falling through to the looser workspace-root resolution. Other paths
  // keep resolving against the workspace root as before. `relativePath` itself
  // is used for all extension/kind checks below — its suffix is the same as
  // the physical file's.
  const ARCHIVE_PREFIX = "wiki/archive/";
  const isArchive = relativePath.toLowerCase().startsWith(ARCHIVE_PREFIX);
  const base = isArchive ? join(workspace, "wiki", "archive") : workspace;
  const stripped = isArchive ? relativePath.slice(ARCHIVE_PREFIX.length) : relativePath;
  const absolute = safeResolve(base, stripped);
  if (!absolute) {
    return err<FilePreview>(mainT("error.invalidPath", { path: relativePath }), { path: relativePath });
  }

  // Wiki markdown: delegate concept reading (conceptId, frontmatter metadata,
  // body) to the store. Reserved files (index/log) come back with kind !==
  // "concept" and no ConceptInfo, matching the previous RESERVED behaviour.
  // Archive originals live under `wiki/archive/` so `isWikiMarkdown` excludes
  // them (prefix guard) — they are archived originals, not concepts, and must
  // NOT get concept metadata. By convention archive markdown is stored as
  // `.md.orig`; the prefix guard is defensive so even a stray `.md` placed
  // under the archive is never treated as a concept.
  if (isWikiMarkdown(relativePath)) {
    const store = new ConceptStore(workspace);
    const concept = await store.readConcept(relativePath);
    if (concept) {
      const info: ConceptInfo | undefined =
        concept.kind === "concept"
          ? {
              conceptId: concept.conceptId,
              title: concept.title,
              description: concept.description,
              type: concept.type,
            }
          : undefined;
      return ok({
        relativePath,
        kind: "markdown",
        content: concept.body,
        frontmatter: info,
      });
    }
    // readConcept returned null (file vanished / unreadable) — fall through to a
    // direct read so the error surfaces instead of a silent empty preview.
  }

  // Non-wiki files, non-markdown, or a wiki .md the store could not read: read
  // directly. Non-wiki `.md` (and archived `.md.orig` — the markdown original)
  // is shown as raw markdown WITHOUT concept metadata — input/archive
  // documents are not concepts (archived `.md.orig` bodies are rendered
  // verbatim, including any stored-but-unprocessed frontmatter block; that is
  // the agreed "raw markdown, no metadata" behaviour per ADR 0003). Binary
  // originals (pdf, docx, …) yield garbage on a utf8 read; detect that and
  // return a `binary` placeholder instead.
  try {
    const fd = await open(absolute, "r");
    try {
      const sniff = Buffer.alloc(BINARY_SNIFF_BYTES);
      const { bytesRead } = await fd.read(sniff, 0, BINARY_SNIFF_BYTES, 0);
      if (looksBinary(sniff.subarray(0, bytesRead))) {
        return ok({
          relativePath,
          kind: "binary",
          content: mainT("preview.binaryPlaceholder", { path: relativePath }),
        });
      }
    } finally {
      await fd.close();
    }
    // Sniffed as text — read the full content. For very large text files this
    // still loads everything into memory, but text originals are the common
    // small case; binary originals (the large-PDF risk) were handled above
    // without reading the whole file.
    const content = await readFile(absolute, "utf8");
    const isMarkdown = relativePath.endsWith(".md") || relativePath.endsWith(".md.orig");
    return ok({
      relativePath,
      kind: isMarkdown ? "markdown" : "text",
      content,
    });
  } catch (error) {
    return err<FilePreview>(mainT("error.readFile", { path: relativePath, detail: errorMessage(error) }), {
      path: relativePath,
    });
  }
}

/** Heuristic for "is this file binary?" — the same rule `git` uses: a NUL byte
 *  in the first 8 KB means binary. Archived originals (pdf, docx, png, …) trip
 *  this; text files (incl. `.md.orig`) do not. Limitation: UTF-16 text files
 *  contain NUL bytes in their encoding and would be misclassified as binary —
 *  acceptable here because archive originals are pdf/docx/png, not UTF-16
 *  text. The sniff reads only the first `BINARY_SNIFF_BYTES` from disk (via
 *  `open`+`read`) so a multi-hundred-MB PDF never enters the heap. */
const BINARY_SNIFF_BYTES = 8 * 1024;
function looksBinary(buffer: Buffer): boolean {
  const len = Math.min(buffer.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < len; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

export async function addInputFiles(
  workspace: string,
  filePaths: readonly string[],
): Promise<Result<AddFilesSummary>> {
  const inputDir = workspaceDir(workspace, "input");
  try {
    await mkdir(inputDir, { recursive: true });
  } catch (error) {
    return err<AddFilesSummary>(mainT("error.addInputFiles", { detail: errorMessage(error) }));
  }

  const added: string[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const failed: { path: string; error: string }[] = [];
  const skipReason = mainT("addFiles.skippedExists");

  for (const source of filePaths) {
    // Resolve metadata without following symlinks (6A: symlinks skipped).
    let info: Stats;
    try {
      info = await lstat(source);
    } catch (error) {
      // Cannot even stat the top-level entry — record and continue (3B).
      // Path is the raw source path (not relativized to input/): the entry
      // never reached a destination, so there is no input-relative path. This
      // is the one documented exception to the "relative to input/" rule —
      // see AddFilesSummary.
      failed.push({ path: source, error: errorMessage(error) });
      continue;
    }
    if (info.isSymbolicLink()) {
      skipped.push({ path: source, reason: mainT("addFiles.skippedSymlink") });
      continue;
    }
    if (info.isDirectory()) {
      // Preserve structure: drop of `foo/` lands at `input/foo/<…>` (1A).
      // Summary paths are relative to `input/` so the top folder name shows up.
      const topName = basename(source);
      await copyTree(source, join(inputDir, topName), inputDir, {
        added, skipped, failed, skipReason,
      });
    } else if (info.isFile()) {
      // A loose file: flat into `input/` (no structure to preserve).
      const name = basename(source);
      const dest = join(inputDir, name);
      const rel = relative(inputDir, dest).split(sep).join("/");
      // lstat (not stat) so a broken symlink at dest still counts as "exists"
      // and is skipped rather than overwritten via the dangling link.
      const exists = await lstat(dest).then(() => true).catch(() => false);
      if (exists) {
        skipped.push({ path: rel, reason: skipReason });
        continue;
      }
      try {
        await copyFile(source, dest);
        added.push(rel);
      } catch (error) {
        failed.push({ path: rel, error: errorMessage(error) });
      }
    }
    // Other types (FIFO, socket, device) are silently ignored — only regular
    // files and directories are meaningful input for the ingest.
  }

  return ok({ added, skipped, failed });
}

/** Recursive copy of `srcDir` into `destDir`, preserving the relative tree.
 *  Skips dotfiles, symlinks (6A), and empty subtrees — parent dirs are only
 *  created when a file actually lands below them (7A). Per-file collisions
 *  skip with a reason (2B); per-file errors are recorded and the walk
 *  continues (3B). `root` is the dest root used to compute POSIX relative
 *  paths for the summary. */
async function copyTree(
  srcDir: string,
  destDir: string,
  root: string,
  out: { added: string[]; skipped: { path: string; reason: string }[]; failed: { path: string; error: string }[]; skipReason: string },
): Promise<void> {
  // Guard the destination directory: if a non-directory entry (file or
  // symlink) already occupies `destDir`, no leaf below it can ever land —
  // every per-file `mkdir(dirname(destAbs), {recursive:true})` would fail with
  // a confusing ENOTDIR. Detect once up front and skip the whole subtree.
  const destInfo = await lstat(destDir).then((info) => info).catch(() => null);
  if (destInfo && !destInfo.isDirectory()) {
    const rel = relative(root, destDir).split(sep).join("/");
    out.skipped.push({ path: rel || ".", reason: out.skipReason });
    return;
  }
  let entries: Dirent[];
  try {
    entries = await readdir(srcDir, { withFileTypes: true });
  } catch (error) {
    // Could not read this directory — record against the dest-relative path so
    // the user can locate it in input/, then give up on the subtree.
    const rel = relative(root, destDir).split(sep).join("/");
    out.failed.push({ path: rel || ".", error: errorMessage(error) });
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // dotfiles skipped (4A consistency)
    const srcAbs = join(srcDir, entry.name);
    const destAbs = join(destDir, entry.name);
    if (entry.isSymbolicLink()) {
      const rel = relative(root, destAbs).split(sep).join("/");
      out.skipped.push({ path: rel, reason: mainT("addFiles.skippedSymlink") });
      continue;
    }
    if (entry.isDirectory()) {
      await copyTree(srcAbs, destAbs, root, out);
      continue;
    }
    if (!entry.isFile()) continue; // skip special files (FIFO/socket/device)
    const rel = relative(root, destAbs).split(sep).join("/");
    // lstat so a broken symlink at dest still counts as "exists" and is
    // skipped rather than overwritten through the dangling link.
    const exists = await lstat(destAbs).then(() => true).catch(() => false);
    if (exists) {
      out.skipped.push({ path: rel, reason: out.skipReason });
      continue;
    }
    try {
      // Create only the immediate parent chain needed for this file — empty
      // directories never get materialized (7A).
      await mkdir(dirname(destAbs), { recursive: true });
      await copyFile(srcAbs, destAbs);
      out.added.push(rel);
    } catch (error) {
      out.failed.push({ path: rel, error: errorMessage(error) });
    }
  }
}

/** Reveal a file or folder in the OS file manager.
 * - For a file: highlights & selects it in its parent folder (Finder / Explorer / file manager).
 * - For a directory: opens the folder itself.
 */
export async function revealInFileManager(
  workspace: string,
  folder: Folder,
  relativePath: string,
  isDirectory: boolean,
): Promise<Result<void>> {
  const base = workspaceDir(workspace, folder);
  const absolute = safeResolve(base, relativePath);
  if (!absolute) {
    return err<void>(mainT("error.invalidPath", { path: relativePath }), { path: relativePath });
  }
  try {
    if (isDirectory) {
      const error = await shell.openPath(absolute);
      if (error) {
        return err<void>(mainT("error.openFolder", { detail: errorMessage(error) }), { path: absolute });
      }
      return ok(undefined);
    }
    shell.showItemInFolder(absolute);
    return ok(undefined);
  } catch (error) {
    return err<void>(mainT("error.revealFile", { path: relativePath, detail: errorMessage(error) }), {
      path: absolute,
    });
  }
}