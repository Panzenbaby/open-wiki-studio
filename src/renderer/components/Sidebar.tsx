import { useAtom, useAtomValue } from "jotai";
import { Plus, Trash2 } from "lucide-react";
import { useT } from "../i18n.ts";
import { currentSessionAtom, sessionsAtom } from "../store.ts";

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
  const sessions = useAtomValue(sessionsAtom);
  const [current] = useAtom(currentSessionAtom);

  const openSession = (path: string): void => {
    props.onOpenSession(path);
    props.onAfterSelect?.();
  };

  const newSession = (): void => {
    props.onNewSession();
    props.onAfterSelect?.();
  };

  const confirmDelete = (path: string, e: React.MouseEvent): void => {
    e.stopPropagation();
    if (!window.confirm(t("session.confirmDelete"))) return;
    props.onDeleteSession(path);
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
          <li
            key={session.path}
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
            <span
              className="session-delete-dash"
              role="button"
              tabIndex={0}
              title={t("session.delete")}
              aria-label={t("session.delete")}
              onClick={(e) => confirmDelete(session.path, e)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); confirmDelete(session.path, e as unknown as React.MouseEvent); } }}
            >
              <Trash2 size={14} />
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}