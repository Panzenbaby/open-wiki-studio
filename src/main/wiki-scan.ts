// Wiki snapshot + diff for the ingest summary. The concept enumeration and
// frontmatter handling live in ConceptStore now; this module keeps the two
// things that are caller policies, not concept knowledge:
//   - snapshotWiki / diffSnapshots: hashing body + diffing before/after
//   - listInputFiles: listing the input/ folder (a different folder, with a
//     different shape — just relative paths, no concept parsing)
import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { ConceptStore } from "./concept-store.ts";

export interface WikiSnapshot {
  readonly entries: ReadonlyMap<string, string>; // conceptId -> descriptive content hash
}

export interface WikiDiff {
  readonly created: readonly string[];
  readonly updated: readonly string[];
}

/** Normalize markdown whitespace that has no effect on the rendered content. */
function normalizeMarkdown(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, "");
}

function stableMetadata(value: unknown, fieldName = ""): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => stableMetadata(item));
    return fieldName === "tags" ? items.sort((left, right) => String(left).localeCompare(String(right))) : items;
  }
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableMetadata(child, key)]),
  );
}

/** Snapshot the wiki for ingest diffing: conceptId -> sha1(body). Reserved
 *  files (index.md/log.md) are excluded — they are generated, not
 *  agent-authored concepts the diff should report. */
export async function snapshotWiki(workspace: string): Promise<WikiSnapshot> {
  const store = new ConceptStore(workspace);
  const concepts = await store.listConcepts();
  const entries = new Map<string, string>();
  for (const concept of concepts) {
    const descriptiveContent = JSON.stringify({
      body: normalizeMarkdown(concept.body),
      metadata: stableMetadata(concept.descriptiveMetadata),
    });
    entries.set(concept.conceptId, createHash("sha1").update(descriptiveContent).digest("hex"));
  }
  return { entries };
}

/** Diff two snapshots into created/updated concept lists (sorted). */
export async function markChangedConceptsUnverified(
  workspace: string,
  before: WikiSnapshot,
  after: WikiSnapshot,
): Promise<void> {
  const changed = diffSnapshots(before, after);
  const store = new ConceptStore(workspace);
  for (const conceptId of [...changed.created, ...changed.updated]) {
    const result = await store.setVerified(conceptId, false);
    if (!result.success) throw new Error(result.error.message);
  }
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

/** List files still in input/ after an ingest (the agent did not consume
 *  them). Walks input/ directly — a different folder with a different shape
 *  (just relative paths), so it is not part of ConceptStore. */
async function walkInput(
  dir: string,
  root: string,
): Promise<readonly { relativePath: string; absolutePath: string }[]> {
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
      out.push(...(await walkInput(abs, root)));
    } else if (entry.isFile()) {
      const rel = relative(root, abs).split(sep).join("/");
      out.push({ relativePath: rel, absolutePath: abs });
    }
  }
  return out;
}

export async function listInputFiles(workspace: string): Promise<readonly string[]> {
  const inputDir = join(workspace, "input");
  try {
    await stat(inputDir);
  } catch {
    return [];
  }
  const files = await walkInput(inputDir, inputDir);
  return files.map((f) => f.relativePath).sort();
}