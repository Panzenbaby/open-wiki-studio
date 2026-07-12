import { Fragment, useEffect, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Menu as MenuIcon, Settings as SettingsIcon, X as CloseIcon } from "lucide-react";
import { api } from "../ipc.ts";
import { useT } from "../i18n.ts";
import {
  browserFolderAtom,
  browserModeAtom,
  chatErrorAtom,
  chatStreamingAtom,
  chatTurnEndedAtom,
  countsAtom,
  currentSessionAtom,
  ingestErrorAtom,
  ingestStateAtom,
  ingestStreamAtom,
  ingestSummaryAtom,
  messagesAtom,
  screenAtom,
  sessionsAtom,
  sidebarOpenAtom,
  streamingSessionsAtom,
  toastAtom,
  viewAtom,
  workspaceAtom,
} from "../store.ts";
import type { SessionInfo } from "../../shared/ipc-types.ts";
import { Sidebar } from "./Sidebar.tsx";
import { Dashboard } from "../screens/Dashboard.tsx";
import { Chat } from "../screens/Chat.tsx";
import { Browser } from "../screens/Browser.tsx";
import { IngestView } from "../screens/IngestView.tsx";
import { Settings } from "../screens/Settings.tsx";
import { IngestBar } from "./IngestBar.tsx";
import { UpdateBadge } from "./UpdateBadge.tsx";

