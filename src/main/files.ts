// Filesystem operations on the workspace folders, returned as Result<T>.
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { shell } from "electron";
import { parseDocument } from "./frontmatter.ts";
import { ok, err, errorMessage } from "../shared/result.ts";
import { mainT } from "./i18n.ts";
import type {
  ConceptInfo,
  FileNode,
  FilePreview,
  Folder,
  Result,
} from "../shared/ipc-types.ts";

const RESERVED = new Set(["index.md", "log.md"]);

function workspaceDir(workspace: string, folder: Folder): string {
  return join(workspace, folder);
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
    return err<readonly FileNode[]>(`Failed to list ${folder}: ${errorMessage(error)}`);
  }
}

export async function getPreview(
  workspace: string,
  relativePath: string,
): Promise<Result<FilePreview>> {
  // relativePath may be "wiki/foo.md" or just "foo.md"; resolve under workspace.
  const absolute = join(workspace, relativePath);
  try {
    const content = await readFile(absolute, "utf8");
    const isMarkdown = relativePath.endsWith(".md");
    const name = basename(relativePath);
    if (isMarkdown && !RESERVED.has(name)) {
      const parsed = parseDocument(content);
      const fm = parsed.frontmatter;
      const info: ConceptInfo | undefined = fm
        ? {
            conceptId: relativePath.replace(/^wiki\//, "").replace(/\.md$/, ""),
            title: fm.title ?? fm.type ?? name,
            description: fm.description ?? "",
            type: fm.type ?? mainT("concept.untyped"),
          }
        : undefined;
      return ok({
        relativePath,
        kind: "markdown",
        content: parsed.body,
        frontmatter: info,
      });
    }
    return ok({
      relativePath,
      kind: isMarkdown ? "markdown" : "text",
      content,
    });
  } catch (error) {
    return err<FilePreview>(`Failed to read ${relativePath}: ${errorMessage(error)}`, {
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
      const dest = join(inputDir, basename(source));
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(source, dest);
      added.push(basename(source));
    }
    return ok(added);
  } catch (error) {
    return err<readonly string[]>(`Failed to add input files: ${errorMessage(error)}`);
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
  const absolute = join(workspaceDir(workspace, folder), relativePath);
  try {
    if (isDirectory) {
      const error = await shell.openPath(absolute);
      if (error) {
        return err<void>(`Failed to open folder: ${error}`, { path: absolute });
      }
      return ok(undefined);
    }
    shell.showItemInFolder(absolute);
    return ok(undefined);
  } catch (error) {
    return err<void>(`Failed to reveal ${relativePath}: ${errorMessage(error)}`, {
      path: absolute,
    });
  }
}