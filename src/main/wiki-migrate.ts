// Repository around the extension's OKF v0.1 → v0.2 migration.
//
// Like removal, the migration is deterministic and must not depend on an LLM:
// it rewrites `timestamp` into `generated`, maps the legacy `status` values
// onto the §5.4 lifecycle, and lifts the body `# Citations` list into the
// `sources` frontmatter family. The rules for that live in pi-okf-wiki, which
// is the single source of truth for bundle shape; the app only decides when to
// run it and how to report it.
//
// `planMigration` is the dry run behind the confirmation dialog: `migrateConcept`
// is pure and returns null for an already-current concept, so the plan lists
// exactly the files `migrate` would rewrite — without touching disk.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseDocument } from "pi-okf-wiki/src/frontmatter.ts";
import { migrateConcept, migrateWiki as migrateBundle } from "pi-okf-wiki/src/migrate.ts";
import { loadAllConcepts, wikiPaths, OKF_VERSION } from "pi-okf-wiki/src/wiki.ts";

import { err, ok } from "../shared/result.ts";
import { ConceptStore } from "./concept-store.ts";
import type { MigrationPlan, MigrationReport, Result } from "../shared/ipc-types.ts";

/** `okf_version` declared in the bundle-root `index.md` (OKF §12), or
 *  undefined when there is no index yet or it declares nothing. */
async function declaredVersion(wikiDir: string): Promise<string | undefined> {
  const content = await readFile(join(wikiDir, "index.md"), "utf8").catch(() => null);
  if (content === null) return undefined;
  const raw = parseDocument(content).frontmatter?.raw["okf_version"];
  return typeof raw === "string" ? raw : undefined;
}

export async function planMigration(workspace: string): Promise<Result<MigrationPlan>> {
  const paths = wikiPaths(workspace);
  const concepts = await loadAllConcepts(paths.wiki);
  if (!concepts.success) return err<MigrationPlan>(concepts.error.message, { path: concepts.error.path });

  const conceptIds = concepts.data
    .filter((concept) => migrateConcept(concept) !== null)
    .map((concept) => concept.conceptId)
    .sort();

  return ok({
    conceptIds,
    upToDate: concepts.data.length - conceptIds.length,
    declaredVersion: await declaredVersion(paths.wiki),
    targetVersion: OKF_VERSION,
  });
}

export async function migrateWiki(workspace: string): Promise<Result<MigrationReport>> {
  const result = await migrateBundle(workspace);
  if (!result.success) return err<MigrationReport>(result.error.message, { path: result.error.path });
  const store = new ConceptStore(workspace);
  for (const conceptId of result.data.migrated) {
    const status = await store.setVerified(conceptId, false);
    if (!status.success) return err<MigrationReport>(status.error.message, { path: conceptId });
  }
  return ok({
    migrated: result.data.migrated,
    alreadyCurrent: result.data.alreadyCurrent,
  });
}
