// Merging several workspaces into a new one.
//
// The merge is a pure filesystem operation — no agent, no LLM. Sources stay
// untouched; everything is written into a fresh target workspace.
//
// Collision rule (identical for concepts, archive originals, and input
// files): when the same relative path exists in more than one source, the
// copies are deduplicated if they are byte-identical, and otherwise ALL of
// them move to `<source-name>/<path>`. Symmetric on purpose — the outcome
// must not depend on the order in which the user ticked the sources.
//
// The moved concepts are what makes link rewriting necessary: every `[l](id.md)`,
// `/id.md`, `wiki/id.md`, bare `id.md`, and `/archive/<path>` citation in a
// concept BODY is rewritten to the post-merge path. Frontmatter is left
// byte-for-byte alone (`resource:` holds a canonical URI, never a wiki path).
//
// `index.md` is not merged but regenerated from the merged concepts (it is a
// derived file); `log.md` entries of all sources are interleaved by date.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { parseDocument } from "./frontmatter.ts";
import { ok, err, errorMessage } from "../shared/result.ts";
import { mainT } from "./i18n.ts";
import type { MergeReport, Result } from "../shared/ipc-types.ts";

// ─── planning (pure) ──────────────────────────────────────────────────

export interface FileEntry {
  /** POSIX path relative to the category root (wiki/, wiki/archive/, input/). */
  readonly relativePath: string;
  readonly hash: string;
}

export interface PlanSource {
  /** Collision prefix — the workspace folder name, already disambiguated. */
  readonly name: string;
  readonly files: readonly FileEntry[];
}

export interface Placement {
  readonly relativePath: string;
  /** Path in the merged workspace, relative to the same category root. */
  readonly target: string;
  /** False when an identical file from an earlier source already writes `target`. */
  readonly copy: boolean;
}

/** Resolve every source file to its path in the merged workspace. Returns one
 *  placement list per source, in the order the sources were given. */
export function planPlacements(
  sources: readonly PlanSource[],
): readonly (readonly Placement[])[] {
  const groups = new Map<string, { source: number; hash: string }[]>();
  sources.forEach((source, index) => {
    for (const file of source.files) {
      const bucket = groups.get(file.relativePath) ?? [];
      bucket.push({ source: index, hash: file.hash });
      groups.set(file.relativePath, bucket);
    }
  });

  const claimed = new Set<string>();
  const out: Placement[][] = sources.map(() => []);
  for (const relativePath of [...groups.keys()].sort()) {
    const bucket = groups.get(relativePath)!;
    if (bucket.every((entry) => entry.hash === bucket[0]!.hash)) {
      const target = freeTarget(claimed, relativePath);
      claimed.add(target);
      bucket.forEach((entry, index) => {
        out[entry.source]!.push({ relativePath, target, copy: index === 0 });
      });
      continue;
    }
    for (const entry of bucket) {
      const target = freeTarget(claimed, `${sources[entry.source]!.name}/${relativePath}`);
      claimed.add(target);
      out[entry.source]!.push({ relativePath, target, copy: true });
    }
  }
  return out;
}

/** First unclaimed variant of `preferred`, suffixing the basename stem with
 *  `-2`, `-3`, … A prefixed target can collide with a plain one when a source
 *  happens to have a folder named like another source. */
