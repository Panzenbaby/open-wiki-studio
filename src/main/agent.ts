// AgentRepository: hosts the embedded Pi agent for one workspace.
//
// - chat sessions live in a POOL of concurrent AgentSessions (one per opened
//   session file), so multiple sessions can stream answers in parallel. The
//   pool keys live sessions by their session-file path; switching the "current"
//   session does NOT tear down the others — their in-flight turns keep running.
// - a separate ephemeral in-memory AgentSession for /wiki-update so chat
//   sessions stay clean.
// - events forwarded to the renderer via listeners set from ipc.ts, tagged
//   with the originating session path so the renderer can route them.
// - ingest summary computed from a before/after wiki snapshot (wiki-scan.ts).
import { app } from "electron";
import { mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentSession,
  AgentSessionServices,
  SessionManager,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

type PiModule = typeof import("@earendil-works/pi-coding-agent");

/**
 * Model resolved from the registry, kept on the repo so a recreated ingest
 * session re-applies the same model without re-resolving (which would drop
 * dynamically registered providers like ollama/openai-compatible).
 */
type ResolvedModel = ReturnType<AgentSessionServices["modelRegistry"]["getAll"]>[number];

import { resolveOkfExtensionPath } from "./resource.ts";
import { diffSnapshots, listInputFiles, snapshotWiki } from "./wiki-scan.ts";
import { ok, err, errorMessage } from "../shared/result.ts";
import { mainT } from "./i18n.ts";
import type {
  AgentEvent,
  ChatMessage,
  CopilotLoginEvent,
  IngestSummary,
  LlmConfig,
  ModelOption,
  ProviderId,
  Result,
  SessionInfo,
} from "../shared/ipc-types.ts";
import { stripQueryCommand } from "../shared/text.ts";

/**
 * Dedicated agent directory for the app (NOT the user's ~/.pi/agent), so the
 * bundled pi-okf-wiki is the only extension loaded.
 */
function appAgentDir(): string {
  const dir = join(app.getPath("userData"), "agent");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * One live chat session in the pool. Held alive (not disposed) while the user
 * may switch away and back, so an in-flight turn keeps streaming in the
 * background.
 */
interface LiveChatSession {
  readonly session: AgentSession;
  readonly sessionManager: SessionManager;
  chatUnsub: () => void;
  readonly path: string;
  /** Accumulated text of the in-progress assistant message while streaming.
   *  The agent only stores the finalized message at `message_end`, so during
   *  streaming this is the only place the partial answer lives. */
  streamingAssistantText: string;
}

export class AgentRepository {
  private chatListener: ((event: AgentEvent) => void) | null = null;
  private ingestListener: ((event: AgentEvent) => void) | null = null;
  private summaryListener: ((summary: IngestSummary) => void) | null = null;
  private copilotLoginListener: ((event: CopilotLoginEvent) => void) | null = null;
  private copilotAbort: AbortController | null = null;
  private ingestUnsub: (() => void) | null = null;
  private pi: PiModule | null = null;
  private ingestModel: ResolvedModel | null = null;

  /** Live chat sessions keyed by session-file path. Insertion order is the
   *  LRU eviction order (see `touchLiveSession`). */
  private readonly liveSessions = new Map<string, LiveChatSession>();
  /** Path of the session currently displayed in the chat view. */
  private currentPath: string | null = null;
  /** Upper bound on concurrently resident live chat sessions — evict the
   *  least-recently-used idle session (never the current one) beyond this. */
  private static readonly MAX_LIVE_SESSIONS = 8;

  private constructor(
    private readonly workspace: string,
    private readonly services: AgentSessionServices,
    private ingestSession: AgentSession,
  ) {}

  static async create(workspace: string): Promise<Result<AgentRepository>> {
    try {
      const pi = await import("@earendil-works/pi-coding-agent");
      const extPath = resolveOkfExtensionPath();
      const agentDir = appAgentDir();
      const services = await pi.createAgentSessionServices({
        cwd: workspace,
        agentDir,
        resourceLoaderOptions: {
          additionalExtensionPaths: [extPath],
          // Isolate the app: only load our bundled pi-okf-wiki, skipping the
          // user's global and project-local extensions to avoid command-name
          // collisions (e.g. duplicate /wiki-query).
          noExtensions: true,
        },
      });

      // Disable auto-retry so failures surface immediately and the user can
      // retry via the chat retry button.
      services.settingsManager.setRetryEnabled(false);

      // Ingest runs in its own isolated ExtensionRuntime (see createIngestSession).
      const ingestSession = await createIngestSession(pi, services);

      const repo = new AgentRepository(workspace, services, ingestSession);
      repo.pi = pi;
      await repo.bindIngest();

      const sessions = await pi.SessionManager.list(workspace);
      if (sessions.length > 0) {
        await repo.openSession(sessions[0].path);
      } else {
        await repo.newSession();
      }
      return ok(repo);
    } catch (error) {
      return err<AgentRepository>(mainT("error.createAgent", { detail: errorMessage(error) }));
    }
  }

  // ─── listeners ───────────────────────────────────────────────────
  setChatListener(listener: (event: AgentEvent) => void): void {
    this.chatListener = listener;
  }
  setIngestListener(listener: (event: AgentEvent) => void): void {
    this.ingestListener = listener;
  }
  setSummaryListener(listener: (summary: IngestSummary) => void): void {
    this.summaryListener = listener;
  }
  setCopilotLoginListener(listener: (event: CopilotLoginEvent) => void): void {
    this.copilotLoginListener = listener;
  }

  /**
   * Subscribe to a session's events and forward the chat-relevant ones to
   * `emit`, tagged with `path` so the renderer can route them to the correct
   * session. Ingest uses `path: ""` (the renderer ignores it).
   */
  private forward(
    session: AgentSession,
    path: string,
    emit: (event: AgentEvent) => void,
  ): () => void {
    return session.subscribe((event) => {
      if (event.type === "agent_start") {
        emit({ type: "agent_start", sessionId: session.sessionId, sessionPath: path });
      } else if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        emit({
          type: "text_delta",
          sessionId: session.sessionId,
          sessionPath: path,
          delta: event.assistantMessageEvent.delta,
        });
      } else if (event.type === "agent_end") {
        // With auto-retry disabled, a failed turn ends here (stopReason
        // "error") instead of via `auto_retry_end`. Pack the real error into
        // the `agent_end` event so the renderer shows it immediately.
        const lastError = lastAssistantErrorMessage(event.messages);
        emit({
          type: "agent_end",
          sessionId: session.sessionId,
          sessionPath: path,
          aborted: lastAssistantAborted(event.messages),
          lastError: lastError || undefined,
        });
      } else if (event.type === "auto_retry_end" && !event.success) {
        // Defensive fallback in case auto-retry is re-enabled later.
        emit({
          type: "error",
          sessionPath: path,
          message: event.finalError ?? mainT("error.allRetriesFailed"),
        });
      }
    });
  }

  private async bindIngest(): Promise<void> {
    this.ingestUnsub?.();
    await this.ingestSession.bindExtensions({});
    this.ingestUnsub = this.forward(this.ingestSession, "", (e) => this.ingestListener?.(e));
  }

  /**
   * Create a live chat session for a SessionManager and add it to the pool.
   * Reloading the resource loader builds a fresh extension runtime; other
   * live sessions keep their already-captured runtime and stream undisturbed.
   * The `sessionStartEvent` is forwarded to extensions so they see normal
   * session_start lifecycle events.
   */
  private async createLiveChatSession(
    sessionManager: SessionManager,
    reason: "new" | "resume",
    previousSessionFile?: string,
  ): Promise<LiveChatSession> {
    await this.services.resourceLoader.reload();
    const sessionStartEvent: SessionStartEvent = {
      type: "session_start",
      reason,
      previousSessionFile,
    };
    const { session } = await this.pi!.createAgentSessionFromServices({
      services: this.services,
      sessionManager,
      sessionStartEvent,
    });
    await session.bindExtensions({});
    const path = sessionManager.getSessionFile() ?? "";
    if (this.ingestModel) {
      try {
        await session.setModel(this.ingestModel);
      } catch (error) {
        console.log(
          `[open-wiki-studio] setModel failed for session ${path}: ${errorMessage(error)}`,
        );
      }
    }
    const live: LiveChatSession = {
      session,
      sessionManager,
      chatUnsub: () => {},
      path,
      streamingAssistantText: "",
    };
    const eventUnsub = this.forward(session, path, (e) => this.chatListener?.(e));
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

  /**
   * Tear down the current ingest session and create a fresh one.
   *
   * After the wiki is deleted externally, the long-lived ingest session still
   * "remembers" the concepts it created and will not rebuild them. Starting
   * each ingest in a clean session forces the agent to reason purely from the
   * current disk state.
   */
  private async resetIngestSession(): Promise<void> {
    this.ingestUnsub?.();
    this.ingestUnsub = null;
    try {
      this.ingestSession.dispose();
    } catch {
      /* ignore — best-effort teardown */
    }
    this.ingestSession = await createIngestSession(
      this.pi!,
      this.services,
      this.ingestModel ?? undefined,
    );
    await this.bindIngest();
  }

  /** Abort and dispose a pooled live chat session, removing it from the pool. */
  private dropLiveChatSession(path: string): void {
    const live = this.liveSessions.get(path);
    if (!live) return;
    live.chatUnsub();
    try {
      live.session.dispose();
    } catch {
      /* ignore */
    }
    this.liveSessions.delete(path);
    if (this.currentPath === path) this.currentPath = null;
  }

  /** Mark a pooled session as most-recently-used by re-inserting it at the back
   *  of the LRU-ordered map. */
  private touchLiveSession(path: string): void {
    const live = this.liveSessions.get(path);
    if (!live) return;
    this.liveSessions.delete(path);
    this.liveSessions.set(path, live);
  }

  /**
   * Evict idle pooled sessions beyond `MAX_LIVE_SESSIONS`. Walks the map in
   * LRU order and disposes the first idle, non-current session it finds,
   * repeating until under the cap. Streaming and current sessions are never
   * evicted.
   */
  private evictIdleSessions(): void {
    while (this.liveSessions.size > AgentRepository.MAX_LIVE_SESSIONS) {
      let evicted = false;
      for (const [path, live] of this.liveSessions) {
        if (path === this.currentPath) continue;
        if (live.session.isStreaming) continue;
        this.dropLiveChatSession(path);
        evicted = true;
        break;
      }
      if (!evicted) break;
    }
  }

  // ─── LLM ────────────────────────────────────────────────────────
  hasLlmConfig(): boolean {
    return this.services.modelRegistry.getAvailable().length > 0;
  }

  async configureLlm(config: LlmConfig): Promise<Result<void>> {
    try {
      const mr = this.services.modelRegistry;
      const auth = this.services.authStorage;
      const providerName =
        config.provider === "openai-compatible" ? "openai-compatible" : config.provider;

      if (config.provider === "ollama" || config.provider === "openai-compatible") {
        const baseUrl =
          config.baseUrl ?? (config.provider === "ollama" ? "http://localhost:11434/v1" : "");
        mr.registerProvider(providerName, {
          name: config.provider === "ollama" ? "Ollama" : "OpenAI-compatible",
          baseUrl,
          // registerProvider requires an apiKey; for providers that don't need
          // one, pass a placeholder.
          apiKey: config.apiKey || (config.provider === "ollama" ? "ollama" : "not-needed"),
          // "openai-completions" is the OpenAI chat completions wire protocol,
          // spoken by Ollama and OpenAI-compatible endpoints.
          api: "openai-completions",
          models: [
            {
              id: config.modelId,
              name: config.modelId,
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 8192,
            },
          ],
        });
      } else if (config.apiKey) {
        auth.set(config.provider, { type: "api_key", key: config.apiKey });
      }

      // No refresh() here — it reloads models from disk and would drop the
      // dynamically registered providers above.
      const model =
        mr.getAll().find((m) => m.provider === providerName && m.id === config.modelId) ??
        mr.getAll().find((m) => m.id === config.modelId);
      if (model) {
        this.ingestModel = model;
        await this.ingestSession.setModel(model);
        for (const live of this.liveSessions.values()) {
          try {
            await live.session.setModel(model);
          } catch {
            /* best-effort — a streaming session may reject reconfiguration */
          }
        }
      } else {
        // Model not found in registry — surface an error so the config form
        // can warn the user immediately. The previously configured model (if
        // any) stays active.
        return err<void>(
          mainT("error.modelNotFound", {
            provider: config.provider,
            modelId: config.modelId,
          }),
        );
      }
      return ok(undefined);
    } catch (error) {
      return err<void>(errorMessage(error));
    }
  }

  // ─── GitHub Copilot OAuth ────────────────────────────────────────
  /** For Copilot a non-empty result doubles as the "already logged in" probe:
   *  the form shows the model dropdown instead of the login button. */
  listAvailableModels(provider: ProviderId): Result<readonly ModelOption[]> {
    try {
      const models = this.services.modelRegistry
        .getAvailable()
        .filter((model) => model.provider === provider)
        .map((model) => ({ id: model.id, name: model.name }));
      return ok(models);
    } catch (error) {
      return err<readonly ModelOption[]>(
        mainT("error.listModels", { detail: errorMessage(error) }),
      );
    }
  }

  /**
   * Load selectable models for a provider, given credentials/base URL.
   *
   * For anthropic/openai/google: store the API key so `getAvailable()` can
   * surface the built-in catalog. For ollama: fetch local models from
   * `{baseUrl}/v1/models` and cloud models from `https://ollama.com/v1/models`,
   * applying the cloud suffix rule. For openai-compatible: fetch
   * `{baseUrl}/v1/models` (optional Bearer key).
   *
   * Fetch failures degrade gracefully: Ollama returns whichever of local/cloud
   * succeeded; openai-compatible returns an error only if the fetch itself
   * fails. See ADR 0001.
   */
  async loadModels(
    provider: ProviderId,
    apiKey?: string,
    baseUrl?: string,
  ): Promise<Result<readonly ModelOption[]>> {
    try {
      if (provider === "github-copilot") {
        return err<readonly ModelOption[]>("Copilot uses loginCopilot(), not loadModels()");
      }
      if (provider === "ollama") {
        const base = ensureV1Suffix(baseUrl ?? "http://localhost:11434/v1");
        return ok(await fetchOllamaModels(base));
      }
      if (provider === "openai-compatible") {
        if (!baseUrl) return err<readonly ModelOption[]>(mainT("error.baseUrlRequired"));
        return ok(await fetchOpenAiCompatibleModels(baseUrl, apiKey));
      }
      // anthropic / openai / google — static built-in catalog, auth-gated.
      if (apiKey) {
        this.services.authStorage.set(provider, { type: "api_key", key: apiKey });
      }
      const models = this.services.modelRegistry
        .getAvailable()
        .filter((model) => model.provider === provider)
        .map((model) => ({ id: model.id, name: model.name }));
      return ok(models);
    } catch (error) {
      return err<readonly ModelOption[]>(errorMessage(error));
    }
  }

  /** Run the Copilot OAuth device-code flow. `onPrompt` is auto-answered with
   *  "" (github.com, no GHES). Blocks until the user authorizes; credential is
   *  persisted by AuthStorage. Cancellable via `cancelCopilotLogin()`. */
  async loginCopilot(): Promise<Result<readonly ModelOption[]>> {
    this.copilotAbort?.abort();
    this.copilotAbort = new AbortController();
    const signal = this.copilotAbort.signal;
    try {
      await this.services.authStorage.login("github-copilot", {
        onAuth: () => {},
        onDeviceCode: (info) => {
          this.copilotLoginListener?.({
            type: "device_code",
            userCode: info.userCode,
            verificationUri: info.verificationUri,
          });
        },
        // Auto-answer the GHES domain prompt → github.com (no GHES).
        onPrompt: async () => "",
        onProgress: (message) => {
          this.copilotLoginListener?.({ type: "progress", message });
        },
        onSelect: async () => undefined,
        signal,
      });
      this.copilotAbort = null;
      return this.listAvailableModels("github-copilot");
    } catch (error) {
      this.copilotAbort = null;
      // Abort (cancel) vs. real failure — the renderer shows a neutral notice
      // instead of an error toast on `cause: "cancelled"`.
      if (signal.aborted) {
        return err<readonly ModelOption[]>(
          "Login cancelled",
          { cause: "cancelled" },
        );
      }
      return err<readonly ModelOption[]>(errorMessage(error));
    }
  }

  async cancelCopilotLogin(): Promise<Result<void>> {
    try {
      this.copilotAbort?.abort();
      this.copilotAbort = null;
      return ok(undefined);
    } catch (error) {
      return err<void>(mainT("error.cancelLogin", { detail: errorMessage(error) }));
    }
  }

  async logoutCopilot(): Promise<Result<void>> {
    try {
      this.services.authStorage.logout("github-copilot");
      return ok(undefined);
    } catch (error) {
      return err<void>(mainT("error.logout", { detail: errorMessage(error) }));
    }
  }

  // ─── sessions ───────────────────────────────────────────────────
  async listSessions(): Promise<Result<readonly SessionInfo[]>> {
    try {
      const sessions = await this.pi!.SessionManager.list(this.workspace);
      return ok(
        sessions.map((s) => ({
          path: s.path,
          name: stripQueryCommand(s.name ?? s.firstMessage ?? mainT("session.newDefault")),
          lastModified: s.modified.toISOString(),
          streaming: this.liveSessions.get(s.path)?.session.isStreaming ?? false,
        })),
      );
    } catch (error) {
      return err<readonly SessionInfo[]>(
        mainT("error.listSessions", { detail: errorMessage(error) }),
      );
    }
  }

  async newSession(): Promise<Result<SessionInfo>> {
    try {
      const previousSessionFile = this.currentPath ?? undefined;
      const sessionManager = this.pi!.SessionManager.create(this.workspace);
      const live = await this.createLiveChatSession(
        sessionManager,
        "new",
        previousSessionFile,
      );
      this.liveSessions.set(live.path, live);
      this.currentPath = live.path;
      this.evictIdleSessions();
      return ok({
        path: live.path,
        name: mainT("session.newDefault"),
        lastModified: new Date().toISOString(),
        streaming: false,
      });
    } catch (error) {
      return err<SessionInfo>(
        mainT("error.createSession", { detail: errorMessage(error) }),
      );
    }
  }

  async deleteSession(path: string): Promise<Result<void>> {
    if (path === this.currentPath) {
      return err<void>(mainT("error.cannotDeleteActiveSession"), { path });
    }
    this.dropLiveChatSession(path);
    try {
      await unlink(path);
      return ok(undefined);
    } catch (error) {
      return err<void>(
        mainT("error.deleteSession", { detail: errorMessage(error) }),
        { path },
      );
    }
  }

  async openSession(path: string): Promise<Result<SessionInfo>> {
    try {
      const existing = this.liveSessions.get(path);
      if (existing) {
        this.currentPath = path;
        this.touchLiveSession(path);
        const sessions = await this.pi!.SessionManager.list(this.workspace);
        const info = sessions.find((s) => s.path === path);
        return ok({
          path,
          name: stripQueryCommand(info?.name ?? info?.firstMessage ?? mainT("session.newDefault")),
          lastModified: (info?.modified ?? new Date()).toISOString(),
          streaming: existing.session.isStreaming,
        });
      }
      const previousSessionFile = this.currentPath ?? undefined;
      const sessionManager = this.pi!.SessionManager.open(path);
      const live = await this.createLiveChatSession(
        sessionManager,
        "resume",
        previousSessionFile,
      );
      this.liveSessions.set(live.path, live);
      this.currentPath = live.path;
      this.evictIdleSessions();
      const sessions = await this.pi!.SessionManager.list(this.workspace);
      const info = sessions.find((s) => s.path === path);
      return ok({
        path,
        name: stripQueryCommand(info?.name ?? info?.firstMessage ?? mainT("session.newDefault")),
        lastModified: (info?.modified ?? new Date()).toISOString(),
        streaming: false,
      });
    } catch (error) {
      return err<SessionInfo>(
        mainT("error.openSession", { detail: errorMessage(error) }),
      );
    }
  }

  async getMessages(path: string): Promise<Result<readonly ChatMessage[]>> {
    try {
      const live = this.liveSessions.get(path);
      const messages: ReadonlyArray<AgentMessageLike> = live
        ? live.session.messages
        : this.pi!.SessionManager.open(path).buildSessionContext().messages;
      const out = extractMessages(messages);
      // Append in-progress answer for sessions still streaming — the
      // finalized message only hits session.messages at message_end.
      if (live && live.session.isStreaming && live.streamingAssistantText.trim() !== "") {
        out.push({ role: "assistant", text: live.streamingAssistantText });
      }
      return ok(out);
    } catch (error) {
      return err<readonly ChatMessage[]>(
        mainT("error.readSession", { detail: errorMessage(error) }),
      );
    }
  }

  // ─── agent actions ──────────────────────────────────────────────
  async ask(question: string): Promise<Result<void>> {
    // `ask`/`ingest` only capture *synchronous* failures of `prompt()` (unknown
    // command, disposed session). Turn-level errors surface as `error` events
    // on the stream (handled in `forward()`), NOT through this return value.
    try {
      const live = this.currentPath ? this.liveSessions.get(this.currentPath) : undefined;
      if (!live) {
        return err<void>(mainT("error.noActiveSession"));
      }
      await live.session.prompt(`/wiki-query ${question}`);
      return ok(undefined);
    } catch (error) {
      return err<void>(errorMessage(error));
    }
  }

  /**
   * Retry the last chat turn by re-prompting with the same question.
   *
   * Intentionally NON-destructive (no session branching): Pi sessions do not
   * persist the leaf pointer across restarts, so a branch-based retry targeted
   * the wrong message and wiped the conversation. Re-prompting appends a fresh
   * user+assistant pair; `extractMessages` drops the empty failed assistant
   * and collapses consecutive duplicate user messages, so the UI stays clean
   * after restart without destructive session mutation.
   */
  async retryChat(question: string): Promise<Result<void>> {
    try {
      const live = this.currentPath ? this.liveSessions.get(this.currentPath) : undefined;
      if (!live) {
        return err<void>(mainT("error.noActiveSession"));
      }
      await live.session.prompt(`/wiki-query ${question}`);
      return ok(undefined);
    } catch (error) {
      return err<void>(errorMessage(error));
    }
  }

  async ingest(): Promise<Result<void>> {
    try {
      // Start every ingest in a fresh session so the agent has no stale memory
      // of a wiki that may have been deleted externally.
      await this.resetIngestSession();

      const before = await snapshotWiki(this.workspace);

      // /wiki-update hands non-conformant input files to the agent via
      // `pi.sendUserMessage(...)`, which is fire-and-forget: `prompt()` resolves
      // BEFORE the agent turn finishes. The concept writing + input→archive
      // moving happens during that turn and is finalized in the `agent_end`
      // extension handler (finalizePendingUpdate), which runs BEFORE session
      // event listeners receive `agent_end`. So we must wait for the turn to
      // complete before snapshotting — otherwise the after-snapshot shows no
      // new concepts and `leftover` still lists the input files.
      //
      // For conformant-only (or empty) input no turn starts, so if no
      // `agent_start` arrives within a grace window the state is already final.
      // The wait is a race so a mid-turn failure or a stuck turn (hard timeout)
      // rejects instead of hanging IngestView on "running" forever.
      const TURN_GRACE_MS = 3000; // wait for agent_start after prompt
      const TURN_TIMEOUT_MS = 5 * 60 * 1000; // hard cap for a single turn

      let sawStart = false;
      let resolveStart: () => void = () => {};
      let rejectStart: (error: Error) => void = () => {};
      let resolveEnd: () => void = () => {};
      let rejectEnd: (error: Error) => void = () => {};
      const startedPromise = new Promise<void>((res, rej) => {
        resolveStart = res;
        rejectStart = rej;
      });
      const endedPromise = new Promise<void>((res, rej) => {
        resolveEnd = res;
        rejectEnd = rej;
      });

      const off = this.ingestSession.subscribe((event) => {
        if (event.type === "agent_start") {
          if (!sawStart) {
            sawStart = true;
            resolveStart();
          }
        } else if (event.type === "agent_end" && sawStart) {
          const errorMessage = lastAssistantErrorMessage(event.messages);
          if (errorMessage) rejectEnd(new Error(errorMessage));
          else resolveEnd();
        } else if (event.type === "auto_retry_end" && !event.success) {
          const e = new Error(event.finalError ?? mainT("error.allRetriesFailed"));
          rejectStart(e);
          rejectEnd(e);
        }
      });
      try {
        await this.ingestSession.prompt("/wiki-update");
        // Race agent_start against a grace window. sendUserMessage is async,
        // so agent_start may fire a few ticks after the command handler returns.
        const noTurn = new Promise<false>((resolve) =>
          setTimeout(() => resolve(false), TURN_GRACE_MS),
        );
        const started = await Promise.race([
          startedPromise.then(() => true as const),
          noTurn,
        ]);
        if (started) {
          // Turn started — wait for agent_end, error, or hard timeout.
          await Promise.race([
            endedPromise,
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(mainT("error.ingestTimeout"))),
                TURN_TIMEOUT_MS,
              ),
            ),
          ]);
        }
      } finally {
        off();
      }

      const after = await snapshotWiki(this.workspace);
      const diff = diffSnapshots(before, after);
      const leftover = await listInputFiles(this.workspace);

      // No-progress detection: a turn ran (sawStart) but the wiki did not change
      // while input files remain — the signature of a failed turn that ended
      // without `stopReason: "error"` (e.g. an empty provider response). Without
      // this guard the UI would show "done" with 0 created and all files as
      // leftover, silently masking a misconfigured/unreachable provider.
      if (
        sawStart &&
        diff.created.length + diff.updated.length === 0 &&
        leftover.length > 0
      ) {
        return err<void>(mainT("error.ingestNoProgress"));
      }

      const summary: IngestSummary = {
        leftover,
        createdConcepts: diff.created,
        updatedConcepts: diff.updated,
        wikiConceptCountBefore: before.entries.size,
        wikiConceptCountAfter: after.entries.size,
      };
      this.summaryListener?.(summary);
      return ok(undefined);
    } catch (error) {
      return err<void>(errorMessage(error));
    }
  }

  /**
   * Abort only the current chat session's in-flight turn. Background turns
   * keep streaming and the ingest session is left untouched. Idempotent.
   */
  async abortChat(): Promise<Result<void>> {
    try {
      if (this.currentPath) {
        const live = this.liveSessions.get(this.currentPath);
        if (live) await live.session.abort();
      }
      return ok(undefined);
    } catch (error) {
      return err<void>(errorMessage(error));
    }
  }

  async abort(): Promise<Result<void>> {
    try {
      // Abort the current chat turn (background turns keep running) and any
      // in-flight ingest turn.
      if (this.currentPath) {
        const live = this.liveSessions.get(this.currentPath);
        if (live) await live.session.abort();
      }
      await this.ingestSession.abort();
      return ok(undefined);
    } catch (error) {
      return err<void>(errorMessage(error));
    }
  }

  async dispose(): Promise<void> {
    this.ingestUnsub?.();
    for (const path of [...this.liveSessions.keys()]) {
      this.dropLiveChatSession(path);
    }
    try {
      this.ingestSession.dispose();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Create a fresh, isolated ingest session.
 *
 * The ingest session gets its OWN ExtensionRuntime. Without the reload here it
 * would reuse a chat session's runtime; when that chat session is later
 * disposed, `dispose()` invalidates the shared runtime and `pi.sendUserMessage`
 * inside /wiki-update would throw "stale ctx". Reloading builds a fresh runtime
 * the chat sessions do not share. The optional `model` is applied at creation
 * so a recreated ingest session keeps the configured LLM.
 */
async function createIngestSession(
  pi: PiModule,
  services: AgentSessionServices,
  model?: ResolvedModel,
): Promise<AgentSession> {
  await services.resourceLoader.reload();
  return (
    await pi.createAgentSessionFromServices({
      services,
      sessionManager: pi.SessionManager.inMemory(),
      model,
    })
  ).session;
}

/** Minimal structural shape of an agent message used for extraction. */
type AgentMessageLike = {
  role?: string;
  content?: string | ReadonlyArray<{ type: string; text?: string }>;
};

/**
 * Whether the last assistant message in an `agent_end` event was aborted
 * (`stopReason === "aborted"`), so the renderer skips the "no response" error.
 */
function lastAssistantAborted(messages: ReadonlyArray<{ role?: string; stopReason?: string }>): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "assistant") return message.stopReason === "aborted";
  }
  return false;
}

