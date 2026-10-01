import { Fragment, useCallback, useEffect } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Menu as MenuIcon, Settings as SettingsIcon, X as CloseIcon } from "lucide-react";
import { api } from "../ipc.ts";
import { useT } from "../i18n.ts";
import { reportAddFilesResult } from "../add-files.ts";
import { summarizeWikiListing } from "../dashboard-data.ts";
import { useIngestActions } from "../ingest-actions.ts";
import { useActiveNavigationTarget, useNavigation, type NavigationTarget } from "../navigation.ts";
import {
  addFilesSummaryAtom,
  fileDragActiveAtom,
  folderVersionAtom,
  chatErrorAtom,
  chatStreamingAtom,
  chatTurnEndedAtom,
  countsAtom,
  currentSessionAtom,
  ingestStateAtom,
  inputFilesAtom,
  messagesAtom,
  screenAtom,
  sessionsAtom,
  sidebarOpenAtom,
  streamingSessionsAtom,
  toastAtom,
  viewAtom,
  wikiOverviewAtom,
  workspaceAtom,
} from "../store.ts";
import type { AddFilesSummary, FileNode, Folder, SessionInfo } from "../../shared/ipc-types.ts";
import { Sidebar } from "./Sidebar.tsx";
import { Dashboard } from "../screens/Dashboard.tsx";
import { Chat } from "../screens/Chat.tsx";
import { Browser } from "../screens/Browser.tsx";
import { IngestView } from "../screens/IngestView.tsx";
import { Settings } from "../screens/Settings.tsx";
import { IngestBar } from "./IngestBar.tsx";
import { Modal } from "./Modal.tsx";
import { UpdateBadge } from "./UpdateBadge.tsx";

/** Count file entries in a folder result, excluding the OKF archive subtree
 *  for the wiki folder. `listFolder("wiki")` walks `wiki/` recursively and
 *  includes `wiki/archive/` (archived originals — pdf, .md.orig, …), which are
 *  NOT concepts. The dashboard summary and `wikiExistsAtom` are meant to
 *  reflect concept count, so drop entries whose path (relative to `wiki/`)
 *  starts with `archive/`. */
