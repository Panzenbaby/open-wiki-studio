import { useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { Plus, Trash2 } from "lucide-react";
import { useT } from "../i18n.ts";
import { ConfirmModal } from "./ConfirmModal.tsx";
import { currentSessionAtom, streamingSessionsAtom, visibleSessionsAtom } from "../store.ts";

interface SidebarProps {
  onOpenSession: (path: string) => void;
  onNewSession: () => void;
  onDeleteSession: (path: string) => void;
  /** Called after any selection (open or new) — used to auto-close the mobile drawer. */
  onAfterSelect?: () => void;
  /** Mobile drawer open state (only affects narrow screens via CSS). */
  open?: boolean;
}

export function Sidebar(props: SidebarProps): JSX.Element {
  const t = useT();
  const sessions = useAtomValue(visibleSessionsAtom);
  const streamingSessions = useAtomValue(streamingSessionsAtom);
  const [current] = useAtom(currentSessionAtom);
  const [pendingDeletePath, setPendingDeletePath] = useState<string | null>(null);

  const openSession = (path: string): void => {
    props.onOpenSession(path);
    props.onAfterSelect?.();
  };

  const newSession = (): void => {
    props.onNewSession();
    props.onAfterSelect?.();
  };

  const askDelete = (path: string, e: React.SyntheticEvent): void => {
    e.stopPropagation();
    setPendingDeletePath(path);
  };

  const confirmDelete = (): void => {
    if (pendingDeletePath === null) return;
    props.onDeleteSession(pendingDeletePath);
    setPendingDeletePath(null);
  };

  return (
    <aside className={`sidebar${props.open ? " open" : ""}`}>
      <div className="side-head">
        <button className="btn btn-primary btn-sm" style={{ width: "100%", justifyContent: "center" }} onClick={newSession}>
          <Plus size={14} /> {t("sidebar.newQuestion")}
        </button>
      </div>
      <div className="side-head">
        <div className="side-title">{t("sidebar.sessions")}</div>
      </div>
      <ul className="session-list">
        {sessions.length === 0 && (
          <li className="muted" style={{ padding: "var(--space-3)", fontSize: "var(--text-xs)" }}>{t("sidebar.noSessions")}</li>
        )}
        {sessions.map((session) => (
          <li key={session.path}>
            <div
              className={`session-item${current?.path === session.path ? " active" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => openSession(session.path)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openSession(session.path);
                }
              }}
            >
              <div className="s-content">
                <div className="s-title">{session.name}</div>
                <div className="s-meta">{new Date(session.lastModified).toLocaleString()}</div>
              </div>
              {streamingSessions.has(session.path) && (
                <span
                  className="session-streaming"
                  role="status"
                  aria-label={t("session.streaming")}
                  title={t("session.streaming")}
                >
                  <span className="stream-dot" />
                </span>
              )}
              <span
                className="session-delete-dash"
                role="button"
                tabIndex={0}
                title={t("session.delete")}
                aria-label={t("session.delete")}
                onClick={(e) => askDelete(session.path, e)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); askDelete(session.path, e); } }}
              >
                <Trash2 size={14} />
              </span>
            </div>
          </li>
        ))}
      </ul>
      {pendingDeletePath !== null && (
        <ConfirmModal
          title={t("session.confirmDeleteTitle")}
          message={t("session.confirmDelete")}
          confirmLabel={t("session.delete")}
          cancelLabel={t("action.cancel")}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDeletePath(null)}
        />
      )}
    </aside>
  );
}