function freeTarget(claimed: ReadonlySet<string>, preferred: string): string {
  if (!claimed.has(preferred)) return preferred;
  const dot = preferred.lastIndexOf(".");
  const slash = preferred.lastIndexOf("/");
  const stem = dot > slash ? preferred.slice(0, dot) : preferred;
  const extension = dot > slash ? preferred.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${extension}`;
    if (!claimed.has(candidate)) return candidate;
  }
}

/** Disambiguate equal workspace folder names with `-2`, `-3`, … so the
 *  collision prefix stays unique per source. */
export function uniqueSourceNames(names: readonly string[]): readonly string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    for (let n = 2; used.has(candidate); n++) candidate = `${name}-${n}`;
    used.add(candidate);
    return candidate;
  });
}

/** conceptId → conceptId for the concepts a plan moved (`.md` stripped). */
export function conceptRenames(
  placements: readonly Placement[],
): ReadonlyMap<string, string> {
  const renames = new Map<string, string>();
  for (const placement of placements) {
    if (placement.target === placement.relativePath) continue;
    if (!placement.relativePath.endsWith(".md")) continue;
    renames.set(stripMd(placement.relativePath), stripMd(placement.target));
  }
  return renames;
}

/** Subtree-relative → subtree-relative for the raw files a plan moved. Used
 *  for both `wiki/archive/` originals and `wiki/trash/` removed concepts. */
export function archiveRenames(
  placements: readonly Placement[],
): ReadonlyMap<string, string> {
  const renames = new Map<string, string>();
  for (const placement of placements) {
    if (placement.target === placement.relativePath) continue;
    renames.set(placement.relativePath, placement.target);
  }
  return renames;
}

function stripMd(path: string): string {
  return path.endsWith(".md") ? path.slice(0, -3) : path;
}

// ─── link rewriting (pure) ────────────────────────────────────────────

/** Matches either a markdown link target (angle-bracketed or not) or a bare
 *  concept path. One alternation, one pass — so a rewritten link cannot be
 *  matched a second time by the bare-path branch. */
const LINK_RE =
  /(\[[^\]]*\]\()(<?)([^)>]+)(>?)(\))|((?:wiki\/)?[A-Za-z0-9_]+(?:\/[A-Za-z0-9_.-]+)+\.md)/g;

/** Rewrite concept, archive, and trash references in a markdown fragment.
 *  Refs that no rename touches are returned verbatim, including their `/`,
 *  `wiki/`, and `#anchor` decorations. */
export function rewriteLinks(
  text: string,
  concepts: ReadonlyMap<string, string>,
  archive: ReadonlyMap<string, string>,
  trash: ReadonlyMap<string, string> = new Map(),
): string {
  if (concepts.size === 0 && archive.size === 0 && trash.size === 0) return text;
  return text.replace(
    LINK_RE,
    (match, open?: string, lt?: string, target?: string, gt?: string, close?: string, bare?: string) => {
      const ref = open === undefined ? bare! : target!;
      const rewritten = rewriteRef(ref, concepts, archive, trash);
      if (rewritten === null) return match;
      return open === undefined ? rewritten : `${open}${lt}${rewritten}${gt}${close}`;
    },
  );
}

function rewriteRef(
  ref: string,
  concepts: ReadonlyMap<string, string>,
  archive: ReadonlyMap<string, string>,
  trash: ReadonlyMap<string, string>,
): string | null {
  const cut = ref.search(/[#?]/);
  const path = cut === -1 ? ref : ref.slice(0, cut);
  const suffix = cut === -1 ? "" : ref.slice(cut);
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null;

  let rest = path;
  const rootSlash = rest.startsWith("/") ? "/" : "";
  if (rootSlash) rest = rest.slice(1);

  for (const [dir, renames] of [["archive", archive], ["trash", trash]] as const) {
    if (!rest.startsWith(`${dir}/`)) continue;
    const renamed = renames.get(rest.slice(dir.length + 1));
    return renamed === undefined ? null : `${rootSlash}${dir}/${renamed}${suffix}`;
  }

  const wikiPrefix = rest.startsWith("wiki/") ? "wiki/" : "";
  if (wikiPrefix) rest = rest.slice(wikiPrefix.length);
  if (!rest.endsWith(".md")) return null;
  const renamed = concepts.get(rest.slice(0, -3));
  return renamed === undefined
    ? null
    : `${rootSlash}${wikiPrefix}${renamed}.md${suffix}`;
}

/** Rewrite only the BODY of a concept file; the frontmatter block is copied
 *  through byte-for-byte. */
export function rewriteConceptContent(
  content: string,
  concepts: ReadonlyMap<string, string>,
  archive: ReadonlyMap<string, string>,
  trash: ReadonlyMap<string, string> = new Map(),
): string {
  const { head, body } = splitFrontmatter(content);
  return head + rewriteLinks(body, concepts, archive, trash);
}

function splitFrontmatter(content: string): { head: string; body: string } {
  if (!content.startsWith("---")) return { head: "", body: content };
  const lines = content.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() !== "---") continue;
    const head = lines.slice(0, i + 1).join("\n");
    return { head: `${head}\n`, body: lines.slice(i + 1).join("\n") };
  }
  return { head: "", body: content };
}

// ─── index.md (pure) ──────────────────────────────────────────────────

export interface IndexEntry {
  readonly conceptId: string;
  readonly title?: string;
  readonly description?: string;
}

/** Regenerate the root index. Mirrors `generateIndexMd` in pi-okf-wiki so the
 *  merged wiki is byte-compatible with what the next ingest would produce. */
export function generateIndexMd(concepts: readonly IndexEntry[]): string {
  const groups = new Map<string, IndexEntry[]>();
  for (const concept of concepts) {
    const slash = concept.conceptId.lastIndexOf("/");
    const dir = slash === -1 ? "." : concept.conceptId.slice(0, slash);
    const bucket = groups.get(dir) ?? [];
    bucket.push(concept);
    groups.set(dir, bucket);
  }
  const lines: string[] = ["# Wiki Index", ""];
  for (const dir of [...groups.keys()].sort()) {
    lines.push(`## ${dir === "." ? "(root)" : dir}`, "");
    for (const concept of groups
      .get(dir)!
      .sort((a, b) => a.conceptId.localeCompare(b.conceptId))) {
      const title = concept.title ?? concept.conceptId;
      const suffix = concept.description ? ` - ${concept.description}` : "";
      lines.push(`* [${title}](${concept.conceptId}.md)${suffix}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ─── log.md (pure) ────────────────────────────────────────────────────

export interface LogSource {
  readonly content: string;
  readonly concepts: ReadonlyMap<string, string>;
  readonly archive: ReadonlyMap<string, string>;
  /** Renames of `wiki/trash/` entries — `log.md` links to them from `Removal`
   *  entries, which would otherwise dangle after a collision rename. */
  readonly trash?: ReadonlyMap<string, string>;
}

interface LogEntry {
  readonly date: string;
  readonly text: string;
}

/** Interleave the sources' log entries by date (newest first), rewriting the
 *  conceptId links they contain, and put `mergeEntry` on top. */
export function mergeLogs(sources: readonly LogSource[], mergeEntry: string): string {
  const entries: LogEntry[] = [];
  for (const source of sources) {
    for (const entry of parseLog(source.content)) {
      entries.push({
        date: entry.date,
        text: rewriteLinks(entry.text, source.concepts, source.archive, source.trash),
      });
    }
  }
  // Stable sort: entries of the same date keep source order.
  entries.sort((a, b) => b.date.localeCompare(a.date));
  return ["# Wiki Update Log", "", mergeEntry, ...entries.map((e) => e.text)].join("\n");
}

function parseLog(content: string): readonly LogEntry[] {
  const entries: LogEntry[] = [];
  let date: string | null = null;
  let body: string[] = [];
  const flush = (): void => {
    if (date === null) return;
    const text = body.join("\n").trim();
    entries.push({ date, text: `## ${date}\n\n${text}\n` });
  };
  for (const line of content.split(/\r?\n/)) {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      date = heading[1]!.trim();
      body = [];
    } else if (date !== null) {
      body.push(line);
    }
  }
  flush();
  return entries;
}

// ─── filesystem ───────────────────────────────────────────────────────

const RESERVED = new Set(["index.md", "log.md"]);

interface ScannedSource {
  readonly path: string;
  readonly name: string;
  readonly wiki: readonly FileEntry[];
  readonly archive: readonly FileEntry[];
  readonly trash: readonly FileEntry[];
  readonly input: readonly FileEntry[];
  readonly log: string;
}

/** Recursive walk yielding POSIX paths relative to `root`, skipping dotfiles
 *  and (at the top level only) the named directories. */
async function walk(
  dir: string,
  root: string,
  skipTopLevel: ReadonlySet<string> = new Set(),
): Promise<readonly string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir === root && skipTopLevel.has(entry.name)) continue;
      out.push(...(await walk(absolute, root, skipTopLevel)));
    } else if (entry.isFile()) {
      out.push(relative(root, absolute).split(sep).join("/"));
    }
  }
  return out;
}

