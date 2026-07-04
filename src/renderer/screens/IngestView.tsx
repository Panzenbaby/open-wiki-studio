import { useAtomValue } from "jotai";
import { Play } from "lucide-react";
import { useT } from "../i18n.ts";
import { countsAtom, ingestStateAtom, ingestStreamAtom, ingestSummaryAtom, ingestErrorAtom } from "../store.ts";

interface IngestViewProps {
  /** Trigger a new /wiki-update run (resets state, calls the IPC, surfaces errors). */
  onRun: () => void;
}

export function IngestView(props: IngestViewProps): JSX.Element {
  const t = useT();
  const state = useAtomValue(ingestStateAtom);
  const stream = useAtomValue(ingestStreamAtom);
  const summary = useAtomValue(ingestSummaryAtom);
  const error = useAtomValue(ingestErrorAtom);
  const counts = useAtomValue(countsAtom);
  const hasInput = counts.input > 0;

  const stateLabel =
    state === "running" ? t("ingest.stateRunning") : state === "done" ? t("ingest.stateDone") : t("ingest.stateIdle");

  return (
    <section className="chat">
      <div className="chat-head">
        <div>
          <div className="h-title">{t("ingest.title")}</div>
          <div className="h-sub">{stateLabel}</div>
        </div>
        {state !== "running" && hasInput && (
          <button className="btn btn-primary" onClick={props.onRun}>
            <Play size={14} /> {t("ingest.run")}
          </button>
        )}
      </div>
      <div className="chat-stream">
        <div className="thread">
          <div className="msg msg-agent">
            <div className="avatar">{t("app.avatar")}</div>
            <div className="bubble">
              <div className="role">{t("chat.roleAgent")}</div>
              <div className="content">
                {error && (
                  <div className="ingest-error" style={{ color: "var(--danger, #e06c75)", whiteSpace: "pre-wrap", marginBottom: "var(--space-3)" }}>
                    {t("ingest.errorPrefix")}: {error}
                  </div>
                )}
                {state === "idle" && !error && t("ingest.ready")}
                {state === "running" && (
                  <div>
                    <div className="ingest-progress" style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-3)", color: "var(--accent)" }}>
                      <span className="pulse" />
                      <span style={{ fontWeight: 600 }}>{t("ingest.processing", { n: counts.input })}</span>
                    </div>
                    <div className="fg2" style={{ fontSize: "var(--text-sm)", marginBottom: "var(--space-3)" }}>{t("ingest.processingSub")}</div>
                    {stream && (
                      <div className="caret-blink" style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }}>{stream}</div>
                    )}
                  </div>
                )}
                {state === "done" && (stream || t("ingest.done"))}
              </div>
            </div>
          </div>

          {summary && (
            <div className="ingest-summary" style={{ marginTop: "var(--space-4)" }}>
              <div className="stat ok"><div className="s-val">{summary.createdConcepts.length}</div><div className="s-lbl">{t("ingest.created")}</div></div>
              <div className="stat"><div className="s-val">{summary.updatedConcepts.length}</div><div className="s-lbl">{t("ingest.updated")}</div></div>
              <div className="stat warn"><div className="s-val">{summary.leftover.length}</div><div className="s-lbl">{t("ingest.leftover")}</div></div>
              <div className="stat mute"><div className="s-val">{summary.wikiConceptCountAfter}</div><div className="s-lbl">{t("ingest.wikiSize")}</div></div>
            </div>
          )}

          {summary && summary.createdConcepts.length > 0 && (
            <ul className="log-list">
              {summary.createdConcepts.map((id) => (
                <li key={id} className="log-row ok"><span className="lr-tag">{t("ingest.created")}</span><span className="lr-file">{id}</span></li>
              ))}
            </ul>
          )}
          {summary && summary.leftover.length > 0 && (
            <ul className="log-list">
              {summary.leftover.map((path) => (
                <li key={path} className="log-row ignore"><span className="lr-tag">{t("ingest.leftover")}</span><span className="lr-file">{path}</span></li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}