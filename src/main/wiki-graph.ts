// Builds the wiki graph (nodes = concepts, edges = links between them).
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
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { ConceptStore, type Concept } from "./concept-store.ts";
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

/** Extract all conceptIds referenced in a markdown body, normalising each
 *  ref through the store so the wiki/ + .md rule is shared. */
function extractLinks(store: ConceptStore, body: string): readonly string[] {
  const refs = new Set<string>();
  for (const match of body.matchAll(MD_LINK_RE)) {
    const id = store.normalizeRef(match[2]!);
    if (id) refs.add(id);
  }
  for (const match of body.matchAll(CONCEPT_RE)) {
    const id = store.normalizeRef(match[0]);
    if (id) refs.add(id);
  }
  return [...refs];
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

    const knownIds = new Set(concepts.map((c) => c.conceptId));

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
        title: node.title,
        type: node.type,
        tags: node.tags,
        degree: degree.get(c.conceptId) ?? 0,
      };
    });

    return ok({ nodes, edges });
  } catch (error) {
    return err<WikiGraph>(mainT("error.buildWikiGraph", { detail: errorMessage(error) }));
  }
}