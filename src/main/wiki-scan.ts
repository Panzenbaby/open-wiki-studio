// Lightweight wiki scanning for the ingest summary (before/after diff +
// leftover detection). Uses only node:fs so it bundles cleanly into the
// main process without jiti. Mirrors the semantics of pi-okf-wiki/wiki.ts.
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const RESERVED = new Set(["index.md", "log.md"]);

export interface WikiSnapshot {
  readonly entries: ReadonlyMap<string, string>; // conceptId -> sha1
}

export interface WikiDiff {
  readonly created: readonly string[];
  readonly updated: readonly string[];
}

function isConcept(relativePath: string): boolean {
  if (!relativePath.endsWith(".md")) return false;
  const segments = relativePath.split("/");
  return segments.length > 0 && !RESERVED.has(segments[segments.length - 1]);
}

function conceptId(relativePath: string): string {
  return relativePath.endsWith(".md") ? relativePath.slice(0, -3) : relativePath;
}

async function walk(dir: string, root: string): Promise<readonly { relativePath: string; absolutePath: string }[]> {
  const out: { relativePath: string; absolutePath: string }[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
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
      out.push({ relativePath: rel, absolutePath: abs });
    }
  }
  return out;
}

export async function snapshotWiki(workspace: string): Promise<WikiSnapshot> {
  const wikiDir = join(workspace, "wiki");
  try {
    await stat(wikiDir);
  } catch {
    return { entries: new Map() };
  }
  const files = await walk(wikiDir, wikiDir);
  const entries = new Map<string, string>();
  for (const file of files) {
    if (!isConcept(file.relativePath)) continue;
    let content: string;
    try {
      content = await readFile(file.absolutePath, "utf8");
    } catch {
      continue;
    }
    entries.set(conceptId(file.relativePath), createHash("sha1").update(content).digest("hex"));
  }
  return { entries };
}

export function diffSnapshots(before: WikiSnapshot, after: WikiSnapshot): WikiDiff {
  const created: string[] = [];
  const updated: string[] = [];
  for (const [id, hash] of after.entries) {
    const prev = before.entries.get(id);
    if (prev === undefined) created.push(id);
    else if (prev !== hash) updated.push(id);
  }
  created.sort();
  updated.sort();
  return { created, updated };
}

export async function listInputFiles(workspace: string): Promise<readonly string[]> {
  const inputDir = join(workspace, "input");
  try {
    await stat(inputDir);
  } catch {
    return [];
  }
  const files = await walk(inputDir, inputDir);
  return files.map((f) => f.relativePath).sort();
}