// Shared types between main, preload, and renderer. Strict, no `any`.
// The IPC contract is defined once here as `AgentApi` and implemented by the
// preload bridge; the renderer imports the typed `window.api`.

export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: AppError };

export interface AppError {
  message: string;
  cause?: string;
  path?: string;
}

// ─── Workspace & config ──────────────────────────────────────────────
export interface WorkspaceInfo {
  readonly path: string;
  readonly name: string;
  readonly lastOpened: string; // ISO 8601
  /** True when the linked folder no longer exists on disk. Annotated by the
   *  main process at list time so the picker can show a hint next to the entry. */
  readonly missing?: boolean;
}

export interface AppSelfInfo {
  readonly version: string;
  readonly hasLlmConfig: boolean;
  /** Electron process.platform (e.g. "darwin", "win32", "linux"), for OS-adaptive UI. */
  readonly platform: string;
}

// ─── LLM config (first-run) ──────────────────────────────────────────
export type ProviderId =
  | "anthropic"
  | "openai"
  | "google"
  | "openai-compatible"
  | "ollama"
  | "github-copilot";

export interface LlmConfig {
  readonly provider: ProviderId;
  readonly modelId: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
}

/** Model offered by a provider (`listAvailableModels`); populates the
 *  Copilot dropdown after OAuth login. */
export interface ModelOption {
  readonly id: string;
  readonly name: string;
}

// ─── Copilot OAuth login (device flow) ──────────────────────────────
// Streamed to the renderer during `loginCopilot()`. The GHES domain `onPrompt`
// is auto-answered with "" (github.com) and therefore not forwarded.
export type CopilotLoginEvent =
  | { type: "device_code"; userCode: string; verificationUri: string }
  | { type: "progress"; message: string };

// ─── Filesystem (input/wiki) ─────────────────────────────────────────
// The OKF archive lives physically at `workspace/wiki/archive/` (since
// pi-okf-wiki 0.2.0) and is browsed as the `archive/` subdirectory of the
// wiki folder — it is not a top-level folder. `Folder` covers only the two
// top-level workspace folders the UI switches between.
export type Folder = "input" | "wiki";

/** Outcome of copying dropped/picked files (and folders) into `input/`.
 *  Paths are POSIX-style, relative to `input/`.
 *  - `added`:   successfully copied.
 *  - `skipped`: destination already existed — left untouched (no overwrite).
 *  - `failed`:  copy raised an error; `error` carries the OS error message.
 *
 *  Exception: a top-level source that could not even be `lstat`'d (it vanished
 *  or is unreadable) is recorded in `failed` with its **raw source path**,
 *  because it never reached a destination and has no input-relative path. */
export interface AddFilesSummary {
  readonly added: readonly string[];
  readonly skipped: readonly { path: string; reason: string }[];
  readonly failed: readonly { path: string; error: string }[];
}

export interface FileNode {
  readonly relativePath: string; // posix, with extension
  readonly name: string;
  readonly isDirectory: boolean;
  readonly size?: number;
}

export interface ConceptInfo {
  readonly conceptId: string;
  readonly title: string;
  readonly description: string;
  readonly type: string;
}

export interface FilePreview {
  readonly relativePath: string;
  readonly kind: "markdown" | "text" | "binary";
  readonly content: string; // rendered-ready (frontmatter stripped for concepts)
  readonly frontmatter?: ConceptInfo;
}

// ─── Sessions ────────────────────────────────────────────────────────
export interface SessionInfo {
  readonly path: string;
  readonly name: string;
  readonly lastModified: string;
  /** True while an agent turn is actively streaming for this session. */
  readonly streaming: boolean;
}

export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
}

