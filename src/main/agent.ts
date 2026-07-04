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

  private constructor(
    private readonly workspace: string,
    private readonly services: AgentSessionServices,
    private readonly runtime: AgentSessionRuntime,
    private readonly ingestSession: AgentSession,
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

      // Give the ingest session its OWN, isolated ExtensionRuntime so it is
      // unaffected by the chat session's lifecycle. Both sessions share the
      // same `services` (and thus the same cached `extensionsResult.runtime`),
      // so without this reload the ingest session would reuse the chat
      // session's runtime. When the chat session is later switched out
      // (openSession/newSession on the dashboard), `dispose()` invalidates
      // that shared runtime, and `pi.sendUserMessage` inside /wiki-update would
      // throw "stale ctx" — silently breaking the ingest (the renderer ignored
      // the error, leaving the IngestView stuck on "Ready…").
      //
      // Reloading here builds a fresh `extensionsResult` with a new runtime;
      // the chat session keeps its already-captured runtime reference, and
      // the ingest session captures the fresh one — fully isolated.
      await services.resourceLoader.reload();
      const ingestSession = (
        await pi.createAgentSessionFromServices({
          services,
          sessionManager: pi.SessionManager.inMemory(),
        })
      ).session;

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

  private forward(session: AgentSession, listener: () => void, emit: (e: AgentEvent) => void): () => void {
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
      listener();
    });
  }

  private async bindChat(): Promise<void> {
    this.chatUnsub?.();
    const session = this.runtime.session;
    await session.bindExtensions({});
    this.chatUnsub = this.forward(session, () => {}, (e) => this.chatListener?.(e));
  }

  private async bindIngest(): Promise<void> {
    this.ingestUnsub?.();
    await this.ingestSession.bindExtensions({});
    this.ingestUnsub = this.forward(this.ingestSession, () => {}, (e) => this.ingestListener?.(e));
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
          api: "openai-completions" as never,
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
    try {
      await this.runtime.session.prompt(`/wiki-query ${question}`);
      return ok(undefined);
    } catch (error) {
      return err<void>(`Ask failed: ${errorMessage(error)}`);
    }
  }

  async ingest(): Promise<Result<void>> {
    try {
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
      let sawStart = false;
      let endResolver: (() => void) | null = null;
      const turnEnded = new Promise<void>((resolve) => {
        endResolver = resolve;
      });
      const off = this.ingestSession.subscribe((event) => {
        if (event.type === "agent_start") {
          sawStart = true;
        } else if (event.type === "agent_end" && sawStart && endResolver) {
          endResolver();
          endResolver = null;
        }
      });
      try {
        await this.ingestSession.prompt("/wiki-update");
        if (!sawStart) {
          // sendUserMessage is async; agent_start may fire a few ticks after
          // the command handler returns. Give it a brief grace window.
          await new Promise<void>((resolve) => setTimeout(resolve, 2000));
        }
        if (sawStart) await turnEnded;
      } finally {
        off();
      }

      const after = await snapshotWiki(this.workspace);
      const diff = diffSnapshots(before, after);
      const leftover = await listInputFiles(this.workspace);
      const summary: IngestSummary = {
        conformantImported: [],
        nonConformantHandedToAgent: [],
        ignored: [],
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

function extractText(content: ReadonlyArray<{ type: string; text?: string }> | undefined): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("");
}