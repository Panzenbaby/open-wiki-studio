// ChatSessionPool: the deep module that owns chat session creation + residency
// (LRU eviction) + in-progress streaming-text tracking for one workspace.
//
// What lives here (the deep implementation):
//   - creating a live chat session (resourceLoader.reload, pi session
//     creation, bindExtensions, ingest-model apply, forward-events + streaming
//     text subscribe),
//   - the liveSessions map keyed by session-file path,
//   - the LRU touch/drop/evict policy (never the current, never a streaming one),
//   - current-path tracking,
//   - applyModelToAll (best-effort) + disposeAll.
//
// What the agent keeps (its own policies, not pool state):
//   - the ingest session lifecycle (createIngestSession / resetIngestSession /
//     bindIngest) + the ingest() orchestration,
//   - GitHub Copilot OAuth (login/cancel/logout + copilotAbort),
//   - the four listeners + their setters,
//   - hasLlmConfig + the catalog delegation,
//   - extractMessages (caller-facing message extraction for getMessages) and
//     the lastAssistant* / dedupeProviderErrorMessage helpers used by
//     forwardAgentEvents (the pi->AgentEvent translator, a module-level free
//     function in agent.ts, injected here as `forwardEvents`).
//
// The seam that makes the residency policy testable in isolation is the
// **protected `createLiveChatSession`**: tests subclass ChatSessionPool and
// override it to return a fake LiveChatSession (a plain object whose `session`
// satisfies the structural `ChatSession` slice), so the LRU / streaming /
// touch / drop / applyModelToAll invariants are exercised without faking pi,
// createAgentSessionFromServices, or the resource loader. The unused `pi` /
// `services` deps are cast through `unknown` (NOT `any`) in tests because the
// override bypasses them entirely — `services` cannot be narrowed to a `Pick`
// slice (it is passed straight into `createAgentSessionFromServices`, whose
// real-typed options require the full `AgentSessionServices`), so the test
// seam is the override, not dep narrowing. See ADR 0005.
import type {
  AgentSession,
  AgentSessionServices,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "../shared/ipc-types.ts";
import { errorMessage } from "../shared/result.ts";

/** The pi module shape the pool uses. Kept full (not a `Pick` slice) because
 *  `createAgentSessionFromServices` is real-typed and `services` is passed
 *  through it; narrowing `services` would break production assignability. */
type PiModule = typeof import("@earendil-works/pi-coding-agent");

/** Model resolved from the registry, applied to newly created sessions.
 *  Re-derived locally (the element type of `modelRegistry.getAll()`) so the
 *  pool does not import the internal `ResolvedModel` alias from agent.ts. */
type ResolvedModel = ReturnType<AgentSessionServices["modelRegistry"]["getAll"]>[number];

/** Minimal structural slice of `AgentSession` the pool + agent actually use
 *  AFTER creation (creation uses the full `AgentSession` returned by pi, then
 *  narrows to this slice when stored). Narrowing to a structural interface —
 *  instead of the full `AgentSession` class — is what makes minimal, typed
 *  fakes possible in tests: a plain object is assignable to an interface but
 *  not to a class with private members. The real `AgentSession` satisfies this
 *  structurally. Members are declared as methods so a fake with looser
 *  parameter types (e.g. `setModel(m: unknown)`) is assignable via bivariance. */
export interface ChatSession {
  /** Whether an agent turn is actively streaming for this session. */
  readonly isStreaming: boolean;
  /** Full agent state (read by the agent's getMessages). */
  readonly messages: ReadonlyArray<AgentMessageLike>;
  /** Apply a resolved model (best-effort; the pool swallows per-session errors). */
  setModel(model: ResolvedModel): Promise<void>;
  /** Send a prompt to the agent (used by the agent's ask/retryChat). */
  prompt(text: string): Promise<void>;
  /** Abort the in-flight turn (used by the agent's abortChat/abort). */
  abort(): Promise<void>;
  /** Tear down the session (used by the pool's drop/disposeAll). */
  dispose(): void;
}

/** Minimal structural slice of `SessionManager` the pool stores. Only
 *  `getSessionFile()` is read (during creation); declaring it as an interface
 *  (not the full `SessionManager` class) lets tests pass a plain fake. */
export interface ChatSessionManager {
  getSessionFile(): string | undefined;
}

/**
 * One live chat session in the pool. Held alive (not disposed) while the user
 * may switch away and back, so an in-flight turn keeps streaming in the
 * background. `session` is the narrowed `ChatSession` slice so the residency
 * policy is testable with a plain-object fake; the real `AgentSession` created
 * by pi is assigned here after its creation-time methods (bindExtensions /
 * subscribe / sessionId) have been used.
 */
export interface LiveChatSession {
  readonly session: ChatSession;
  readonly sessionManager: ChatSessionManager;
  chatUnsub: () => void;
  readonly path: string;
  /** Accumulated text of the in-progress assistant message while streaming.
   *  The agent only stores the finalized message at `message_end`, so during
   *  streaming this is the only place the partial answer lives. */
  streamingAssistantText: string;
}

export interface ChatSessionPoolDeps {
  readonly pi: PiModule;
  readonly services: AgentSessionServices;
  readonly workspace: string;
  /** pi session events -> AgentEvent translation. Injected by the agent so the
   *  pool does not import it (shared with the ingest path — the agent calls
   *  the same function for its ingest session). */
  readonly forwardEvents: (
    session: AgentSession,
    path: string,
    emit: (event: AgentEvent) => void,
  ) => () => void;
  /** Chat event sink (the agent's chatListener). */
  readonly onChatEvent: (event: AgentEvent) => void;
  /** Wire an extension UI `notify` override onto a freshly-bound session so
   *  extension notifications surface to the renderer (per-session, so
   *  concurrent pooled sessions route to the correct listener). Injected by
   *  the agent so the pool does not import it (shared with the ingest path). */
  readonly attachNotify: (
    session: AgentSession,
    sessionPath: string,
    emit: (event: AgentEvent) => void,
  ) => void;
  /** Resolved model to apply to newly created sessions (read lazily, after
   *  reload + creation, so a configureLlm that races creation still applies). */
  readonly getIngestModel: () => ResolvedModel | null;
  /** LRU eviction cap. Default 8 (preserves MAX_LIVE_SESSIONS behaviour). */
  readonly maxLiveSessions?: number;
}

/** Minimal structural shape of an agent message used for streaming-text
 *  extraction and getMessages. Exported so the agent's `extractMessages`
 *  (caller-facing) can share the same shape without a pool->agent import. */
export interface AgentMessageLike {
  readonly role?: string;
  readonly content?: string | ReadonlyArray<{ type: string; text?: string }>;
}

export class ChatSessionPool {
  private readonly cap: number;
  /** Live chat sessions keyed by session-file path. Insertion order is the
   *  LRU eviction order (see `touch`). */
  private readonly sessions = new Map<string, LiveChatSession>();
  /** Path of the session currently displayed in the chat view. */
  private currentPath: string | null = null;

  constructor(private readonly deps: ChatSessionPoolDeps) {
    this.cap = deps.maxLiveSessions ?? 8;
  }

  // ── current session ──────────────────────────────────────────────
  getCurrentPath(): string | null {
    return this.currentPath;
  }

  setCurrentPath(path: string | null): void {
    this.currentPath = path;
  }

  /** The live session at the current path, or undefined. */
  getCurrent(): LiveChatSession | undefined {
    return this.currentPath ? this.sessions.get(this.currentPath) : undefined;
  }

  // ── pool accessors ───────────────────────────────────────────────
  get(path: string): LiveChatSession | undefined {
    return this.sessions.get(path);
  }

  has(path: string): boolean {
    return this.sessions.has(path);
  }

  isStreaming(path: string): boolean {
    const live = this.sessions.get(path);
    return live?.session.isStreaming ?? false;
  }

  // ── residency (the deep policy) ──────────────────────────────────
  /**
   * Create + register a NEW session (pi.SessionManager.create(workspace)),
   * set it current, evict idle beyond the cap. Returns the live session.
   * `previousSessionFile` is forwarded to extensions as the session_start
   * `previousSessionFile` (the session the user is leaving).
   */
  async newSession(previousSessionFile?: string): Promise<LiveChatSession> {
    const live = await this.createLiveChatSession("new", previousSessionFile);
    this.sessions.set(live.path, live);
    this.currentPath = live.path;
    this.evictIdle();
    return live;
  }

  /**
   * Open + register an existing session file, OR reuse the pooled one (LRU
   * touch). Sets it current and evicts. Returns the live session. When the
   * path is already pooled the creation seam is NOT called — the existing
   * session is just touched and made current (preserves the reuse branch).
   */
  async openSession(path: string, previousSessionFile?: string): Promise<LiveChatSession> {
    const existing = this.sessions.get(path);
    if (existing) {
      this.currentPath = path;
      this.touch(path);
      return existing;
    }
    const live = await this.createLiveChatSession("resume", previousSessionFile, path);
    this.sessions.set(live.path, live);
    this.currentPath = live.path;
    this.evictIdle();
    return live;
  }

  /**
   * Drop + dispose a pooled session. Returns false if it wasn't pooled.
   * Best-effort dispose (swallows teardown errors, matching the original).
   */
  drop(path: string): boolean {
    if (!this.sessions.has(path)) return false;
    this.dropInternal(path);
    return true;
  }

  /**
   * Apply a model to all pooled sessions (best-effort; streaming ones may
   * reject — swallow per-session errors so the loop continues, matching the
   * original `configureLlm` behaviour). Iterates in insertion (LRU) order.
   */
  async applyModelToAll(model: ResolvedModel): Promise<void> {
    for (const live of this.sessions.values()) {
      try {
        await live.session.setModel(model);
      } catch {
        /* best-effort — a streaming session may reject reconfiguration */
      }
    }
  }

  /** Dispose every pooled session and empty the pool. */
  disposeAll(): void {
    for (const path of [...this.sessions.keys()]) {
      this.dropInternal(path);
    }
    this.currentPath = null;
  }

  // ── creation seam (overridable in tests) ─────────────────────────
  /**
   * Build a LiveChatSession for a reason: resourceLoader.reload (fresh
   * extension runtime; other live sessions keep theirs and stream
   * undisturbed), pi session creation with a `session_start` event carrying
   * `reason` + `previousSessionFile`, bindExtensions, apply the ingest model
   * (best-effort, logged on failure), then wire `forwardEvents` (the pi->
   * AgentEvent channel) and a second handler tracking
   * `streamingAssistantText` from `message_update` partials (cleared on
   * assistant `message_end` and `agent_end`). For "new", `path` is undefined
   * and the sessionManager is created via pi.SessionManager.create(workspace);
   * for "resume", `path` is the file and pi.SessionManager.open(path) is used.
   *
   * Marked `protected` so tests override it with a fake factory — that is the
   * seam that makes the residency policy testable without faking pi.
   */
  protected async createLiveChatSession(
    reason: "new" | "resume",
    previousSessionFile?: string,
    path?: string,
  ): Promise<LiveChatSession> {
    await this.deps.services.resourceLoader.reload();
    const sessionManager =
      reason === "new"
        ? this.deps.pi.SessionManager.create(this.deps.workspace)
        : this.deps.pi.SessionManager.open(path!);
    const sessionStartEvent: SessionStartEvent = {
      type: "session_start",
      reason,
      previousSessionFile,
    };
    const { session } = await this.deps.pi.createAgentSessionFromServices({
      services: this.deps.services,
      sessionManager,
      sessionStartEvent,
    });
    await session.bindExtensions({});
    const sessionPath = sessionManager.getSessionFile() ?? "";
    // Forward extension `ctx.ui.notify` calls to the renderer. Done per-session
    // after bind so concurrent pooled sessions route to the chat listener with
    // their own sessionPath. (Ingest uses the same helper with path "".)
    this.deps.attachNotify(session, sessionPath, this.deps.onChatEvent);
    const model = this.deps.getIngestModel();
    if (model) {
      try {
        await session.setModel(model);
      } catch (error) {
        console.log(
          `[open-wiki-studio] setModel failed for session ${sessionPath}: ${errorMessage(error)}`,
        );
      }
    }
    const live: LiveChatSession = {
      session,
      sessionManager,
      chatUnsub: () => {},
      path: sessionPath,
      streamingAssistantText: "",
    };
    // pi session events -> AgentEvent channel (translator injected by the
    // agent so the pool does not import it; shared with the ingest path).
    const eventUnsub = this.deps.forwardEvents(session, sessionPath, this.deps.onChatEvent);
    // Track in-progress assistant text so getMessages can restore it when the
    // user switches back to a still-streaming session.
    const textUnsub = session.subscribe((event) => {
      if (event.type === "message_update") {
        const partial = (
          event.assistantMessageEvent as {
            partial?: {
              content?: string | ReadonlyArray<{ type: string; text?: string }>;
            };
          }
        ).partial;
        live.streamingAssistantText = extractText(partial?.content);
      } else if (
        event.type === "message_end" &&
        (event as { message?: { role?: string } }).message?.role === "assistant"
      ) {
        live.streamingAssistantText = "";
      } else if (event.type === "agent_end") {
        live.streamingAssistantText = "";
      }
    });
    live.chatUnsub = () => {
      eventUnsub();
      textUnsub();
    };
    return live;
  }

  // ── internal LRU helpers ──────────────────────────────────────────
  /** Mark a pooled session as most-recently-used by re-inserting it at the
   *  back of the LRU-ordered map. */
  private touch(path: string): void {
    const live = this.sessions.get(path);
    if (!live) return;
    this.sessions.delete(path);
    this.sessions.set(path, live);
  }

  /** Abort-unsubscribe + dispose a pooled session and remove it. Best-effort
   *  dispose. Nulls `currentPath` if it pointed at the dropped session
   *  (defensive — callers guard against dropping the current, but keep the
   *  original behaviour). */
  private dropInternal(path: string): void {
    const live = this.sessions.get(path);
    if (!live) return;
    live.chatUnsub();
    try {
      live.session.dispose();
    } catch {
      /* ignore — best-effort teardown */
    }
    this.sessions.delete(path);
    if (this.currentPath === path) this.currentPath = null;
  }

  /**
   * Evict idle pooled sessions beyond the cap. Walks the map in LRU order and
   * disposes the first idle, non-current session it finds, repeating until
   * under the cap. Streaming and current sessions are never evicted; if a full
   * pass evicts nothing, stop (avoid an infinite loop when every session is
   * current or streaming).
   */
  private evictIdle(): void {
    while (this.sessions.size > this.cap) {
      let evicted = false;
      for (const [path, live] of this.sessions) {
        if (path === this.currentPath) continue;
        if (live.session.isStreaming) continue;
        this.dropInternal(path);
        evicted = true;
        break;
      }
      if (!evicted) break;
    }
  }
}

/** Extract the plain text from an agent message content block (string or a
 *  list of `{ type, text }` blocks). Pure helper, exported so the agent's
 *  `extractMessages` (caller-facing) can share it without a pool->agent import
 *  (which would create a cycle: the agent imports the pool, not the reverse).
 *  Kept here because the pool's streaming-text subscribe is its primary user. */
export function extractText(
  content: string | ReadonlyArray<{ type: string; text?: string }> | undefined,
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("");
}