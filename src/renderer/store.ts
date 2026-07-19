// Jotai atoms + derived state for the renderer.
import { atom } from "jotai";
import type {
  AddFilesSummary,
  ChatMessage,
  IngestSummary,
  SessionInfo,
  UpdateInfo,
  UpdateStatus,
  WorkspaceInfo,
} from "../shared/ipc-types.ts";

export type { ChatMessage };

export type Screen = "loading" | "picker" | "first-run" | "app";

export type View = "dashboard" | "chat" | "browser" | "ingest" | "settings";

/** Mode within the Browser screen: file tree vs. wiki graph. */
export type BrowserMode = "files" | "graph";

export const screenAtom = atom<Screen>("loading");
export const workspaceAtom = atom<WorkspaceInfo | null>(null);
export const recentWorkspacesAtom = atom<readonly WorkspaceInfo[]>([]);
export const llmConfiguredAtom = atom<boolean>(false);
/** Electron process.platform (darwin/win32/linux/…), for OS-adaptive UI. */
export const platformAtom = atom<string>("");
/** App version reported by the main process (`app.getVersion()`). */
export const currentVersionAtom = atom<string>("");
export const toastAtom = atom<{ message: string; kind: "info" | "error" } | null>(null);

/** Summary of the last add-files operation that needs a manual-acknowledge
 *  modal (failures, or a pure no-op where everything was skipped). Rendered as
 *  a Modal by AppShell; cleared on close. */
export const addFilesSummaryAtom = atom<AddFilesSummary | null>(null);

// folder counts (dashboard)
export const countsAtom = atom<{ input: number; wiki: number; archive: number }>({
  input: 0,
  wiki: 0,
  archive: 0,
});

// sessions
export const sessionsAtom = atom<readonly SessionInfo[]>([]);
export const currentSessionAtom = atom<SessionInfo | null>(null);
/** Paths of sessions with an in-flight agent turn (live sidebar indicator). */
export const streamingSessionsAtom = atom<ReadonlySet<string>>(new Set<string>());

export const viewAtom = atom<View>("dashboard");

// mobile sidebar drawer (only relevant on narrow screens)
export const sidebarOpenAtom = atom<boolean>(false);

// chat
export const messagesAtom = atom<ChatMessage[]>([]);
export const chatStreamingAtom = atom<boolean>(false);
// incremented whenever a chat turn ends (agent_end) — used to refresh the
// session list so the most-recently-active session bubbles to the top.
export const chatTurnEndedAtom = atom<number>(0);
export const chatErrorAtom = atom<string | null>(null);

// ingest
export type IngestState = "idle" | "running" | "done";
export const ingestStateAtom = atom<IngestState>("idle");
export const ingestStreamAtom = atom<string>("");
export const ingestSummaryAtom = atom<IngestSummary | null>(null);
export const ingestErrorAtom = atom<string | null>(null);

// browser
export const browserFolderAtom = atom<"input" | "wiki" | "archive">("wiki");
export const browserModeAtom = atom<BrowserMode>("files");
export const selectedFileAtom = atom<string | null>(null);

/**
 * Monotonically incremented per folder whenever that folder's contents change
 * on disk. Bumped by exactly one source: the `onFolderChanged` event stream
 * from the main-process FolderWatcher, which fires for both in-app writes
 * (drag-and-drop, Add-button, ingest) and external OS edits/deletes on any
 * of `input`/`wiki`/`archive`.
 *
 * Browser subscribes to its active folder's version and re-lists on change.
 * This is the renderer's only "react to folder changes" mechanism — no
 * component manually re-lists after its own writes.
 */
export const folderVersionAtom = atom<{ input: number; wiki: number; archive: number }>({
  input: 0,
  wiki: 0,
  archive: 0,
});

// auto-update — state machine fed by `UpdateEvent`s from the main process.
// `lastAvailableInfoAtom` is internal bookkeeping so a download error can
// revert the badge to the pulsing "available" state (with its version info).
export const updateStateAtom = atom<UpdateStatus>({ status: "idle" });
const lastAvailableInfoAtom = atom<UpdateInfo | null>(null);
export { lastAvailableInfoAtom };