async function hashFile(absolutePath: string): Promise<string> {
  return createHash("sha1").update(await readFile(absolutePath)).digest("hex");
}

async function scanDir(
  root: string,
  skipTopLevel?: ReadonlySet<string>,
  exclude?: (relativePath: string) => boolean,
): Promise<readonly FileEntry[]> {
  const paths = await walk(root, root, skipTopLevel);
  const entries: FileEntry[] = [];
  for (const relativePath of paths) {
    if (exclude?.(relativePath)) continue;
    entries.push({ relativePath, hash: await hashFile(join(root, relativePath)) });
  }
  return entries;
}

async function scanSource(path: string, name: string): Promise<ScannedSource> {
  const wikiRoot = join(path, "wiki");
  // The root index.md/log.md are derived files: regenerated resp. merged
  // separately, never copied.
  // `trash/` is scanned as its own category, not as wiki content: its entries
  // are removed knowledge and must not be planned or renamed as concepts.
  const wiki = await scanDir(wikiRoot, new Set(["archive", "trash"]), (rel) => RESERVED.has(rel));
  const archive = await scanDir(join(wikiRoot, "archive"));
  const trash = await scanDir(join(wikiRoot, "trash"));
  const input = await scanDir(join(path, "input"));
  let log = "";
  try {
    log = await readFile(join(wikiRoot, "log.md"), "utf8");
  } catch {
    /* no log yet */
  }
  return { path, name, wiki, archive, trash, input, log };
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(`${sep}..`));
}

