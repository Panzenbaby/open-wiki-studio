// AgentRepository: hosts the embedded Pi agent for one workspace.
//
// - chat runtime (AgentSessionRuntime) with persistent SessionManager per
//   workspace; new/resume sessions via the runtime.
// - a separate ephemeral in-memory AgentSession for /wiki-update so chat
//   sessions stay clean.
// - events forwarded to the renderer via listeners set from ipc.ts.
// - ingest summary computed from a before/after wiki snapshot (wiki-scan.ts).
import { app } from "electron";
import { mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentSession,
  AgentSessionRuntime,
  AgentSessionServices,
  CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";

type PiModule = typeof import("@earendil-works/pi-coding-agent");

/**
 * Model resolved from the registry. Stored on the repo so a recreated ingest
 * session can re-apply the same model without re-resolving (which would drop
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
  IngestSummary,
  LlmConfig,
  Result,
  SessionInfo,
} from "../shared/ipc-types.ts";
import { stripQueryCommand } from "../shared/text.ts";

/**
 * Dedicated, isolated agent directory for the app (NOT the user's ~/.pi/agent).
 * Keeps auth/models/settings/extensions scoped per-app so the bundled
 * pi-okf-wiki is the only extension loaded — no collision with the user's
 * global or project-local Pi extensions.
 */
function appAgentDir(): string {
  const dir = join(app.getPath("userData"), "agent");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export class AgentRepository {
  private chatListener: ((event: AgentEvent) => void) | null = null;
  private ingestListener: ((event: AgentEvent) => void) | null = null;
  private summaryListener: ((summary: IngestSummary) => void) | null = null;
  private chatUnsub: (() => void) | null = null;
  private ingestUnsub: (() => void) | null = null;
  private pi: PiModule | null = null;
  private ingestModel: ResolvedModel | null = null;

  private constructor(
    private readonly workspace: string,
    private readonly services: AgentSessionServices,
    private readonly runtime: AgentSessionRuntime,
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
          // Isolate the app: only load our bundled pi-okf-wiki. Skip the
          // user's global (~/.pi/agent) and project-local (<workspace>/.pi/extensions)
          // extensions to avoid command-name collisions (e.g. duplicate /wiki-query).
          noExtensions: true,
        },
      });
      const sessionManager = pi.SessionManager.create(workspace);

      const createRuntime: CreateAgentSessionRuntimeFactory = async ({
        sessionManager: sm,
        sessionStartEvent,
      }) => {
        // Reload the resource loader so this session gets a FRESH extension
        // runtime. Without this, the shared ExtensionRuntime is invalidated
        // when a previous session is torn down (switchSession/newSession calls
        // dispose() -> runtime.invalidate()), and pi.sendUserMessage would
        // throw "stale ctx" — breaking /wiki-query which uses sendUserMessage.
        await services.resourceLoader.reload();
        const session = await pi.createAgentSessionFromServices({
          services,
          sessionManager: sm,
          sessionStartEvent,
        });
        return { ...session, services, diagnostics: services.diagnostics };
      };

      const runtime = await pi.createAgentSessionRuntime(createRuntime, {
        cwd: workspace,
        agentDir,
        sessionManager,
      });

      // Ingest runs in its own isolated ExtensionRuntime — see
      // `createIngestSession` for the rationale.
      const ingestSession = await createIngestSession(pi, services);

      const repo = new AgentRepository(workspace, services, runtime, ingestSession);
      repo.pi = pi;
      await repo.bindChat();
      await repo.bindIngest();
      return ok(repo);
    } catch (error) {
      return err<AgentRepository>(`Failed to create agent: ${errorMessage(error)}`);
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

  private forward(session: AgentSession, emit: (e: AgentEvent) => void): () => void {
    return session.subscribe((event) => {
      if (event.type === "agent_start") {
        emit({ type: "agent_start", sessionId: session.sessionId });
      } else if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        emit({ type: "text_delta", sessionId: session.sessionId, delta: event.assistantMessageEvent.delta });
      } else if (event.type === "agent_end") {
        emit({ type: "agent_end", sessionId: session.sessionId });
      } else if (event.type === "auto_retry_end" && !event.success) {
        emit({ type: "error", message: event.finalError ?? mainT("error.allRetriesFailed") });
      }
    });
  }

  private async bindChat(): Promise<void> {
    this.chatUnsub?.();
    const session = this.runtime.session;
    await session.bindExtensions({});
    this.chatUnsub = this.forward(session, (e) => this.chatListener?.(e));
  }

  private async bindIngest(): Promise<void> {
    this.ingestUnsub?.();
    await this.ingestSession.bindExtensions({});
    this.ingestUnsub = this.forward(this.ingestSession, (e) => this.ingestListener?.(e));
  }

  /**
   * Tear down the current ingest session and create a fresh one.
   *
   * The ingest session is otherwise long-lived (in-memory, reused across
   * ingests), so the agent accumulates prior turns. After the wiki is deleted
   * externally, the agent still "remembers" the concepts it created and will
   * NOT rebuild them — even though /wiki-update reports the (now empty) disk
   * state in its prompt. Starting each ingest in a clean session forces the
   * agent to reason purely from the current disk state.
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
          // registerProvider requires an apiKey when defining models (validator rejects
          // empty string); for providers that don't need one, pass a placeholder.
          apiKey: config.apiKey || (config.provider === "ollama" ? "ollama" : "not-needed"),
          // "openai-completions" is a KnownApi in pi-ai (the OpenAI chat
          // completions wire protocol) and is the protocol Ollama +
          // OpenAI-compatible endpoints speak.
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

      // Note: no refresh() here — it reloads models from disk and would drop
      // the dynamically registered providers (ollama/openai-compatible) above.
      const model =
        mr.getAll().find((m) => m.provider === providerName && m.id === config.modelId) ??
        mr.getAll().find((m) => m.id === config.modelId);
      if (model) {
        // Remember the resolved model so a recreated ingest session
        // (see resetIngestSession) can re-apply it without re-resolving.
        this.ingestModel = model;
        await this.runtime.session.setModel(model);
        await this.ingestSession.setModel(model);
      } else {
        console.log(
          `[open-wiki-studio] LLM model not found in registry: ${config.provider}/${config.modelId}`,
        );
      }
      return ok(undefined);
    } catch (error) {
      return err<void>(`Failed to configure LLM: ${errorMessage(error)}`);
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
        })),
      );
    } catch (error) {
      return err<readonly SessionInfo[]>(`Failed to list sessions: ${errorMessage(error)}`);
    }
  }

  async newSession(): Promise<Result<SessionInfo>> {
    try {
      await this.runtime.newSession();
      await this.bindChat();
      return ok({
        path: this.runtime.session.sessionFile ?? "",
        name: mainT("session.newDefault"),
        lastModified: new Date().toISOString(),
      });
    } catch (error) {
      return err<SessionInfo>(`Failed to create session: ${errorMessage(error)}`);
    }
  }

  async deleteSession(path: string): Promise<Result<void>> {
    // Refuse to delete the session the runtime is currently bound to —
    // unlinking it would leave the runtime pointing at a file that no longer
    // exists, and the next prompt would fail opaquely. Callers must switch to
    // a different session first (the UI does this by creating a new session
    // after a successful delete when the deleted one was current).
    if (path === this.runtime.session.sessionFile) {
      return err<void>(`Cannot delete the active session`, { path });
    }
    try {
      await unlink(path);
      return ok(undefined);
    } catch (error) {
      return err<void>(
        `Failed to delete session: ${errorMessage(error)}`,
        { path },
      );
    }
  }

  async openSession(path: string): Promise<Result<SessionInfo>> {
    try {
      await this.runtime.switchSession(path);
      await this.bindChat();
      const sessions = await this.pi!.SessionManager.list(this.workspace);
      const info = sessions.find((s) => s.path === path);
      return ok({
        path,
        name: stripQueryCommand(info?.name ?? info?.firstMessage ?? mainT("session.newDefault")),
        lastModified: (info?.modified ?? new Date()).toISOString(),
      });
    } catch (error) {
      return err<SessionInfo>(`Failed to open session: ${errorMessage(error)}`);
    }
  }

  async getMessages(): Promise<Result<readonly ChatMessage[]>> {
    try {
      const messages = this.runtime.session.messages;
      const out: ChatMessage[] = [];
      for (const message of messages) {
        const role = (message as { role?: string }).role;
        if (role !== "user" && role !== "assistant") continue;
        const text = extractText(
          (message as { content?: ReadonlyArray<{ type: string; text?: string }> }).content,
        );
        const clean = role === "user" ? stripQueryCommand(text) : text;
        if (clean.trim() !== "" || role === "assistant") out.push({ role, text: clean });
      }
      return ok(out);
    } catch (error) {
      return err<readonly ChatMessage[]>(`Failed to read session: ${errorMessage(error)}`);
    }
  }

  // ─── agent actions ──────────────────────────────────────────────
  async ask(question: string): Promise<Result<void>> {
    // Note on Result<void> semantics: `ask`/`ingest` only capture
    // *synchronous* failures of `prompt()` (e.g. the command is unknown, the
    // session is disposed). The agent runs asynchronously after `prompt`
    // resolves; turn-level errors surface as `error` events on the event
    // stream (handled in `forward()`), NOT through this return value. Callers
    // must not assume `ok` means the agent finished successfully.
    try {
      await this.runtime.session.prompt(`/wiki-query ${question}`);
      return ok(undefined);
    } catch (error) {
      return err<void>(`Ask failed: ${errorMessage(error)}`);
    }
  }

  async ingest(): Promise<Result<void>> {
    try {
      // Start every ingest in a fresh session so the agent has no stale
      // memory of a wiki that may have been deleted externally. See
      // resetIngestSession for the rationale.
      await this.resetIngestSession();

      const before = await snapshotWiki(this.workspace);

      // /wiki-update hands non-conformant input files to the agent via
      // `pi.sendUserMessage(...)`, which is fire-and-forget: the command
      // handler returns immediately and `prompt("/wiki-update")` resolves
      // BEFORE the agent turn finishes. The actual concept writing +
      // input→archive moving happens during that turn and is finalized in
      // the `agent_end` extension handler (finalizePendingUpdate), which runs
      // BEFORE session event listeners receive `agent_end`. So we must wait
      // for that turn to complete before snapshotting — otherwise the
      // after-snapshot shows no new concepts and `leftover` still lists the
      // input files (which get moved only on agent_end), making the IngestView
      // claim the files were not processed.
      //
      // For conformant-only (or empty) input no turn is started, so we must
      // not wait forever: if no `agent_start` arrives within a grace window
      // after the command returns, the run needed no turn and the state is
      // already final.
      //
      // The wait is structured as a race so a mid-turn failure (`error`
      // event) or a stuck turn (hard timeout) rejects instead of hanging
      // the IngestView on "running" forever.
      const TURN_GRACE_MS = 3000; // wait this long for agent_start after prompt
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
          resolveEnd();
        } else if (event.type === "auto_retry_end" && !event.success) {
          const e = new Error(event.finalError ?? mainT("error.allRetriesFailed"));
          rejectStart(e);
          rejectEnd(e);
        }
      });
      try {
        await this.ingestSession.prompt("/wiki-update");
        // Race agent_start against a grace window. sendUserMessage is async,
        // so agent_start may fire a few ticks after the command handler
        // returns; if it doesn't fire at all, no turn was needed.
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
      return err<void>(`Ingest failed: ${errorMessage(error)}`);
    }
  }

  async abort(): Promise<Result<void>> {
    try {
      await this.runtime.session.abort();
      await this.ingestSession.abort();
      return ok(undefined);
    } catch (error) {
      return err<void>(`Abort failed: ${errorMessage(error)}`);
    }
  }

  async dispose(): Promise<void> {
    this.chatUnsub?.();
    this.ingestUnsub?.();
    try {
      await this.runtime.dispose();
    } catch {
      /* ignore */
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
 * The ingest session gets its OWN ExtensionRuntime, unaffected by the chat
 * session's lifecycle. Both sessions share the same `services` (and thus the
 * same cached `extensionsResult.runtime`), so without the reload here the
 * ingest session would reuse the chat session's runtime. When the chat
 * session is later switched out (openSession/newSession on the dashboard),
 * `dispose()` invalidates that shared runtime, and `pi.sendUserMessage`
 * inside /wiki-update would throw "stale ctx" — silently breaking the ingest.
 *
 * Reloading builds a fresh `extensionsResult` with a new runtime; the chat
 * session keeps its already-captured runtime reference, and the ingest
 * session captures the fresh one — fully isolated. The optional `model` is
 * applied at creation so a recreated ingest session keeps the configured LLM.
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

function extractText(content: ReadonlyArray<{ type: string; text?: string }> | undefined): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("");
}