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
  | "ollama";

export interface LlmConfig {
  readonly provider: ProviderId;
  readonly modelId: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
}

// ─── Filesystem (input/wiki/archive) ─────────────────────────────────
export type Folder = "input" | "wiki" | "archive";

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
  | { type: "error"; sessionPath: string; message: string };

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

// ─── IPC contract ────────────────────────────────────────────────────
export interface AgentApi {
  // workspace & app
  getAppSelf(): Promise<Result<AppSelfInfo>>;
  getLlmConfig(): Promise<Result<LlmConfig | null>>;
  listRecentWorkspaces(): Promise<Result<readonly WorkspaceInfo[]>>;
  openWorkspace(path: string): Promise<Result<WorkspaceInfo>>;
  pickWorkspace(): Promise<Result<WorkspaceInfo | null>>;

  // llm
  configureLlm(config: LlmConfig): Promise<Result<void>>;

  // files
  listFolder(folder: Folder): Promise<Result<readonly FileNode[]>>;
  getPreview(relativePath: string): Promise<Result<FilePreview>>;
  addInputFiles(filePaths: readonly string[]): Promise<Result<readonly string[]>>;
  addInputFilesDialog(): Promise<Result<readonly string[]>>;
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
  ingest(): Promise<Result<void>>;
  /** Abort only the current chat session's in-flight turn (background turns and ingest keep running). */
  abortChat(): Promise<Result<void>>;
  /** Emergency stop: abort the current chat turn AND any in-flight ingest. */
  abort(): Promise<Result<void>>;

  // events
  onAgentEvent(listener: (event: AgentEvent) => void): () => void;
  onIngestEvent(listener: (event: AgentEvent) => void): () => void;
  onIngestSummary(listener: (summary: IngestSummary) => void): () => void;
}