export function AppShell(): JSX.Element {
  const t = useT();
  const workspace = useAtomValue(workspaceAtom);
  const [view, setView] = useAtom(viewAtom);
  const setCounts = useSetAtom(countsAtom);
  const setSessions = useSetAtom(sessionsAtom);
  const [currentSession, setCurrentSession] = useAtom(currentSessionAtom);
  const setMessages = useSetAtom(messagesAtom);
  const messages = useAtomValue(messagesAtom);
  const ingestState = useAtomValue(ingestStateAtom);
  const ingestSummary = useAtomValue(ingestSummaryAtom);
  const setIngestError = useSetAtom(ingestErrorAtom);
  const setIngestState = useSetAtom(ingestStateAtom);
  const setIngestStream = useSetAtom(ingestStreamAtom);
  const setIngestSummary = useSetAtom(ingestSummaryAtom);
  const setScreen = useSetAtom(screenAtom);
  const setBrowserFolder = useSetAtom(browserFolderAtom);
  const setBrowserMode = useSetAtom(browserModeAtom);
  const setChatStreaming = useSetAtom(chatStreamingAtom);
  const setChatError = useSetAtom(chatErrorAtom);
  const setStreamingSessions = useSetAtom(streamingSessionsAtom);
  const turnEnded = useAtomValue(chatTurnEndedAtom);
  const [sidebarOpen, setSidebarOpen] = useAtom(sidebarOpenAtom);
  const setToast = useSetAtom(toastAtom);
  const [dragOver, setDragOver] = useState<boolean>(false);

  /**
   * Drop external files anywhere in the app → copy them into `input/`.
   * Reuses the existing `addInputFiles` IPC handler. Always targets `input/`,
   * regardless of which view is currently active.
   */
  async function handleDropFiles(fileList: FileList | null): Promise<void> {
    if (!fileList || fileList.length === 0) return;
    const paths: string[] = [];
    for (let index = 0; index < fileList.length; index++) {
      const file = fileList.item(index);
      if (file && file.path) paths.push(file.path);
    }
    if (paths.length === 0) return;
    const result = await api.addInputFiles(paths);
    if (result.success) {
      setToast({ message: t("browser.dropAdded", { n: result.data.length }), kind: "info" });
      await refreshCounts();
    } else {
      setToast({ message: result.error.message, kind: "error" });
    }
  }

  async function refreshCounts(): Promise<void> {
    const [input, wiki, archive] = await Promise.all([
      api.listFolder("input"),
      api.listFolder("wiki"),
      api.listFolder("archive"),
    ]);
    setCounts({
      input: input.success ? input.data.length : 0,
      wiki: wiki.success ? wiki.data.length : 0,
      archive: archive.success ? archive.data.length : 0,
    });
  }

  async function refreshSessions(): Promise<readonly SessionInfo[]> {
    const list = await api.listSessions();
    const sessions = list.success ? list.data : [];
    setSessions(sessions);
    // Sync streamingSessionsAtom from main process state.
    setStreamingSessions(
      new Set(sessions.filter((session) => session.streaming).map((session) => session.path)),
    );
    return sessions;
  }

  async function loadMessages(path: string): Promise<void> {
    const result = await api.getMessages(path);
    setMessages(result.success ? [...result.data] : []);
  }

  // Reset streaming flag + error banner when switching to an idle session.
  function resetChatTurnUi(): void {
    setChatStreaming(false);
    setChatError(null);
  }

  // Switch session (centralized for sidebar + dashboard). Preserves streaming
  // state for sessions with an in-flight background turn.
  async function openSession(path: string): Promise<void> {
    const opened = await api.openSession(path);
    if (!opened.success) return;
    // Load messages before setting current session — prevents text_delta
    // events from appending to wrong messages during the switch.
    const result = await api.getMessages(opened.data.path);
    const messages = result.success ? [...result.data] : [];
    setCurrentSession(opened.data);
    setMessages(messages);
    setView("chat");
    setChatStreaming(opened.data.streaming);
    setChatError(null);
  }

  // Start a fresh session — it never has an in-flight turn.
  async function startNewSession(): Promise<void> {
    const created = await api.newSession();
    if (!created.success) return;
    setCurrentSession(created.data);
    setMessages([]);
    setView("chat");
    resetChatTurnUi();
    await refreshSessions();
  }

  // Kick off /wiki-update from any entry point. Resets the ingest state machine
  // so the previous run's state does not linger, navigates to the ingest view,
  // and surfaces IPC-level errors (turn-level errors arrive via the ingest
  // event stream and are handled in App.tsx).
  async function runIngest(): Promise<void> {
    setView("ingest");
    setIngestSummary(null);
    setIngestStream("");
    setIngestError(null);
    setIngestState("running");
    const result = await api.ingest();
    if (!result.success) {
      setIngestState("idle");
      setIngestError(result.error.message);
    }
  }

  useEffect(() => {
    void (async () => {
      await refreshCounts();
      const sessions = await refreshSessions();
      if (sessions.length > 0) {
        const opened = await api.openSession(sessions[0].path);
        if (opened.success) {
          setCurrentSession(opened.data);
          await loadMessages(opened.data.path);
          // No turn is running at startup.
          setChatStreaming(false);
          setChatError(null);
        }
      } else {
        const created = await api.newSession();
        if (created.success) {
          setCurrentSession(created.data);
          setMessages([]);
          await refreshSessions();
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

useEffect(() => {
    if (ingestSummary) void refreshCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingestSummary]);

  // Refresh folder counts whenever the user returns to the dashboard so
  // changes made in the Browser are reflected.
  useEffect(() => {
    if (view === "dashboard") void refreshCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    if (messages.length === 1) void refreshSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Refresh the session list whenever a chat turn ends so the
  // most-recently-active session bubbles to the top.
  useEffect(() => {
    if (turnEnded === 0) return;
    void refreshSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnEnded]);

  const navBtn = (target: "chat" | "dashboard" | "browser", label: string): JSX.Element => (
    <button
      className={`btn btn-sm btn-ghost mono${view === target ? " active" : ""}`}
      onClick={() => setView(target)}
    >
      {label}
    </button>
  );

  const closeSidebar = (): void => setSidebarOpen(false);

  const handleDeleteSession = async (path: string): Promise<void> => {
    const isCurrent = currentSession?.path === path;
    // If deleting the active session, switch the runtime to a fresh session
    // FIRST — the repository refuses to delete the session it is bound to.
    // Switching before deleting keeps the file valid until the runtime has
    // moved on.
    if (isCurrent) {
      const created = await api.newSession();
      if (created.success) {
        setCurrentSession(created.data);
        setMessages([]);
        resetChatTurnUi();
      } else {
        // Could not switch away — abort the delete rather than leave the
        // runtime pointing at a deleted file.
        return;
      }
    }
    const result = await api.deleteSession(path);
    if (!result.success) {
      // Delete failed; if we switched away, the user is now on a fresh empty
      // session, which is acceptable. Refresh anyway.
      await refreshSessions();
      return;
    }
    await refreshSessions();
  };

  return (
    <div
      className="shell"
      onDragOver={(event) => {
        // Only real external file drags carry a "Files" type; accept those so
        // the subsequent drop event fires. Internal text drags are ignored.
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragOver(true);
        }
      }}
      onDragLeave={(event) => {
        // Only clear when leaving the shell entirely, not when crossing into
        // a child element (relatedTarget becomes null at the boundary).
        if (event.relatedTarget === null) setDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        void handleDropFiles(event.dataTransfer.files);
      }}
    >
      {dragOver && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            background: "color-mix(in oklab, var(--accent), transparent 85%)",
            border: "2px dashed var(--accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div className="mono" style={{ color: "var(--accent)", background: "color-mix(in oklab, var(--bg), transparent 30%)", padding: "var(--space-4) var(--space-6)", borderRadius: "var(--radius-md)", border: "1px solid var(--accent)", fontSize: "var(--text-sm)" }}>
            {t("browser.dropHint")}
          </div>
        </div>
      )}
      <header className="appbar">
        {view === "chat" && (
          <button
            className="iconbtn sidebar-toggle"
            onClick={() => setSidebarOpen((v) => !v)}
            title={t("sidebar.toggle")}
            aria-label={t("sidebar.toggle")}
            aria-expanded={sidebarOpen}
          >
            {sidebarOpen ? <CloseIcon size={18} /> : <MenuIcon size={18} />}
          </button>
        )}
        <div className="brand"><span className="mark">{t("app.avatar")}</span> {t("app.name")}</div>
        <span className="crumb">{workspace?.name ?? ""}</span>
        <div className="spacer" />
        {navBtn("dashboard", t("nav.workspace"))}
        {navBtn("chat", t("nav.chat"))}
        {navBtn("browser", t("nav.files"))}
        <button className="iconbtn" onClick={() => setView("settings")} title={t("nav.settings")}><SettingsIcon size={16} /></button>
        <UpdateBadge />
      </header>
      <div className="body">
        {view === "chat" && (
          <Fragment>
            <div className={`sidebar-backdrop${sidebarOpen ? " open" : ""}`} onClick={closeSidebar} />
            <Sidebar
              open={sidebarOpen}
              onAfterSelect={closeSidebar}
              onOpenSession={(path) => void openSession(path)}
              onNewSession={() => void startNewSession()}
              onDeleteSession={handleDeleteSession}
            />
          </Fragment>
        )}
        <main className="pane grow">
          {view === "dashboard" && <Dashboard onAsk={() => void startNewSession()} onOpenSession={(path) => void openSession(path)} onDeleteSession={handleDeleteSession} onSwitchWorkspace={() => setScreen("picker")} onBrowser={(folder) => { setBrowserFolder(folder); setBrowserMode("files"); setView("browser"); }} onIngest={runIngest} onViewIngest={() => setView("ingest")} />}
          {view === "chat" && <Chat />}
          {view === "browser" && <Browser />}
          {view === "ingest" && <IngestView onRun={runIngest} />}
          {view === "settings" && <Settings />}
        </main>
      </div>
      {(ingestState !== "idle" || view === "dashboard") && (
        <IngestBar onRun={runIngest} onView={view !== "ingest" ? () => setView("ingest") : undefined} />
      )}
    </div>
  );
}