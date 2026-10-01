// Pure data shaping for the dashboard: wiki listing → overview numbers, and
// the small formatters the dashboard cards display (file sizes, file types,
// session times). Kept free of React so it is unit-testable.
import type { I18nParams, Locale } from "../shared/i18n.ts";
import type { FileNode, IngestSummary } from "../shared/ipc-types.ts";
import type { IngestState, WikiOverview } from "./store.ts";

type Translate = (key: string, params?: I18nParams) => string;

/** Matches the extracted-text sidecars pi-okf-wiki archives next to an
 *  original (`<stem>-extracted.txt`, `…-extracted.part01.txt`, optionally
 *  collision-stamped). They are derived artifacts, not source files. */
const EXTRACTED_TEXT_RE = /-extracted(?:\.part\d+)?(?:\.\d{4}-\d{2}-\d{2}-\d{4}(?:\.\d+)?)?\.txt$/;

/** Count concepts, verified concepts, and archived source files in a wiki
 *  listing. Only concepts carry a `verified` flag (see `listFolder`). */
export function summarizeWikiListing(nodes: readonly FileNode[]): WikiOverview {
  let concepts = 0;
  let verified = 0;
  let sourceFiles = 0;
  for (const node of nodes) {
    if (node.verified !== undefined) {
      concepts += 1;
      if (node.verified) verified += 1;
    } else if (node.relativePath.startsWith("archive/") && !EXTRACTED_TEXT_RE.test(node.name)) {
      sourceFiles += 1;
    }
  }
  return { concepts, verified, sourceFiles };
}

const KILOBYTE = 1024;
const MEGABYTE = KILOBYTE * 1024;
const GIGABYTE = MEGABYTE * 1024;

/** Human-readable file size: whole kilobytes, one decimal from megabytes up. */
export function formatFileSize(bytes: number, locale: Locale, t: Translate): string {
  if (bytes < KILOBYTE) return t("size.bytes", { n: bytes });
  if (bytes < MEGABYTE) return t("size.kilobytes", { n: Math.round(bytes / KILOBYTE) });
  const decimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  if (bytes < GIGABYTE) return t("size.megabytes", { n: decimal.format(bytes / MEGABYTE) });
  return t("size.gigabytes", { n: decimal.format(bytes / GIGABYTE) });
}

/** Short type badge for a file name: the upper-case extension, or `null` when
 *  the name has none. */
export function fileTypeLabel(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toUpperCase().slice(0, 4);
}

function isSameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/** Compact "last active" label: the time for today, "Yesterday" for
 *  yesterday, otherwise day and month. Empty for an unparsable date. */
export function formatSessionTime(iso: string, now: Date, locale: Locale, t: Translate): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (isSameDay(date, now)) {
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return t("time.yesterday");
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit" }).format(date);
}

/** Which face the dashboard's ingest card shows; `hidden` when there is
 *  nothing to say. */
export type IngestCardMode = "running" | "done" | "error" | "pending" | "hidden";

/** Pick the ingest card face. A run counts as running until its summary
 *  arrives: `agent_end` can flip the state to `done` a moment before the
 *  summary — or before the no-progress check turns the run into an error. */
export function ingestCardMode(
  state: IngestState,
  summary: IngestSummary | null,
  error: string | null,
  pendingFiles: number,
): IngestCardMode {
  if (state === "running" || (state === "done" && summary === null && error === null)) return "running";
  if (state === "done" && summary !== null) return "done";
  if (error !== null) return "error";
  if (pendingFiles > 0) return "pending";
  return "hidden";
}