/**
 * The error message of the last assistant message in an `agent_end` event
 * when the turn failed (`stopReason === "error"`); `undefined` for
 * normal/aborted turns.
 */
function lastAssistantErrorMessage(
  messages: ReadonlyArray<{ role?: string; stopReason?: string; errorMessage?: string }>,
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "assistant") {
      if (message.stopReason !== "error") return undefined;
      // Provider errors arrive as the OpenAI SDK's `APIError` message,
      // formatted as `${status} ${body}`. When the body itself begins with the
      // status code (e.g. "404 page not found"), this doubles the prefix.
      // Collapse the redundant leading status.
      return dedupeProviderErrorMessage(message.errorMessage ?? "");
    }
  }
  return undefined;
}

/**
 * Collapse the OpenAI SDK's doubled status prefix in provider error messages.
 * `APIError.makeMessage` formats errors as `${status} ${msg}`; when `msg` is
 * the raw body and starts with the status code (e.g. "404 page not found"),
 * the result is "404 404 page not found". This detects "<status> <status><rest>"
 * and returns "<status><rest>". Non-matching messages are unchanged.
 */
function dedupeProviderErrorMessage(message: string): string {
  const match = /^(\d{3}) \1(?=\D)(.*)$/.exec(message);
  return match ? `${match[1]}${match[2]}` : message;
}