// ─── Agent events streamed to the renderer ──────────────────────────
// Chat-stream events carry `sessionPath` so the renderer can route them to the
// correct session's UI state when multiple sessions stream in parallel.
// Ingest-stream events use `sessionPath: ""` (the renderer ignores it).
export type AgentEvent =
  | { type: "message_start"; role: "user" | "assistant"; text: string }
  | { type: "text_delta"; sessionId: string; sessionPath: string; delta: string }
  | { type: "message_end"; role: "user" | "assistant"; text: string }
  | { type: "agent_start"; sessionId: string; sessionPath: string }
  | { type: "agent_end"; sessionId: string; sessionPath: string; aborted: boolean; lastError?: string }
  | { type: "error"; sessionPath: string; message: string }
  | {
      type: "notify";
      sessionPath: string;
      message: string;
      notifyType?: "info" | "warning" | "error";
    };

export interface IngestSummary {
  readonly leftover: readonly string[];
  readonly createdConcepts: readonly string[];
  readonly updatedConcepts: readonly string[];
  readonly wikiConceptCountBefore: number;
  readonly wikiConceptCountAfter: number;
}

// ─── Wiki graph ────────────────────────────────────────────────────
export interface GraphNode {
  readonly id: string; // conceptId
  readonly title: string;
  readonly type: string;
  readonly tags: readonly string[];
  readonly degree: number; // number of incident edges
}

export interface GraphEdge {
  readonly source: string; // conceptId
  readonly target: string; // conceptId
}

export interface WikiGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

// ─── App auto-update ────────────────────────────────────────────────
// The renderer drives the update UI from a small state machine fed by
// `UpdateEvent`s streamed from the main-process `UpdateRepository` (which
// wraps electron-updater — the external SDK never leaks past the repository).
/** Available update metadata (AppModel — the electron-updater DTO stays in
 *  the repository). `releaseNotesUrl` points at the GitHub Release page. */
export interface UpdateInfo {
  readonly version: string;
  readonly releaseNotesUrl: string;
}

/** Renderer state machine for the update badge in the app bar. */
export type UpdateStatus =
  | { readonly status: "idle" }
  | { readonly status: "available"; readonly info: UpdateInfo }
  | { readonly status: "downloading"; readonly info: UpdateInfo; readonly percent: number }
  | { readonly status: "ready"; readonly info: UpdateInfo };

/** Events streamed from main → renderer over the `okf:update-event` channel. */
export type UpdateEvent =
  | { readonly type: "available"; readonly info: UpdateInfo }
  | { readonly type: "progress"; readonly percent: number }
  | { readonly type: "downloaded"; readonly info: UpdateInfo }
  | { readonly type: "error"; readonly message: string };

// ─── IPC contract ────────────────────────────────────────────────────
export interface AgentApi {
  // workspace & app
  getAppSelf(): Promise<Result<AppSelfInfo>>;
  getLlmConfig(): Promise<Result<LlmConfig | null>>;
  listRecentWorkspaces(): Promise<Result<readonly WorkspaceInfo[]>>;
  openWorkspace(path: string): Promise<Result<WorkspaceInfo>>;
  pickWorkspace(): Promise<Result<WorkspaceInfo | null>>;
  /** Remove a workspace from the recent list (the folder on disk stays
   *  untouched). Returns `void`; never throws. */
  forgetWorkspace(path: string): Promise<Result<void>>;

  // llm
  configureLlm(config: LlmConfig): Promise<Result<void>>;
  /** Provider models with auth configured. For Copilot a non-empty list doubles
   *  as the "already logged in" probe. */
  listAvailableModels(provider: ProviderId): Promise<Result<readonly ModelOption[]>>;
  /**
   * Load selectable models for a provider, given credentials/base URL.
   *
   * Side effect for API-key providers (anthropic/openai/google): stores the
   * key in authStorage so the built-in catalog becomes available via
   * `getAvailable()` before the final Save. For Ollama it fetches local
   * (`{baseUrl}/v1/models`) + cloud (`https://ollama.com/v1/models`) models;
   * for openai-compatible it fetches `{baseUrl}/v1/models`. GitHub Copilot
   * is NOT handled here — use `loginCopilot()`.
   */
  loadModels(provider: ProviderId, apiKey?: string, baseUrl?: string): Promise<Result<readonly ModelOption[]>>;
  /** Run the Copilot device-code flow; device code/progress stream via
   *  `onCopilotLoginEvent`. Resolves with the account's available models. */
  loginCopilot(): Promise<Result<readonly ModelOption[]>>;
  /** Abort an in-flight `loginCopilot()`. */
  cancelCopilotLogin(): Promise<Result<void>>;
  /** Clear the stored Copilot OAuth credential (log out). */
  logoutCopilot(): Promise<Result<void>>;

