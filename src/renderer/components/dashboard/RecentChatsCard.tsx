import { useAtomValue, useSetAtom } from "jotai";
import { localeAtom, useT } from "../../i18n.ts";
import { useNavigation } from "../../navigation.ts";
import { formatSessionTime } from "../../dashboard-data.ts";
import { sidebarOpenAtom, streamingSessionsAtom, visibleSessionsAtom } from "../../store.ts";
import { CardHeader } from "./CardHeader.tsx";
import { TextLink } from "./TextLink.tsx";

/** How many sessions the card lists; the chat sidebar has the full list. */
const MAX_RECENT_CHATS = 4;

interface RecentChatsCardProps {
  onOpenSession: (path: string) => void;
}

/** The most recently active chat sessions with a preview of their answer. */
export function RecentChatsCard(props: RecentChatsCardProps): JSX.Element {
  const t = useT();
  const locale = useAtomValue(localeAtom);
  const sessions = useAtomValue(visibleSessionsAtom);
  const streamingSessions = useAtomValue(streamingSessionsAtom);
  const setSidebarOpen = useSetAtom(sidebarOpenAtom);
  const { showView } = useNavigation();
  const now = new Date();

  const showAll = (): void => {
    // On narrow windows the session list is a drawer — open it right away.
    setSidebarOpen(true);
    showView("chat");
  };

  return (
    <section className="dash-card dash-card-compact" aria-labelledby="dashboard-chats-title">
      <CardHeader
        titleId="dashboard-chats-title"
        title={t("dashboard.chats.title")}
        action={<TextLink label={t("dashboard.chats.all")} ariaLabel={t("dashboard.chats.allLabel")} onClick={showAll} />}
      />
      {sessions.length === 0 ? (
        <p className="dash-sub">{t("dashboard.chats.empty")}</p>
      ) : (
        <ul className="chat-list">
          {sessions.slice(0, MAX_RECENT_CHATS).map((session) => {
            const streaming = session.streaming || streamingSessions.has(session.path);
            return (
              <li key={session.path}>
                <button type="button" className="chat-item" onClick={() => props.onOpenSession(session.path)}>
                  <span className="chat-item-top">
                    <span className="chat-item-title">{session.name}</span>
                    <span className="chat-item-time">
                      {streaming && (
                        <span className="session-streaming" title={t("session.streaming")}>
                          <span className="stream-dot" aria-hidden="true" />
                          <span className="sr-only">{t("session.streaming")}</span>
                        </span>
                      )}
                      {formatSessionTime(session.lastModified, now, locale, t)}
                    </span>
                  </span>
                  <span className="chat-item-preview">{session.preview || t("dashboard.chats.noPreview")}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