/** Map raw agent messages to the renderer's ChatMessage list: strips the
 *  /wiki-query command prefix from user messages, drops empty finalized
 *  assistant messages, and collapses consecutive duplicate user messages
 *  left behind by retries. */
function extractMessages(messages: ReadonlyArray<AgentMessageLike>): ChatMessage[] {
  const out: ChatMessage[] = [];
  // Tracks the text of the most recently pushed user message so a run of
  // identical consecutive user messages (each retry re-prompts, appending a
  // duplicate) collapses to a single one. Reset by any non-user message.
  let lastUserText: string | undefined;
  for (const message of messages) {
    const role = (message as { role?: string }).role;
    if (role !== "user" && role !== "assistant") continue;
    const text = extractText(
      (message as { content?: ReadonlyArray<{ type: string; text?: string }> }).content,
    );
    const clean = role === "user" ? stripQueryCommand(text) : text;
    // Drop empty user AND empty assistant messages. A finalized empty
    // assistant is always a failed/aborted turn artifact (during streaming the
    // partial lives in `streamingAssistantText`); keeping it would surface as
    // empty bubbles. Dropping it also self-heals sessions corrupted by the old
    // retry path.
    if (clean.trim() === "") continue;
    if (role === "user") {
      if (clean === lastUserText && out.length > 0 && out[out.length - 1].role === "user") {
        continue;
      }
      lastUserText = clean;
    } else {
      lastUserText = undefined;
    }
    out.push({ role, text: clean });
  }
  return out;
}

