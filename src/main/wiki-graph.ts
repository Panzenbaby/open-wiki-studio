// Builds the wiki graph (nodes = concepts + cited archive sources, edges =
// links between them).
//
// Concept enumeration, conceptId derivation, and frontmatter parsing live in
// ConceptStore now. This module keeps the two things that are graph policy,
// not concept knowledge:
//   - link extraction (which concepts a body references) — graph concern
//   - localizing the index.md/log.md labels (graph.* vocabulary stays here)
//
// Link formats recognised (the ref normalisation is shared with the store via
// `ConceptStore.normalizeRef`, so the wiki/ + .md stripping rule is not
// duplicated):
//   - markdown links:  [label](wiki/foo/bar.md)  [label](foo/bar.md)  [label](/foo/bar.md)
//   - bare paths:      wiki/foo/bar.md          foo/bar.md
import { join, relative, sep } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { ConceptStore, stripAngleBrackets, type Concept } from "./concept-store.ts";
import { ok, err, errorMessage } from "../shared/result.ts";
import { mainT } from "./i18n.ts";
import type {
  GraphEdge,
  GraphNode,
  Result,
  WikiGraph,
} from "../shared/ipc-types.ts";

/** Markdown link regex: [label](target) — captures the target. */
const MD_LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;

/** Bare concept path regex (the ref normalisation is delegated to the store). */
const CONCEPT_RE = /(?:wiki\/)?[A-Za-z0-9_]+(?:\/[A-Za-z0-9_.-]+)+\.md/g;

/** Localised type label for the generated index.md / log.md files. Graph
 *  vocabulary — kept here, out of the store (the store tags `kind` only). */
function specialFileType(conceptId: string): string | null {
  if (conceptId === "index") return mainT("graph.type.index");
  if (conceptId === "log") return mainT("graph.type.log");
  return null;
}

/** Node id prefix for archived originals. Never collides with a conceptId:
 *  the ConceptStore walk skips the `archive/` subtree entirely. */
const SOURCE_PREFIX = "archive/";

/** Normalize a markdown link target to an archive-relative path, or null for
 *  anything that does not point into `wiki/archive/`. Concepts cite originals
 *  as `[label](/archive/<rel>)` (pi-okf-wiki rewrites the placeholder to the
 *  real, possibly collision-renamed path); the leading slash and the `wiki/`
 *  prefix are both tolerated. Percent-encoding is decoded so a citation with
 *  spaces matches the file on disk. */
function normalizeSourceRef(ref: string): string | null {
  let p = stripAngleBrackets(ref).split("#")[0]!.split("?")[0]!;
  if (/^(https?:|mailto:)/.test(p)) return null;
  try {
    p = decodeURIComponent(p);
  } catch {
    /* malformed escape — match against the raw ref instead */
  }
  p = p.replace(/^\//, "");
  if (p.startsWith("wiki/")) p = p.slice("wiki/".length);
  if (!p.startsWith(SOURCE_PREFIX)) return null;
  const rel = p.slice(SOURCE_PREFIX.length);
  return rel === "" ? null : rel;
}

/** Extract the node ids referenced in a markdown body: conceptIds (normalised
 *  through the store so the wiki/ + .md rule is shared) and `archive/<rel>`
 *  source ids. Sources are recognised only in real markdown links — the bare
 *  path regex matches `.md` only, on purpose, so prose mentioning a pdf name
 *  does not become an edge. */
function extractLinks(store: ConceptStore, body: string): readonly string[] {
  const refs = new Set<string>();
  for (const match of body.matchAll(MD_LINK_RE)) {
    const target = match[2]!;
    const id = store.normalizeRef(target);
    if (id) {
      refs.add(id);
      continue;
    }
    const source = normalizeSourceRef(target);
    if (source) refs.add(`${SOURCE_PREFIX}${source}`);
  }
  for (const match of body.matchAll(CONCEPT_RE)) {
    const id = store.normalizeRef(match[0]);
    if (id) refs.add(id);
  }
  return [...refs];
}

/** Every file under `wiki/archive/`, as POSIX paths relative to that folder.
 *  Cited-but-missing originals are filtered against this set, mirroring the
 *  existing "edges only to concepts that exist" rule. */
async function listArchiveFiles(wikiDir: string): Promise<ReadonlySet<string>> {
  const root = join(wikiDir, "archive");
  const out = new Set<string>();
  const walk = async (dir: string): Promise<void> => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else if (entry.isFile()) out.add(relative(root, abs).split(sep).join("/"));
    }
  };
  await walk(root);
  return out;
}

/** Graph-facing concept projection: applies the index/log label override the
 *  store deliberately does not own. */
function graphNode(concept: Concept): { id: string; title: string; type: string; tags: readonly string[] } {
  const fileType = specialFileType(concept.conceptId);
  // store.title falls back to conceptId only when frontmatter title AND type
  // are both absent; that is exactly when the graph wants the localized label.
  const title =
    concept.title === concept.conceptId ? (fileType ?? concept.conceptId) : concept.title;
  // store.type is the untyped fallback when frontmatter type is absent; the
  // graph inserts the localized index/log label before that fallback.
  const type =
    concept.frontmatterType === undefined ? (fileType ?? concept.type) : concept.type;
  return { id: concept.conceptId, title, type, tags: concept.tags };
}

export async function buildWikiGraph(workspace: string): Promise<Result<WikiGraph>> {
  try {
    const wikiDir = join(workspace, "wiki");
    try {
      await stat(wikiDir);
    } catch {
      return ok({ nodes: [], edges: [] });
    }
    const store = new ConceptStore(workspace);
    const concepts = await store.listAll();
    const archiveFiles = await listArchiveFiles(wikiDir);

    const knownIds = new Set(concepts.map((c) => c.conceptId));
    for (const rel of archiveFiles) knownIds.add(`${SOURCE_PREFIX}${rel}`);
    // Only sources actually cited by a concept become nodes — an archive full
    // of never-referenced originals would otherwise render as loose dots.
    const citedSources = new Set<string>();

    // Build edges: only links pointing to existing concepts (keeps the graph
    // clean; dangling refs can be added later if desired).
    const edgeSet = new Set<string>();
    const degree = new Map<string, number>();
    for (const id of knownIds) degree.set(id, 0);

    const edges: GraphEdge[] = [];
    for (const concept of concepts) {
      for (const target of extractLinks(store, concept.body)) {
        if (!knownIds.has(target)) continue;
        if (target === concept.conceptId) continue; // no self-loops
        if (target.startsWith(SOURCE_PREFIX)) citedSources.add(target);
        const key = `${concept.conceptId}\u0001${target}`;
        if (edgeSet.has(key)) continue;
        edgeSet.add(key);
        edges.push({ source: concept.conceptId, target });
        degree.set(concept.conceptId, (degree.get(concept.conceptId) ?? 0) + 1);
        degree.set(target, (degree.get(target) ?? 0) + 1);
      }
    }

    const nodes: GraphNode[] = concepts.map((c) => {
      const node = graphNode(c);
      return {
        id: node.id,
        kind: "concept",
        title: node.title,
        type: node.type,
        tags: node.tags,
        degree: degree.get(c.conceptId) ?? 0,
      };
    });
    for (const id of citedSources) {
      nodes.push({
        id,
        kind: "source",
        title: id.slice(id.lastIndexOf("/") + 1),
        type: mainT("graph.type.source"),
        tags: [],
        degree: degree.get(id) ?? 0,
      });
    }

    return ok({ nodes, edges });
  } catch (error) {
    return err<WikiGraph>(mainT("error.buildWikiGraph", { detail: errorMessage(error) }));
  }
}