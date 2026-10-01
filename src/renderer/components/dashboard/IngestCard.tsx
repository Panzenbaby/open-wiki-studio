import type { ReactNode } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { ArrowRight, CircleCheck, CircleX, Eye, FileText, RefreshCw, RotateCw, TriangleAlert } from "lucide-react";
import { useT } from "../../i18n.ts";
import { useIngestActions } from "../../ingest-actions.ts";
import { useNavigation } from "../../navigation.ts";
import { ingestCardMode, type IngestCardMode } from "../../dashboard-data.ts";
import { countsAtom, ingestErrorAtom, ingestStateAtom, ingestSummaryAtom, inputFilesAtom } from "../../store.ts";
import { pluralKey } from "../../../shared/i18n.ts";
import { IconTile, type Tone } from "./IconTile.tsx";
import { IngestResultList, PendingFileList } from "./IngestFileLists.tsx";

const TITLE_ID = "dashboard-ingest-title";

const MODE_TONE: Record<Exclude<IngestCardMode, "hidden">, Tone> = {
  running: "info",
  done: "success",
  error: "danger",
  pending: "warn",
};

interface IngestHeadProps {
  tone: Tone;
  icon: ReactNode;
  label: string;
  title: string;
  sub: string;
  actions?: ReactNode;
}

/** Icon tile, label, heading, and explanation of one card face. */
function IngestHead(props: IngestHeadProps): JSX.Element {
  return (
    <div className="ingest-head">
      <IconTile tone={props.tone}>{props.icon}</IconTile>
      <div className="ingest-head-text">
        <span className="dash-eyebrow">{props.label}</span>
        <h2 id={TITLE_ID}>{props.title}</h2>
        <p className="dash-sub">{props.sub}</p>
      </div>
      {props.actions && <div className="ingest-actions">{props.actions}</div>}
    </div>
  );
}

/** Ingest status on the dashboard: pending files, a running /wiki-update,
 *  the per-file result of the last run, or the error it ended with. */
export function IngestCard(): JSX.Element {
  const t = useT();
  const state = useAtomValue(ingestStateAtom);
  const summary = useAtomValue(ingestSummaryAtom);
  const error = useAtomValue(ingestErrorAtom);
  const counts = useAtomValue(countsAtom);
  const inputFiles = useAtomValue(inputFilesAtom);
  const setIngestState = useSetAtom(ingestStateAtom);
  const setIngestError = useSetAtom(ingestErrorAtom);
  const { startIngest } = useIngestActions();
  const { showBrowser, showView } = useNavigation();
  const mode = ingestCardMode(state, summary, error, counts.input);
  const start = (): void => void startIngest();

  let face: JSX.Element | null = null;
  let announcement = "";

  if (mode === "pending") {
    const title = t(pluralKey("dashboard.ingest.pendingTitle", counts.input), { n: counts.input });
    announcement = title;
    face = (
      <>
        <IngestHead
          tone="warn"
          icon={<TriangleAlert size={26} strokeWidth={1.75} />}
          label={t("dashboard.ingest.label")}
          title={title}
          sub={t("dashboard.ingest.pendingSub")}
          actions={
            <>
              <button type="button" className="btn btn-lg btn-outline" onClick={() => showBrowser("input")}>
                <Eye size={16} strokeWidth={1.75} aria-hidden="true" /> {t("dashboard.ingest.view")}
              </button>
              <button type="button" className="btn btn-lg btn-primary" onClick={start}>
                <RotateCw size={16} aria-hidden="true" /> {t("dashboard.ingest.start")}
              </button>
            </>
          }
        />
        <PendingFileList files={inputFiles} />
      </>
    );
  } else if (mode === "running") {
    const title = t("dashboard.ingest.runningTitle");
    announcement = title;
    face = (
      <>
        <IngestHead
          tone="info"
          icon={<RefreshCw size={26} strokeWidth={1.75} />}
          label={t("dashboard.ingest.label")}
          title={title}
          sub={t("dashboard.ingest.runningSub")}
          actions={
            <button type="button" className="btn btn-lg btn-outline" onClick={() => showView("ingest")}>
              <FileText size={16} strokeWidth={1.75} aria-hidden="true" /> {t("dashboard.ingest.viewLog")}
            </button>
          }
        />
        <div className="progress-indeterminate" role="progressbar" aria-labelledby={TITLE_ID}>
          <span />
        </div>
      </>
    );
  } else if (mode === "done" && summary) {
    const processed = summary.files.filter((file) => file.status === "processed").length;
    const failed = summary.files.length - processed;
    const created = summary.createdConcepts.length;
    const updated = summary.updatedConcepts.length;
    const title = failed > 0
      ? t("dashboard.ingest.doneTitle", { ok: processed, failed })
      : t("dashboard.ingest.doneTitleAllOk", { ok: processed });
    const sub = created + updated === 0
      ? t("dashboard.ingest.doneSubNone")
      : updated > 0
        ? t("dashboard.ingest.doneSubWithUpdated", { created, updated })
        : t(pluralKey("dashboard.ingest.doneSub", created), { created });
    announcement = `${t("dashboard.ingest.doneLabel")}: ${title}`;
    face = (
      <>
        <IngestHead
          tone="success"
          icon={<CircleCheck size={26} strokeWidth={1.75} />}
          label={t("dashboard.ingest.doneLabel")}
          title={title}
          sub={sub}
          actions={
            <>
              {/* Back to idle: the summary stays for the ingest log. */}
              <button type="button" className="btn btn-lg btn-quiet" onClick={() => setIngestState("idle")}>
                {t("dashboard.ingest.dismiss")}
              </button>
              {created + updated > 0 && (
                <button type="button" className="btn btn-lg btn-neutral" onClick={() => showBrowser("wiki")}>
                  {t("dashboard.ingest.review")} <ArrowRight size={16} aria-hidden="true" />
                </button>
              )}
            </>
          }
        />
        <IngestResultList files={summary.files} onRetry={start} />
      </>
    );
  } else if (mode === "error" && error !== null) {
    const title = t("dashboard.ingest.errorTitle");
    announcement = `${t("dashboard.ingest.errorLabel")}: ${title}`;
    face = (
      <>
        <IngestHead
          tone="danger"
          icon={<CircleX size={26} strokeWidth={1.75} />}
          label={t("dashboard.ingest.errorLabel")}
          title={title}
          sub={error}
          actions={
            <>
              <button type="button" className="btn btn-lg btn-quiet" onClick={() => setIngestError(null)}>
                {t("dashboard.ingest.dismiss")}
              </button>
              <button type="button" className="btn btn-lg btn-outline" onClick={() => showView("ingest")}>
                {t("dashboard.ingest.details")}
              </button>
              {counts.input > 0 && (
                <button type="button" className="btn btn-lg btn-primary" onClick={start}>
                  <RotateCw size={16} aria-hidden="true" /> {t("dashboard.ingest.retry")}
                </button>
              )}
            </>
          }
        />
        <PendingFileList files={inputFiles} />
      </>
    );
  }

  return (
    <>
      {/* Stable live region: the card faces replace each other, so the
          announcement must live outside them to be read reliably. */}
      <p className="sr-only" aria-live="polite">{announcement}</p>
      {face && mode !== "hidden" && (
        <section className={`dash-card ingest-card tone-${MODE_TONE[mode]}`} aria-labelledby={TITLE_ID}>
          {face}
        </section>
      )}
    </>
  );
}