function countConcepts(folder: Folder, files: readonly FileNode[]): number {
  if (folder !== "wiki") return files.length;
  return files.filter((node) => !node.relativePath.startsWith("archive/")).length;
}

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
  const setScreen = useSetAtom(screenAtom);
  const setChatStreaming = useSetAtom(chatStreamingAtom);
  const setChatError = useSetAtom(chatErrorAtom);
  const setStreamingSessions = useSetAtom(streamingSessionsAtom);
  const turnEnded = useAtomValue(chatTurnEndedAtom);
  const [sidebarOpen, setSidebarOpen] = useAtom(sidebarOpenAtom);
  const setToast = useSetAtom(toastAtom);
  const setAddFilesSummary = useSetAtom(addFilesSummaryAtom);
  const addFilesSummary = useAtomValue(addFilesSummaryAtom);
  const setFolderVersion = useSetAtom(folderVersionAtom);
  const setInputFiles = useSetAtom(inputFilesAtom);
  const setWikiOverview = useSetAtom(wikiOverviewAtom);
  const [dragOver, setDragOver] = useAtom(fileDragActiveAtom);
  const { runIngest } = useIngestActions();
  const { showBrowser } = useNavigation();
  const activeTarget = useActiveNavigationTarget();

  /**
   * Drop external files/folders anywhere in the app → copy them into `input/`.
   * Reuses the existing `addInputFiles` IPC handler, which now recurses into
   * directories. Always targets `input/`, regardless of the active view.
   * Result reporting (toast vs. summary modal) is shared with the Browser
   * screen's "Add" button via `reportAddFilesResult`.
   */
  async function handleDropFiles(fileList: FileList | null): Promise<void> {
    if (!fileList || fileList.length === 0) return;
    const paths: string[] = [];
    for (let index = 0; index < fileList.length; index++) {
      const file = fileList.item(index);
      if (!file) continue;
      const path = api.getPathForFile(file);
      if (path) paths.push(path);
    }
    if (paths.length === 0) return;
    const result = await api.addInputFiles(paths);
    reportAddFilesResult(result, { setToast, setSummary: setAddFilesSummary, t });
    // No manual refresh here: `addInputFiles` writes to `input/`, the
    // FolderWatcher fires for those writes, and the unified `onFolderChanged`
    // handler in AppShell bumps `folderVersion` + refreshes counts. The
    // Browser re-lists on the version bump. This keeps "react to folder
    // changes" in exactly one place.
  }

  /** Store one folder listing: its count, plus the dashboard's view of it
   *  (pending input files, wiki overview numbers). */
  const applyListing = useCallback((folder: Folder, files: readonly FileNode[]): void => {
    setCounts((current) => ({ ...current, [folder]: countConcepts(folder, files) }));
    if (folder === "input") setInputFiles(files);
    else setWikiOverview(summarizeWikiListing(files));
  }, [setCounts, setInputFiles, setWikiOverview]);

  /** Refresh folder counts. With no argument, re-lists both folders (used on
   *  mount). With a `folder`, lists only that one — used by the
   *  `onFolderChanged` handler so a single debounced burst costs one
   *  round-trip, not two. */
  const refreshCounts = useCallback(async (folder?: Folder): Promise<void> => {
    const folders: readonly Folder[] = folder ? [folder] : ["input", "wiki"];
    const results = await Promise.all(folders.map((name) => api.listFolder(name)));
    folders.forEach((name, index) => {
      const result = results[index]!;
      applyListing(name, result.success ? result.data : []);
    });
  }, [applyListing]);

  const refreshSessions = useCallback(async (): Promise<readonly SessionInfo[]> => {
    const list = await api.listSessions();
    const sessions = list.success ? list.data : [];
    setSessions(sessions);
    // Sync streamingSessionsAtom from main process state.
    setStreamingSessions(
      new Set(sessions.filter((session) => session.streaming).map((session) => session.path)),
    );
    return sessions;
  }, [setSessions, setStreamingSessions]);

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
    // Mount-only bootstrap: opens the most recent session (or creates one)
    // exactly once. Re-running on any dependency change would reopen or
    // recreate the session behind the user's back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Folder-count refresh is driven by the FolderWatcher (see the
  // `onFolderChanged` effect below): ingest writes to `wiki/`, drag-and-drop
  // and the Add-button write to `input/`, and OS edits touch any folder —
  // all flow through the same handler. No per-action `refreshCounts()` here.

  // Safety net: fs.watch is best-effort (Linux rename gaps, transient
  // watcher errors). When the user enters the dashboard, re-pull all three
  // counts so a missed event can't leave the dashboard stale. This is
  // navigation-triggered (not change-triggered), so it doesn't break the
  // "FolderWatcher is the single change-reaction source" invariant — it's a
  // cheap, view-local fallback.
  useEffect(() => {
    if (view === "dashboard") void refreshCounts();
  }, [view, refreshCounts]);

  useEffect(() => {
    if (messages.length === 1) void refreshSessions();
  }, [messages.length, refreshSessions]);

  // Refresh the session list whenever a chat turn ends so the
  // most-recently-active session bubbles to the top.
  useEffect(() => {
    if (turnEnded === 0) return;
    void refreshSessions();
  }, [turnEnded, refreshSessions]);

  // External filesystem changes (OS-level add/delete/edit on input/wiki,
  //  including the wiki/archive/ subtree) arrive from the main-process
  //  FolderWatcher. This is the renderer's single "react to folder changes"
  //  entry point: bump the per-folder version so any visible Browser re-lists,
  //  and patch just that folder's count (one round-trip, not two).
  useEffect(() => {
    const unsubscribe = api.onFolderChanged((folder) => {
      setFolderVersion((version) => ({ ...version, [folder]: version[folder] + 1 }));
      void refreshCounts(folder);
    });
    return unsubscribe;
  }, [setFolderVersion, refreshCounts]);

  const navigate = (target: NavigationTarget): void => {
    if (target === "files") showBrowser("input");
    else if (target === "wiki") showBrowser("wiki");
    else setView(target);
  };

  const navLink = (target: NavigationTarget, label: string): JSX.Element => (
    <button
      type="button"
      className="appnav-link"
      aria-current={activeTarget === target ? "page" : undefined}
      onClick={() => navigate(target)}
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
      {/* The dashboard has its own drop zone, which lights up instead. */}
      {dragOver && view !== "dashboard" && (
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
        <nav className="appnav" aria-label={t("nav.main")}>
          {navLink("dashboard", t("nav.workspace"))}
          {navLink("chat", t("nav.chat"))}
          {navLink("files", t("nav.files"))}
          {navLink("wiki", t("nav.wiki"))}
          {workspace && (
            <button
              type="button"
              className="appnav-link appnav-icon"
              aria-current={view === "settings" ? "page" : undefined}
              onClick={() => setView("settings")}
              title={t("nav.settings")}
              aria-label={t("nav.settings")}
            >
              <SettingsIcon size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
        </nav>
        <UpdateBadge />
      </header>
      <div className="body">
        {view === "chat" && (
          <Fragment>
            <button
              type="button"
              className={`sidebar-backdrop${sidebarOpen ? " open" : ""}`}
              aria-label={t("sidebar.close")}
              onClick={closeSidebar}
            />
            <Sidebar
              open={sidebarOpen}
              onAfterSelect={closeSidebar}
              onOpenSession={(path) => void openSession(path)}
              onNewSession={() => void startNewSession()}
              onDeleteSession={handleDeleteSession}
            />
          </Fragment>
        )}
        <main className="screen-host">
          {view === "dashboard" && (
            <Dashboard
              onNewChat={() => void startNewSession()}
              onOpenSession={(path) => void openSession(path)}
              onSwitchWorkspace={() => setScreen("picker")}
            />
          )}
          {view === "chat" && <Chat />}
          {view === "browser" && <Browser />}
          {view === "ingest" && <IngestView onRun={() => void runIngest()} />}
          {view === "settings" && <Settings />}
        </main>
      </div>
      {/* The dashboard shows ingest status in its own card. */}
      {ingestState !== "idle" && view !== "dashboard" && (
        <IngestBar onRun={() => void runIngest()} onView={view !== "ingest" ? () => setView("ingest") : undefined} />
      )}
      {addFilesSummary && (
        <AddFilesSummaryModal
          summary={addFilesSummary}
          onClose={() => setAddFilesSummary(null)}
        />
      )}
    </div>
  );
}

/** Manual-acknowledge summary of an add-files run that had failures or was a
 *  pure no-op (everything skipped). Lists added/skipped/failed paths so the
 *  user can inspect what went wrong before dismissing. */
function AddFilesSummaryModal({
  summary,
  onClose,
}: {
  summary: AddFilesSummary;
  onClose: () => void;
}): JSX.Element {
  const t = useT();
  const { added, skipped, failed } = summary;
  return (
    <Modal
      title={t("addFiles.summaryTitle")}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          {t("addFiles.close")}
        </button>
      }
    >
      <SummarySection title={t("addFiles.sectionAdded")} items={added.map((path) => ({ path }))} tone="ok" />
      <SummarySection
        title={t("addFiles.sectionSkipped")}
        items={skipped}
        tone="muted"
      />
      <SummarySection
        title={t("addFiles.sectionFailed")}
        items={failed.map((entry) => ({ path: entry.path, reason: entry.error }))}
        tone="err"
      />
    </Modal>
  );
}

function SummarySection({
  title,
  items,
  tone,
}: {
  title: string;
  items: readonly { path: string; reason?: string }[];
  tone: "ok" | "muted" | "err";
}): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div className="addfiles-section">
      <h3 className={`mono${tone === "err" ? " err" : tone === "muted" ? " muted" : ""}`}>
        {title} ({items.length})
      </h3>
      <ul>
        {items.map((entry, index) => (
          // Index suffix guards against duplicate paths (e.g. two different
          // sources colliding on the same dest both land in skipped).
          <li key={`${entry.path}#${index}`} className="mono">
            {entry.path}
            {entry.reason && <span className="reason"> — {entry.reason}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