async function validate(sources: readonly string[], target: string): Promise<string | null> {
  if (sources.length < 2) return mainT("merge.errorTooFewSources");
  if (new Set(sources).size !== sources.length) return mainT("merge.errorDuplicateSource");
  for (const source of sources) {
    if (!(await isDirectory(source))) {
      return mainT("error.workspaceNotFound", { path: source });
    }
    if (!(await isDirectory(join(source, "wiki")))) {
      return mainT("merge.errorNotAWorkspace", { path: source });
    }
    if (contains(source, target) || contains(target, source)) {
      return mainT("merge.errorTargetInsideSource", { path: source });
    }
  }
  if (await isDirectory(target)) {
    const entries = await readdir(target);
    if (entries.length > 0) return mainT("merge.errorTargetNotEmpty", { path: target });
  }
  return null;
}

async function writeFileAt(path: string, content: string | Buffer): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content);
}

async function copyFileTo(from: string, to: string): Promise<void> {
  await mkdir(join(to, ".."), { recursive: true });
  await copyFile(from, to);
}

/**
 * Merge `sourcePaths` into a new workspace at `target`. Sources are read-only;
 * on any failure the partially written target is removed again — a half-filled
 * workspace is worse than none.
 */
export async function mergeWorkspaces(
  sourcePaths: readonly string[],
  target: string,
): Promise<Result<MergeReport>> {
  const sources = sourcePaths.map((path) => resolve(path));
  const targetPath = resolve(target);

  const invalid = await validate(sources, targetPath);
  if (invalid) return err<MergeReport>(invalid);

  const targetExisted = await isDirectory(targetPath);
  try {
    const names = uniqueSourceNames(sources.map((path) => basename(path)));
    const scanned = await Promise.all(sources.map((path, i) => scanSource(path, names[i]!)));

    const wikiPlans = planPlacements(scanned.map((s) => ({ name: s.name, files: s.wiki })));
    const archivePlans = planPlacements(scanned.map((s) => ({ name: s.name, files: s.archive })));
    const trashPlans = planPlacements(scanned.map((s) => ({ name: s.name, files: s.trash })));
    const inputPlans = planPlacements(scanned.map((s) => ({ name: s.name, files: s.input })));

    await mkdir(join(targetPath, "wiki"), { recursive: true });
    await mkdir(join(targetPath, "input"), { recursive: true });

    const indexEntries: IndexEntry[] = [];
    let renamed = 0;
    let deduplicated = 0;

    for (let i = 0; i < scanned.length; i++) {
      const source = scanned[i]!;
      const concepts = conceptRenames(wikiPlans[i]!);
      const archive = archiveRenames(archivePlans[i]!);
      const trash = archiveRenames(trashPlans[i]!);

      for (const placement of wikiPlans[i]!) {
        if (!placement.copy) {
          deduplicated++;
          continue;
        }
        if (placement.target !== placement.relativePath) renamed++;
        const from = join(source.path, "wiki", placement.relativePath);
        const to = join(targetPath, "wiki", placement.target);
        if (!placement.relativePath.endsWith(".md")) {
          await copyFileTo(from, to);
          continue;
        }
        const content = rewriteConceptContent(await readFile(from, "utf8"), concepts, archive, trash);
        await writeFileAt(to, content);
        if (!RESERVED.has(basename(placement.target))) {
          const parsed = parseDocument(content);
          indexEntries.push({
            conceptId: stripMd(placement.target),
            title: parsed.frontmatter?.title,
            description: parsed.frontmatter?.description,
          });
        }
      }

      for (const placement of archivePlans[i]!) {
        if (!placement.copy) {
          deduplicated++;
          continue;
        }
        if (placement.target !== placement.relativePath) renamed++;
        await copyFileTo(
          join(source.path, "wiki", "archive", placement.relativePath),
          join(targetPath, "wiki", "archive", placement.target),
        );
      }

      for (const placement of trashPlans[i]!) {
        if (!placement.copy) {
          deduplicated++;
          continue;
        }
        if (placement.target !== placement.relativePath) renamed++;
        await copyFileTo(
          join(source.path, "wiki", "trash", placement.relativePath),
          join(targetPath, "wiki", "trash", placement.target),
        );
      }

      for (const placement of inputPlans[i]!) {
        if (!placement.copy) {
          deduplicated++;
          continue;
        }
        if (placement.target !== placement.relativePath) renamed++;
        await copyFileTo(
          join(source.path, "input", placement.relativePath),
          join(targetPath, "input", placement.target),
        );
      }
    }

    await writeFileAt(join(targetPath, "wiki", "index.md"), generateIndexMd(indexEntries));

    const today = new Date().toISOString().slice(0, 10);
    const mergeEntry = [
      `## ${today}`,
      "",
      `* **Merge**: ${mainT("merge.logEntry", {
        sources: names.join(", "),
        concepts: indexEntries.length,
        renamed,
        deduplicated,
      })}`,
      "",
    ].join("\n");
    await writeFileAt(
      join(targetPath, "wiki", "log.md"),
      mergeLogs(
        scanned.map((source, i) => ({
          content: source.log,
          concepts: conceptRenames(wikiPlans[i]!),
          archive: archiveRenames(archivePlans[i]!),
          trash: archiveRenames(trashPlans[i]!),
        })),
        mergeEntry,
      ),
    );

    return ok({
      workspace: targetPath,
      concepts: indexEntries.length,
      renamed,
      deduplicated,
    });
  } catch (error) {
    await cleanup(targetPath, targetExisted);
    return err<MergeReport>(mainT("merge.errorFailed", { detail: errorMessage(error) }));
  }
}

/** Remove what the merge wrote. An empty target folder the user picked in the
 *  dialog already existed — keep the folder itself, drop only its contents. */
async function cleanup(targetPath: string, targetExisted: boolean): Promise<void> {
  try {
    if (!targetExisted) {
      await rm(targetPath, { recursive: true, force: true });
      return;
    }
    for (const entry of await readdir(targetPath)) {
      await rm(join(targetPath, entry), { recursive: true, force: true });
    }
  } catch {
    /* best effort — the merge error is what the user needs to see */
  }
}
