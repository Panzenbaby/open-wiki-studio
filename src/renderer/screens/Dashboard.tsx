import { useAtomValue } from "jotai";
import { ArrowLeftRight, Download, FileText, Play, Trash2 } from "lucide-react";
import { useT } from "../i18n.ts";
import { countsAtom, currentSessionAtom, ingestStateAtom, sessionsAtom, workspaceAtom } from "../store.ts";

interface DashboardProps {
  onAsk: () => void;
  onOpenSession: (path: string) => void;
  onDeleteSession: (path: string) => void;
  onSwitchWorkspace: () => void;
  onBrowser: (folder: "input" | "wiki") => void;
  onIngest: () => void;
  onViewIngest: () => void;
}

export function Dashboard(props: DashboardProps): JSX.Element {
  const t = useT();
  const counts = useAtomValue(countsAtom);
  const workspace = useAtomValue(workspaceAtom);
  const ingestState = useAtomValue(ingestStateAtom);
  const sessions = useAtomValue(sessionsAtom);
  const currentSession = useAtomValue(currentSessionAtom);
  const running = ingestState === "running";
  const inputPending = counts.input > 0;

  const confirmDelete = (path: string, e: React.MouseEvent): void => {
    e.stopPropagation();
    if (!window.confirm(t("session.confirmDelete"))) return;
    props.onDeleteSession(path);
  };

  return (
    <div className="ws pane grow">
      <div className="ws-inner">
        <div className="ws-hero">
          <div>
            <span className="kicker" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".12em", color: "var(--accent)" }}>
              {t("dashboard.kicker", { name: workspace?.name ?? "" })}
            </span>
            <h1 style={{ marginTop: "var(--space-2)" }}>{t("dashboard.title", { name: workspace?.name ?? "" })}</h1>
            <p>{t("dashboard.summary", { wiki: counts.wiki, input: counts.input })}</p>
          </div>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button className="btn btn-primary" style={{ whiteSpace: "nowrap", flexShrink: 0 }} onClick={props.onAsk}>{t("dashboard.newQuestion")}</button>
            <button className="btn btn-ghost" style={{ whiteSpace: "nowrap", flexShrink: 0 }} onClick={props.onSwitchWorkspace}><ArrowLeftRight size={14} /> {t("nav.switchWorkspace")}</button>
          </div>
        </div>

        {(inputPending || running) && (
          <div className="ingest-hero" style={{ border: "1px solid color-mix(in oklab, var(--accent), transparent 40%)", background: "linear-gradient(180deg, color-mix(in oklab, var(--accent), transparent 90%), var(--surface))", borderRadius: "var(--radius-lg)", padding: "var(--space-6)", display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "var(--text-xl)", display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <span className="pulse" /> {running ? t("dashboard.ingestRunning") : t("dashboard.inputWaiting", { n: counts.input })}
              </div>
              <div className="fg2" style={{ marginTop: "var(--space-2)" }}>{running ? t("dashboard.ingestRunningSub") : t("dashboard.ingestHint")}</div>
            </div>
            <div className="row">
              {running ? (
                <button className="btn btn-primary" onClick={props.onViewIngest}>{t("dashboard.viewProgress")}</button>
              ) : (
                <>
                  <button className="btn" onClick={() => props.onBrowser("input")}>{t("dashboard.viewInput")}</button>
                  <button className="btn btn-primary" onClick={props.onIngest}><Play size={14} /> {t("dashboard.runUpdate")}</button>
                </>
              )}
            </div>
          </div>
        )}

        <div className="folder-cards">
          <FolderCard dot="input" onClick={() => props.onBrowser("input")} />
          <FolderCard dot="wiki" onClick={() => props.onBrowser("wiki")} />
        </div>

        <section>
          <div className="side-title" style={{ marginBottom: "var(--space-3)" }}>{t("sidebar.sessions")}</div>
          {sessions.length === 0 ? (
            <div className="muted" style={{ fontSize: "var(--text-sm)" }}>{t("sidebar.noSessions")}</div>
          ) : (
            <div className="recent-sessions">
              {sessions.map((session) => (
                <button
                  key={session.path}
                  className={`rs-item${currentSession?.path === session.path ? " active" : ""}`}
                  style={{ width: "100%", textAlign: "left" }}
                  onClick={() => props.onOpenSession(session.path)}
                >
                  <div>
                    <div className="rs-title">{session.name.length > 60 ? `${session.name.slice(0, 60)}${t("app.ellipsis")}` : session.name}</div>
                    <div className="rs-prev mono">{new Date(session.lastModified).toLocaleString()}</div>
                  </div>
                  <span className="rs-time">{new Date(session.lastModified).toLocaleDateString()}</span>
                  <span
                    className="session-delete-dash"
                    title={t("session.delete")}
                    aria-label={t("session.delete")}
                    onClick={(e) => confirmDelete(session.path, e)}
                  >
                    <Trash2 size={14} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function FolderCard(props: { dot: "input" | "wiki"; onClick: () => void }): JSX.Element {
  const t = useT();
  const counts = useAtomValue(countsAtom);
  const n = props.dot === "input" ? counts.input : counts.wiki;
  const nameKey = props.dot === "input" ? "folder.input.name" : "folder.wiki.name";
  const countKey = props.dot === "input" ? "folder.input.count" : "folder.wiki.count";
  const descKey = props.dot === "input" ? "folder.input.desc" : "folder.wiki.desc";
  return (
    <button type="button" className="folder-card" onClick={props.onClick}>
      <div className="fc-head">
        <div className={`fc-icon ${props.dot}`}>{props.dot === "input" ? <Download size={18} /> : <FileText size={18} />}</div>
        <div>
          <div className="fc-name">{t(nameKey)}</div>
          <div className="fc-count mono">{t(countKey, { n })}</div>
        </div>
      </div>
      <div className="fc-desc">{t(descKey)}</div>
    </button>
  );
}