import { useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { ArrowLeftRight, ArrowUpCircle, Download, FileText, Merge, Play, Trash2 } from "lucide-react";
import { api } from "../ipc.ts";
import { useT } from "../i18n.ts";
import { MergeWorkspacesModal } from "../components/MergeWorkspacesModal.tsx";
import { MigrateWikiModal } from "../components/MigrateWikiModal.tsx";
import { ConfirmModal } from "../components/ConfirmModal.tsx";
import { countsAtom, currentSessionAtom, folderVersionAtom, ingestStateAtom, toastAtom, visibleSessionsAtom, workspaceAtom } from "../store.ts";
import type { MigrationPlan } from "../../shared/ipc-types.ts";

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
  const sessions = useAtomValue(visibleSessionsAtom);
  const currentSession = useAtomValue(currentSessionAtom);
  const folderVersion = useAtomValue(folderVersionAtom);
  const setToast = useSetAtom(toastAtom);
  const [merging, setMerging] = useState<boolean>(false);
  const [migrationPlan, setMigrationPlan] = useState<MigrationPlan | null>(null);
  const [migrateOpen, setMigrateOpen] = useState<boolean>(false);
  const [migrating, setMigrating] = useState<boolean>(false);
  const [deletingSessionPath, setDeletingSessionPath] = useState<string | null>(null);
  const running = ingestState === "running";
  const inputPending = counts.input > 0;
  const showIngest = inputPending || running;
  const summaryKey = showIngest ? "dashboard.summaryShort" : "dashboard.summary";

  // Re-checked whenever the wiki changes on disk: an ingest can add concepts,
  // and a merge can pull legacy ones in from another workspace.
  useEffect(() => {
    void (async () => {
      const result = await api.planMigration();
      setMigrationPlan(result.success ? result.data : null);
    })();
  }, [folderVersion.wiki]);

  const legacyConcepts = migrationPlan?.conceptIds.length ?? 0;

  const confirmMigration = async (): Promise<void> => {
    setMigrating(true);
    const result = await api.migrateWiki();
    setMigrating(false);
    if (!result.success) {
      setToast({ message: t("migrate.failed", { detail: result.error.message }), kind: "warning" });
      return;
    }
    setMigrateOpen(false);
    setMigrationPlan(null);
    setToast({ message: t("migrate.done", { n: result.data.migrated.length }), kind: "info" });
  };

  const confirmDelete = (path: string, e: React.MouseEvent): void => {
    e.stopPropagation();
    setDeletingSessionPath(path);
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
            <p>{t(summaryKey, showIngest ? { wiki: counts.wiki } : { wiki: counts.wiki, input: counts.input })}</p>
          </div>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button className="btn btn-primary" style={{ whiteSpace: "nowrap", flexShrink: 0 }} onClick={props.onAsk}>{t("dashboard.newQuestion")}</button>
            <button className="btn btn-ghost" style={{ whiteSpace: "nowrap", flexShrink: 0 }} onClick={props.onSwitchWorkspace}><ArrowLeftRight size={14} /> {t("nav.switchWorkspace")}</button>
            {/* A merge copies the wiki as it is on disk — refuse while an ingest
                is rewriting it. */}
            <button className="btn btn-ghost" style={{ whiteSpace: "nowrap", flexShrink: 0 }} disabled={running} onClick={() => setMerging(true)}><Merge size={14} /> {t("merge.action")}</button>
          </div>
        </div>

        {legacyConcepts > 0 && (
          <div
            className="migrate-hero"
            style={{
              border: "1px solid color-mix(in oklab, var(--warn), transparent 55%)",
              background: "color-mix(in oklab, var(--warn), transparent 92%)",
              borderRadius: "var(--radius-lg)",
              padding: "var(--space-6)",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-6)",
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "var(--text-xl)" }}>
                {t("migrate.bannerTitle", { version: migrationPlan?.targetVersion ?? "" })}
              </div>
              <div className="fg2" style={{ marginTop: "var(--space-2)" }}>
                {t("migrate.bannerSub", { n: legacyConcepts })}
              </div>
            </div>
            {/* A migration rewrites the wiki as it is on disk — refuse while an
                ingest is writing to it. */}
            <button className="btn btn-primary" disabled={running} onClick={() => setMigrateOpen(true)}>
              <ArrowUpCircle size={14} /> {t("migrate.action")}
            </button>
          </div>
        )}

        {showIngest && (
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

        <div className={`folder-cards${showIngest ? " single" : ""}`}>
          {!showIngest && <FolderCard dot="input" onClick={() => props.onBrowser("input")} />}
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
      {merging && <MergeWorkspacesModal onClose={() => setMerging(false)} />}
      {migrateOpen && migrationPlan && (
        <MigrateWikiModal
          plan={migrationPlan}
          busy={migrating}
          onConfirm={() => void confirmMigration()}
          onCancel={() => setMigrateOpen(false)}
        />
      )}
      {deletingSessionPath && (
        <ConfirmModal
          title={t("session.delete")}
          description={t("session.confirmDelete")}
          confirmLabel={t("session.delete")}
          cancelLabel={t("remove.cancel")}
          icon={<Trash2 size={14} />}
          onConfirm={() => {
            props.onDeleteSession(deletingSessionPath);
            setDeletingSessionPath(null);
          }}
          onCancel={() => setDeletingSessionPath(null)}
        />
      )}
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