// Builds a hierarchical tree from the flat `FileNode[]` returned by the
// backend. The backend only emits file entries (no directory nodes), so we
// derive the folder structure from the path segments here — that keeps the
// IPC contract unchanged.

import type { FileNode } from "../shared/ipc-types.ts";

export interface TreeNode {
  /** Folder path (no trailing slash) for directories; full path for files. */
  readonly relativePath: string;
  readonly name: string;
  readonly isDirectory: boolean;
  readonly size?: number;
  readonly children: readonly TreeNode[];
  /** Total number of files reachable through this node (recursive).
   *  For a file node this is always 1; for a directory it counts every
   *  file in all nested subdirectories, not just immediate children. */
  readonly fileCount: number;
}

const sep = "/";

/**
 * Build a sorted tree (directories first, then files, alphabetical) from a
 * flat list of file nodes. Returns a single root node whose `children` are
 * the top-level entries.
 */
export function buildFileTree(files: readonly FileNode[]): TreeNode {
  // Use a mutable internal shape during construction.
  type Mutable = {
    relativePath: string;
    name: string;
    isDirectory: boolean;
    size?: number;
    children: Mutable[];
    fileCount: number;
  };
  const root: Mutable = {
    relativePath: "",
    name: "",
    isDirectory: true,
    children: [],
    fileCount: 0,
  };

  function getOrCreateDir(parent: Mutable, name: string, pathPrefix: string): Mutable {
    const existing = parent.children.find(
      (child) => child.isDirectory && child.name === name,
    );
    if (existing) return existing;
    const dir: Mutable = {
      relativePath: pathPrefix ? `${pathPrefix}${sep}${name}` : name,
      name,
      isDirectory: true,
      children: [],
      fileCount: 0,
    };
    parent.children.push(dir);
    return dir;
  }

  for (const file of files) {
    const segments = file.relativePath.split(sep);
    let cursor = root;
    let prefix = "";
    // All segments except the last are directories.
    for (let i = 0; i < segments.length - 1; i++) {
      cursor = getOrCreateDir(cursor, segments[i], prefix);
      prefix = cursor.relativePath;
    }
    const leaf: Mutable = {
      relativePath: file.relativePath,
      name: file.name,
      isDirectory: false,
      size: file.size,
      children: [],
      fileCount: 1,
    };
    cursor.children.push(leaf);
  }

  function sortNode(node: Mutable): void {
    node.children.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    for (const child of node.children) sortNode(child);
  }
  sortNode(root);

  function freeze(node: Mutable): TreeNode {
    const children = node.children.map(freeze);
    // For a directory, fileCount = sum of all descendant files. Files
    // carry fileCount = 1 directly, so summing children yields the total.
    const fileCount = node.isDirectory
      ? children.reduce((sum, child) => sum + child.fileCount, 0)
      : 1;
    return {
      relativePath: node.relativePath,
      name: node.name,
      isDirectory: node.isDirectory,
      size: node.size,
      children,
      fileCount,
    };
  }
  return freeze(root);
}

/**
 * Returns the set of directory paths that are ancestors of the given file
 * path. Useful to auto-expand the tree down to a newly selected file.
 */
export function ancestorDirs(filePath: string): string[] {
  const segments = filePath.split(sep);
  const dirs: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    dirs.push(segments.slice(0, i).join(sep));
  }
  return dirs;
}