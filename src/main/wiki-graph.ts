// Builds the wiki graph (nodes = concepts, edges = links between them) by
// walking the wiki/ folder, parsing frontmatter + body, and extracting
// markdown links + bare concept-path references from each body.
//
// Link formats recognised (mirrors remark-concept-links.ts):
//   - markdown links:  [label](wiki/foo/bar.md)  [label](foo/bar.md)  [label](/foo/bar.md)
//   - bare paths:      wiki/foo/bar.md          foo/bar.md
// External (http/mailto) and non-.md refs are ignored.
import { join, relative, sep } from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { parseDocument } from "./frontmatter.ts";
import { ok, err, errorMessage } from "../shared/result.ts";
import { mainT } from "./i18n.ts";
import type {
  GraphEdge,
  GraphNode,
  Result,
  WikiGraph,
} from "../shared/ipc-types.ts";

/** Markdown files only — every .md file in wiki/ becomes a node. */
function isMarkdown(relativePath: string): boolean {
  return relativePath.endsWith(".md");
}

/** Localised type label for the generated index.md / log.md files. */
function specialFileType(conceptId: string): string | null {
  if (conceptId === "index") return mainT("graph.type.index");
  if (conceptId === "log") return mainT("graph.type.log");
  return null;
}

/** Markdown link regex: [label](target) — captures the target. */
const MD_LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;

/** Bare concept path regex (same semantics as remark-concept-links). */
const CONCEPT_RE = /(?:wiki\/)?[A-Za-z0-9_]+(?:\/[A-Za-z0-9_.-]+)+\.md/g;

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

/**
 * Normalise a link target to a conceptId (path without `wiki/` prefix and
 * without `.md`). Returns null for external/non-concept refs.
 */
function toConceptId(ref: string): string | null {
  let p = ref.trim().split("#")[0]!.split("?")[0]!;
  if (/^(https?:|mailto:)/.test(p)) return null;
  // strip leading slash (root-relative concept refs)
  p = p.replace(/^\//, "");
  // strip optional wiki/ prefix
  if (p.startsWith("wiki/")) p = p.slice("wiki/".length);
  if (!p.endsWith(".md")) return null;
  return p.slice(0, -3);
}

/** Extract all conceptIds referenced in a markdown body. */
function extractLinks(body: string): readonly string[] {
  const refs = new Set<string>();
  // markdown links
  for (const match of body.matchAll(MD_LINK_RE)) {
    const id = toConceptId(match[2]!);
    if (id) refs.add(id);
  }
  // bare concept paths (also catches links already wrapped in markdown —
  // deduped via the Set).
  for (const match of body.matchAll(CONCEPT_RE)) {
    const id = toConceptId(match[0]);
    if (id) refs.add(id);
  }
  return [...refs];
}

interface RawConcept {
  readonly conceptId: string;
  readonly title: string;
  readonly type: string;
  readonly tags: readonly string[];
  readonly links: readonly string[];
}

async function loadConcept(
  absolutePath: string,
  wikiRoot: string,
): Promise<RawConcept | null> {
  try {
    const content = await readFile(absolutePath, "utf8");
    const parsed = parseDocument(content);
    const rel = relative(wikiRoot, absolutePath).split(sep).join("/");
    const conceptId = rel.endsWith(".md") ? rel.slice(0, -3) : rel;
    const fm = parsed.frontmatter;
    const fileType = specialFileType(conceptId);
    return {
      conceptId,
      title: fm?.title ?? fm?.type ?? fileType ?? conceptId,
      type: fm?.type ?? fileType ?? mainT("concept.untyped"),
      tags: fm?.tags ?? [],
      links: extractLinks(parsed.body),
    };
  } catch {
    return null;
  }
}

export async function buildWikiGraph(workspace: string): Promise<Result<WikiGraph>> {
  try {
    const wikiDir = join(workspace, "wiki");
    try {
      await stat(wikiDir);
    } catch {
      return ok({ nodes: [], edges: [] });
    }
    const files = await walk(wikiDir, wikiDir);
    const conceptFiles = files.filter((f) => isMarkdown(f.relativePath));

    const raws: RawConcept[] = [];
    for (const file of conceptFiles) {
      const raw = await loadConcept(file.absolutePath, wikiDir);
      if (raw) raws.push(raw);
    }

    const knownIds = new Set(raws.map((c) => c.conceptId));

    // Build edges: only links pointing to existing concepts (keeps the graph
    // clean; dangling refs can be added later if desired).
    const edgeSet = new Set<string>();
    const degree = new Map<string, number>();
    for (const id of knownIds) degree.set(id, 0);

    const edges: GraphEdge[] = [];
    for (const raw of raws) {
      for (const target of raw.links) {
        if (!knownIds.has(target)) continue;
        if (target === raw.conceptId) continue; // no self-loops
        const key = `${raw.conceptId}\u0001${target}`;
        if (edgeSet.has(key)) continue;
        edgeSet.add(key);
        edges.push({ source: raw.conceptId, target });
        degree.set(raw.conceptId, (degree.get(raw.conceptId) ?? 0) + 1);
        degree.set(target, (degree.get(target) ?? 0) + 1);
      }
    }

    const nodes: GraphNode[] = raws.map((c) => ({
      id: c.conceptId,
      title: c.title,
      type: c.type,
      tags: c.tags,
      degree: degree.get(c.conceptId) ?? 0,
    }));

    return ok({ nodes, edges });
  } catch (error) {
    return err<WikiGraph>(mainT("error.buildWikiGraph", { detail: errorMessage(error) }));
  }
}