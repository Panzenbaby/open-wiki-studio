// Shared reporting for "add files" results (drag-and-drop + OS dialog).
// Decides between a transient toast (success / skip-with-adds / empty) and a
// manual-acknowledge modal (failures, or a pure no-op where everything was
// skipped) per the agreed trigger rules. The modal itself is rendered by
// AppShell from `addFilesSummaryAtom`; this helper only feeds the atoms.
import type { Result, AddFilesSummary } from "../shared/ipc-types.ts";
import type { I18nParams } from "../shared/i18n.ts";

type ToastSetter = (toast: { message: string; kind: "info" | "error" } | null) => void;
type SummarySetter = (summary: AddFilesSummary | null) => void;

/** Apply the trigger rules to an `addInputFiles`/`addInputFilesDialog` result.
 *  Returns the summary on success (so callers can refresh their own views),
 *  or `null` on a hard IPC failure (already surfaced as an error toast). */
export function reportAddFilesResult(
  result: Result<AddFilesSummary>,
  deps: { setToast: ToastSetter; setSummary: SummarySetter; t: (key: string, params?: I18nParams) => string },
): AddFilesSummary | null {
  if (!result.success) {
    deps.setToast({ message: result.error.message, kind: "error" });
    return null;
  }
  const summary = result.data;
  const { added, skipped, failed } = summary;

  // Failures → modal (user wants to inspect what went wrong).
  if (failed.length > 0) {
    deps.setSummary(summary);
    return summary;
  }
  // Pure no-op where everything was skipped → modal so the user sees why
  // nothing landed. (Empty drops — all buckets zero — fall through to the
  // toast branch below instead; nothing to inspect there.)
  if (added.length === 0 && skipped.length > 0) {
    deps.setSummary(summary);
    return summary;
  }
  // Success-ish paths → toast. This also covers the all-zero empty-drop case
  // (e.g. an empty folder, or only dotfiles/symlinks encountered).
  if (added.length === 0 && skipped.length === 0) {
    deps.setToast({ message: deps.t("addFiles.toastEmpty"), kind: "info" });
    return summary;
  }
  if (skipped.length > 0) {
    deps.setToast({
      message: deps.t("addFiles.toastAddedSkipped", { n: added.length, m: skipped.length }),
      kind: "info",
    });
    return summary;
  }
  deps.setToast({ message: deps.t("browser.dropAdded", { n: added.length }), kind: "info" });
  return summary;
}