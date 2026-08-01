// Repository around the extension's removal logic.
//
// The wiki bookkeeping that removal has to keep consistent (trash naming,
// link redirection, index.md regeneration, the log entry) lives in
// pi-okf-wiki, which is the single source of truth for bundle shape. The app
// calls it directly in the main process rather than going through an agent
// turn: removal is deterministic and must not depend on an LLM.
//
// This module is the boundary: extension models stay behind it, the app sees
// only the `RemovalPlan` / `RemovalReport` AppModels from `ipc-types.ts`.
import {
  planRemoval as planRemovalInBundle,
  removeFromWiki as removeFromBundle,
  type RemovalPlan as BundleRemovalPlan,
  type RemovalReport as BundleRemovalReport,
} from "pi-okf-wiki/src/remove.ts";

import { err, ok } from "../shared/result.ts";
import { mainT } from "./i18n.ts";
import type { RemovalPlan, RemovalReport, Result } from "../shared/ipc-types.ts";

function toRemovalPlan(plan: BundleRemovalPlan): RemovalPlan {
  return {
    conceptIds: plan.conceptIds,
    directories: plan.directories,
    incomingLinks: plan.incomingLinks.map((link) => ({
      fromConceptId: link.fromConceptId,
      toConceptId: link.toConceptId,
    })),
  };
}

function toRemovalReport(report: BundleRemovalReport): RemovalReport {
  return {
    removed: report.removed.map((entry) => ({
      conceptId: entry.conceptId,
      trashPath: entry.trashPath,
    })),
    removedDirectories: report.removedDirectories,
    rewrittenConcepts: report.rewrittenConcepts,
  };
}

export async function planRemoval(
  workspace: string,
  relativePath: string,
): Promise<Result<RemovalPlan>> {
  const result = await planRemovalInBundle(workspace, relativePath);
  if (!result.success) return err<RemovalPlan>(result.error.message, { path: result.error.path });
  return ok(toRemovalPlan(result.data));
}

export async function removeFromWiki(
  workspace: string,
  relativePath: string,
): Promise<Result<RemovalReport>> {
  const result = await removeFromBundle(workspace, relativePath);
  if (!result.success) {
    return err<RemovalReport>(
      mainT("error.removeFromWiki", { detail: result.error.message }),
      { path: result.error.path },
    );
  }
  return ok(toRemovalReport(result.data));
}
