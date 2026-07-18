// Filesystem operations on the workspace folders, returned as Result<T>.
//
// Concept reading (wiki .md: conceptId derivation, frontmatter metadata) is
// delegated to ConceptStore. This module keeps the non-concern parts:
//   - listFolder: listing input/wiki/archive as FileNode (with size — a broader
//     shape than concepts, any file type)
//   - getPreview: single-file preview — wiki .md delegates to the store; text
//     and binary stay here
//   - addInputFiles / revealInFileManager: input-folder writes + OS integration
import { copyFile, lstat, mkdir, readFile, readdir, stat } from "node:fs/promises";
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

function workspaceDir(workspace: string, folder: Folder): string {
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

/** Is `relativePath` a wiki markdown file (starts with `wiki/`)? The store
 *  handles only those; everything else (input/archive/text/binary) is read
 *  directly here. */
function isWikiMarkdown(relativePath: string): boolean {
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
  const absolute = safeResolve(workspace, relativePath);
  if (!absolute) {
    return err<FilePreview>(mainT("error.invalidPath", { path: relativePath }), { path: relativePath });
  }

  // Wiki markdown: delegate concept reading (conceptId, frontmatter metadata,
  // body) to the store. Reserved files (index/log) come back with kind !==
  // "concept" and no ConceptInfo, matching the previous RESERVED behaviour.
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
  // directly. Non-wiki .md is shown as raw markdown (no concept metadata) —
  // input/archive documents are not concepts.
  try {
    const content = await readFile(absolute, "utf8");
    const isMarkdown = relativePath.endsWith(".md");
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