  // external
  /** Open a URL in the default browser (Copilot verification URL). */
  openExternal(url: string): Promise<Result<void>>;

  // auto-update
  /** Start downloading the update whose availability was signalled via
   *  `onUpdateEvent`. Progress + completion arrive as `UpdateEvent`s. */
  downloadUpdate(): Promise<Result<void>>;
  /** Quit the app and install the already-downloaded update immediately. */
  installUpdateNow(): Promise<Result<void>>;
  /** Subscribe to the update event stream. Returns an unsubscribe function.
   *  Subscribe BEFORE calling `getUpdateStatus` so no event between
   *  subscribe and the replay pull is lost. */
  onUpdateEvent(listener: (event: UpdateEvent) => void): () => void;
  /** Replay the most recent `UpdateEvent` cached in the main process, or
   *  `null` when none has fired yet. Used on renderer mount to recover the
   *  start-check result that may have been emitted before the renderer
   *  subscribed to `onUpdateEvent` (startup race). */
  getUpdateStatus(): Promise<UpdateEvent | null>;

  // files
  listFolder(folder: Folder): Promise<Result<readonly FileNode[]>>;
  getPreview(relativePath: string): Promise<Result<FilePreview>>;
  addInputFiles(filePaths: readonly string[]): Promise<Result<AddFilesSummary>>;
  addInputFilesDialog(): Promise<Result<AddFilesSummary>>;
  /** Reveal a file/folder in the OS file manager (Finder / Explorer / file manager). */
  revealInFileManager(folder: Folder, relativePath: string, isDirectory: boolean): Promise<Result<void>>;

  // sessions
  listSessions(): Promise<Result<readonly SessionInfo[]>>;
  newSession(): Promise<Result<SessionInfo>>;
  openSession(path: string): Promise<Result<SessionInfo>>;
  deleteSession(path: string): Promise<Result<void>>;
  getMessages(path: string): Promise<Result<readonly ChatMessage[]>>;

  // wiki graph
  getWikiGraph(): Promise<Result<WikiGraph>>;

  // agent
  ask(question: string): Promise<Result<void>>;
  /** Retry the last chat turn by re-prompting with the same question.
   *  Non-destructive (no session branching): the failed assistant entry stays
   *  on the append-only disk path but is hidden by `extractMessages`. */
  retryChat(question: string): Promise<Result<void>>;
  ingest(): Promise<Result<void>>;
  /** Abort only the current chat session's in-flight turn (background turns and ingest keep running). */
  abortChat(): Promise<Result<void>>;
  /** Emergency stop: abort the current chat turn AND any in-flight ingest. */
  abort(): Promise<Result<void>>;

  // events
  onAgentEvent(listener: (event: AgentEvent) => void): () => void;
  onIngestEvent(listener: (event: AgentEvent) => void): () => void;
  onIngestSummary(listener: (summary: IngestSummary) => void): () => void;
  onCopilotLoginEvent(listener: (event: CopilotLoginEvent) => void): () => void;
  /** Subscribe to filesystem changes in the workspace folders. The listener
   *  is called when `input/` or `wiki/` (including its `archive/` subtree)
   *  is modified on disk — whether the change originates inside the app
   *  (drag-and-drop, Add-button, ingest) or outside (e.g. files deleted via
   *  the OS file manager). Use it to trigger a re-list of the affected
   *  folder. This is the renderer's only "a folder changed" signal — do not
   *  depend on a specific delivery cadence (the main process is free to
   *  coalesce bursts). */
  onFolderChanged(listener: (folder: Folder) => void): () => void;
}
