// Filesystem operations on the workspace folders, returned as Result<T>.
//
// Concept reading (wiki .md: conceptId derivation, frontmatter metadata) is
// delegated to ConceptStore. This module keeps the non-concern parts:
//   - listFolder: listing input/wiki/archive as FileNode (with size — a broader
//     shape than concepts, any file type)
//   - getPreview: single-file preview — wiki .md delegates to the store; text
//     and binary stay here
//   - addInputFiles / revealInFileManager: input-folder writes + OS integration
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { shell } from "electron";
import { ConceptStore } from "./concept-store.ts";
import { ok, err, errorMessage } from "../shared/result.ts";
import { mainT } from "./i18n.ts";
import type {
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
  let entries: import("node:fs").Dirent[];
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
): Promise<Result<readonly string[]>> {
  const inputDir = workspaceDir(workspace, "input");
  try {
    await mkdir(inputDir, { recursive: true });
    const added: string[] = [];
    for (const source of filePaths) {
      const name = basename(source);
      const dest = join(inputDir, name);
      // Refuse to overwrite an existing input file with the same name —
      // a silent overwrite loses the user's previously added document.
      const exists = await stat(dest).then(() => true).catch(() => false);
      if (exists) {
        return err<readonly string[]>(mainT("dialog.fileExists", { name }), { path: name });
      }
      await copyFile(source, dest);
      added.push(name);
    }
    return ok(added);
  } catch (error) {
    return err<readonly string[]>(mainT("error.addInputFiles", { detail: errorMessage(error) }));
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