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

  const askDelete = (path: string): void => {
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
          <li key={session.path} className="session-row">
            <button
              type="button"
              className={`session-item${current?.path === session.path ? " active" : ""}`}
              onClick={() => openSession(session.path)}
            >
              <span className="s-content">
                <span className="s-title">{session.name}</span>
                <span className="s-meta">{new Date(session.lastModified).toLocaleString()}</span>
              </span>
            </button>
            <span className="session-row-actions">
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
              <button
                type="button"
                className="session-delete-dash"
                title={t("session.delete")}
                aria-label={t("session.delete")}
                onClick={() => askDelete(session.path)}
              >
                <Trash2 size={14} />
              </button>
            </span>
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