function extractText(content: string | ReadonlyArray<{ type: string; text?: string }> | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("");
}

// ─── Model-list fetch helpers (Ollama / openai-compatible) ──────────────
// See ADR 0001. All endpoints speak the OpenAI-compat /v1/models shape:
// { data: [{ id: string, ... }] }. Cloud models get a runnable suffix so the
// local Ollama server routes them to Ollama Cloud (requires `ollama signin`).

/** Per-request timeout for model-list fetches. */
const MODEL_FETCH_TIMEOUT_MS = 6000;
/** Public Ollama Cloud model catalog (OpenAI-compat shape, no auth). */
const OLLAMA_CLOUD_CATALOG_URL = "https://ollama.com/v1/models";

/** Ensure a base URL ends with `/v1` so `{base}/models` resolves. */
function ensureV1Suffix(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

/** Runnable cloud model id per the suffix rule in ADR 0001. */
function ollamaCloudId(id: string): string {
  return id.includes(":") ? `${id}-cloud` : `${id}:cloud`;
}

interface OpenAiModelList {
  readonly data?: ReadonlyArray<{ readonly id?: string }>;
}

async function fetchModelList(url: string, apiKey?: string): Promise<readonly string[]> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(MODEL_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const json = (await response.json()) as OpenAiModelList;
  if (!Array.isArray(json.data)) return [];
  return json.data
    .map((entry) => entry?.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

/**
 * Fetch Ollama local + cloud models. Local and cloud fetch failures are
 * swallowed independently: the dropdown gets whichever sources succeeded.
 * Only if both fail does this throw, surfacing the local error.
 */
async function fetchOllamaModels(baseUrl: string): Promise<readonly ModelOption[]> {
  const localIds = await fetchModelList(`${baseUrl}/models`).catch(() => [] as string[]);
  const cloudIds = await fetchModelList(OLLAMA_CLOUD_CATALOG_URL).catch(() => [] as string[]);

  const seen = new Set<string>();
  const models: ModelOption[] = [];

  for (const id of localIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    models.push({ id, name: id });
  }
  for (const id of cloudIds) {
    const cloudId = ollamaCloudId(id);
    if (seen.has(cloudId)) continue;
    seen.add(cloudId);
    models.push({ id: cloudId, name: `${id} (cloud)` });
  }

  if (models.length === 0) {
    // Both fetches returned nothing — most likely the local Ollama server is
    // not running. Throw so the form shows an actionable error.
    throw new Error(mainT("error.ollamaNoModels", { baseUrl }));
  }
  return models;
}

/** Fetch models from an OpenAI-compatible endpoint (`{baseUrl}/v1/models`). */
async function fetchOpenAiCompatibleModels(baseUrl: string, apiKey?: string): Promise<readonly ModelOption[]> {
  const normalized = ensureV1Suffix(baseUrl);
  const ids = await fetchModelList(`${normalized}/models`, apiKey);
  if (ids.length === 0) {
    throw new Error(mainT("error.endpointNoModels", { url: normalized }));
  }
  return ids.map((id) => ({ id, name: id }));
}
