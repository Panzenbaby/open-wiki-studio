// Per-file outcome of an ingest run: which input files were ingested, how many
// concepts cite each of them, and which files are still waiting in input/.
//
// pi-okf-wiki reports only aggregate numbers to the app, so the mapping is
// reconstructed from the filesystem: an ingested file leaves `input/` and
// lands in `wiki/archive/` under the same relative path — or, when that name is
// taken, a timestamped variant (see pi-okf-wiki `resolveArchiveTarget`). The
// concepts written in the run cite that archived original in their `sources`
// frontmatter, which links concepts back to input files.
import { join } from "node:path";
import { ConceptStore } from "./concept-store.ts";
import { listArchiveFiles, normalizeSourceRef } from "./wiki-graph.ts";
import type { IngestFileResult } from "../shared/ipc-types.ts";
import type { WikiDiff } from "./wiki-scan.ts";

/** Everything the per-file mapping needs, captured around one ingest run. */
export interface IngestFileResultInput {
  /** `input/`-relative paths present when the run started. */
  readonly inputBefore: readonly string[];
  /** `input/`-relative paths still present after the run. */
  readonly leftover: readonly string[];
  /** `archive/`-relative paths that did not exist before the run. */
  readonly newArchiveFiles: readonly string[];
  /** Created concepts → their cited `archive/`-relative sources. */
  readonly createdSources: ReadonlyMap<string, readonly string[]>;
  /** Updated concepts → their cited `archive/`-relative sources. */
  readonly updatedSources: ReadonlyMap<string, readonly string[]>;
}

/** The input-folder state an ingest run starts from. */
export interface IngestStartState {
  readonly inputFiles: readonly string[];
  readonly archiveFiles: ReadonlySet<string>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Does `archivePath` (relative to `wiki/archive/`) name the archived original
 *  of `inputPath` (relative to `input/`)? Mirrors pi-okf-wiki's
 *  `resolveArchiveTarget`: the same relative path, a `.<YYYY-MM-DD-HHMM>`
 *  stamp (plus an optional `.<n>` counter) between stem and extension, and an
 *  extra `.orig` suffix for markdown originals. */
export function isArchivedOriginalOf(inputPath: string, archivePath: string): boolean {
  const slash = inputPath.lastIndexOf("/");
  const directory = slash >= 0 ? inputPath.slice(0, slash + 1) : "";
  const fileName = inputPath.slice(slash + 1);
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : "";
  const origSuffix = fileName.endsWith(".md") ? ".orig" : "";
  const pattern = new RegExp(
    `^${escapeRegExp(directory + stem)}(?:\\.\\d{4}-\\d{2}-\\d{2}-\\d{4}(?:\\.\\d+)?)?` +
      `${escapeRegExp(extension + origSuffix)}$`,
  );
  return pattern.test(archivePath);
}

function countCiting(
  sourcesByConcept: ReadonlyMap<string, readonly string[]>,
  archivePaths: ReadonlySet<string>,
): number {
  let count = 0;
  for (const sources of sourcesByConcept.values()) {
    if (sources.some((source) => archivePaths.has(source))) count += 1;
  }
  return count;
}

/** Map one ingest run to a per-file result, sorted by input path. */
export function buildIngestFileResults(input: IngestFileResultInput): IngestFileResult[] {
  const leftover = new Set(input.leftover);
  return [...input.inputBefore].sort().map((relativePath): IngestFileResult => {
    if (leftover.has(relativePath)) {
      return { relativePath, status: "leftover", createdConcepts: 0, updatedConcepts: 0 };
    }
    // Only archive entries created in this run qualify, so an older original
    // with the same name is never attributed to this run.
    const archived = new Set(
      input.newArchiveFiles.filter((archivePath) => isArchivedOriginalOf(relativePath, archivePath)),
    );
    return {
      relativePath,
      status: "processed",
      createdConcepts: countCiting(input.createdSources, archived),
      updatedConcepts: countCiting(input.updatedSources, archived),
    };
  });
}

/** Capture the state the per-file mapping diffs against. Call before the run. */
export async function captureIngestStartState(
  workspace: string,
  inputFiles: readonly string[],
): Promise<IngestStartState> {
  return { inputFiles, archiveFiles: await listArchiveFiles(join(workspace, "wiki")) };
}

/** Read the wiki after a run and build the per-file results. */
export async function loadIngestFileResults(
  workspace: string,
  start: IngestStartState,
  leftover: readonly string[],
  diff: WikiDiff,
): Promise<IngestFileResult[]> {
  const archiveAfter = await listArchiveFiles(join(workspace, "wiki"));
  const newArchiveFiles = [...archiveAfter].filter((path) => !start.archiveFiles.has(path));
  const created = new Set(diff.created);
  const updated = new Set(diff.updated);
  const createdSources = new Map<string, readonly string[]>();
  const updatedSources = new Map<string, readonly string[]>();
  if (created.size + updated.size > 0) {
    const concepts = await new ConceptStore(workspace).listConcepts();
    for (const concept of concepts) {
      const target = created.has(concept.conceptId)
        ? createdSources
        : updated.has(concept.conceptId)
          ? updatedSources
          : null;
      if (!target) continue;
      const sources = concept.sourceResources
        .map((resource) => normalizeSourceRef(resource))
        .filter((source): source is string => source !== null);
      target.set(concept.conceptId, sources);
    }
  }
  return buildIngestFileResults({
    inputBefore: start.inputFiles,
    leftover,
    newArchiveFiles,
    createdSources,
    updatedSources,
  });
}
