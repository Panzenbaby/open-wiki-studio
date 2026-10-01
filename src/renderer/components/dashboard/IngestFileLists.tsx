import { useAtomValue } from "jotai";
import { CircleCheck, CircleX } from "lucide-react";
import { localeAtom, useT } from "../../i18n.ts";
import { fileTypeLabel, formatFileSize } from "../../dashboard-data.ts";
import { pluralKey, type I18nParams } from "../../../shared/i18n.ts";
import type { FileNode, IngestFileResult } from "../../../shared/ipc-types.ts";

/** How many rows a list shows before collapsing the rest into "+ n more". */
const MAX_LISTED_FILES = 6;

function MoreRow(props: { hidden: number }): JSX.Element | null {
  const t = useT();
  if (props.hidden <= 0) return null;
  return <li className="file-row file-row-more">{t("dashboard.ingest.moreFiles", { n: props.hidden })}</li>;
}

/** Files waiting in input/: type badge, path, size. */
export function PendingFileList(props: { files: readonly FileNode[] }): JSX.Element | null {
  const t = useT();
  const locale = useAtomValue(localeAtom);
  if (props.files.length === 0) return null;
  const listed = props.files.slice(0, MAX_LISTED_FILES);
  return (
    <ul className="file-list">
      {listed.map((file) => (
        <li key={file.relativePath} className="file-row">
          <span className="file-type">{fileTypeLabel(file.name) ?? t("dashboard.fileTypeUnknown")}</span>
          <span className="file-name" title={file.relativePath}>{file.relativePath}</span>
          {file.size !== undefined && <span className="file-size">{formatFileSize(file.size, locale, t)}</span>}
        </li>
      ))}
      <MoreRow hidden={props.files.length - listed.length} />
    </ul>
  );
}

/** What an ingested file produced, e.g. "3 concepts created". */
function resultDetail(result: IngestFileResult, t: (key: string, params?: I18nParams) => string): string {
  if (result.updatedConcepts > 0) {
    return t("dashboard.ingest.fileConcepts", { created: result.createdConcepts, updated: result.updatedConcepts });
  }
  if (result.createdConcepts > 0) {
    return t(pluralKey("dashboard.ingest.fileCreated", result.createdConcepts), { n: result.createdConcepts });
  }
  return t("dashboard.ingest.fileIngested");
}

interface IngestResultListProps {
  files: readonly IngestFileResult[];
  onRetry: () => void;
}

/** Per-file outcome of the last run. Files that were not ingested offer a
 *  retry, which starts a new run over everything still in input/. */
export function IngestResultList(props: IngestResultListProps): JSX.Element | null {
  const t = useT();
  if (props.files.length === 0) return null;
  const listed = props.files.slice(0, MAX_LISTED_FILES);
  return (
    <ul className="file-list">
      {listed.map((result) =>
        result.status === "processed" ? (
          <li key={result.relativePath} className="file-row">
            <span className="file-status">
              <CircleCheck size={18} role="img" aria-label={t("dashboard.ingest.fileSucceeded")} />
            </span>
            <span className="file-name" title={result.relativePath}>{result.relativePath}</span>
            <span className="file-detail">{resultDetail(result, t)}</span>
          </li>
        ) : (
          <li key={result.relativePath} className="file-row">
            <span className="file-status is-failed">
              <CircleX size={18} role="img" aria-label={t("dashboard.ingest.fileFailed")} />
            </span>
            <span className="file-name-stack">
              <span className="file-name" title={result.relativePath}>{result.relativePath}</span>
              <span className="file-error">{t("dashboard.ingest.fileLeftover")}</span>
            </span>
            <button type="button" className="btn btn-soft-danger" onClick={props.onRetry}>
              {t("dashboard.ingest.retry")}
            </button>
          </li>
        ),
      )}
      <MoreRow hidden={props.files.length - listed.length} />
    </ul>
  );
}
