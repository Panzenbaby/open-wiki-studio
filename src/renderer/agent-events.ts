// Agent/ingest event → jotai store binding. The single place that turns an
// AgentEvent stream into atom updates. Extracted verbatim from App.tsx so the
// routing logic (and the stuck-composer / no-response ordering) has locality
// and a real test surface — see ADR 0006.
import type { Store } from "jotai/vanilla/store";
import { t, type Locale } from "../shared/i18n.ts";
import type { AgentApi, ChatMessage } from "../shared/ipc-types.ts";
import {
  chatErrorAtom,
  chatStreamingAtom,
  chatTurnEndedAtom,
  currentSessionAtom,
  ingestErrorAtom,
  ingestStateAtom,
  ingestStreamAtom,
  ingestSummaryAtom,
  messagesAtom,
  streamingSessionsAtom,
} from "./store.ts";

/** Minimal API surface the binder needs. Narrowing the param type lets tests
 *  pass a fake without implementing the full AgentApi. */
export type AgentEventApi = Pick<
  AgentApi,
  "onAgentEvent" | "onIngestEvent" | "onIngestSummary"
>;

/** Append a streaming assistant delta to the message list (extend the last
 *  assistant bubble, or start a new one). Moved verbatim from App.tsx. */
export function updateLastAssistant(
  messages: readonly ChatMessage[],
  delta: string,
): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") {
    return [...messages, { role: "assistant", text: delta }];
  }
  return [...messages.slice(0, -1), { role: "assistant", text: last.text + delta }];
}

/**
 * Subscribe to the agent/ingest event streams and route them into the jotai
 * store. Returns a disposer that unsubscribes all three channels. The single
 * place that turns an AgentEvent into atom updates — the stuck-composer /
 * no-response ordering lives here.
 */
export function bindAgentEvents(
  api: AgentEventApi,
  store: Store,
  locale: Locale,
): () => void {
  // Route chat events by sessionPath: only the current session updates
  // messagesAtom/chatStreamingAtom; background sessions update streamingSessionsAtom.
  const offAgent = api.onAgentEvent((event) => {
    const currentPath = store.get(currentSessionAtom)?.path;
    if (event.type === "agent_start") {
      const isCurrent = event.sessionPath === currentPath;
      store.set(streamingSessionsAtom, (prev: ReadonlySet<string>) =>
        prev.has(event.sessionPath) ? prev : new Set(prev).add(event.sessionPath),
      );
      if (isCurrent) {
        store.set(chatErrorAtom, null);
        store.set(chatStreamingAtom, true);
      }
    } else if (event.type === "text_delta") {
      if (event.sessionPath === currentPath) {
        store.set(chatErrorAtom, null);
        store.set(messagesAtom, (prev: readonly ChatMessage[]) => updateLastAssistant(prev, event.delta));
      }
    } else if (event.type === "agent_end") {
      const isCurrent = event.sessionPath === currentPath;
      store.set(streamingSessionsAtom, (prev: ReadonlySet<string>) => {
        if (!prev.has(event.sessionPath)) return prev;
        const next = new Set(prev);
        next.delete(event.sessionPath);
        return next;
      });
      // Keep the session list fresh so sidebar names + streaming dots stay current.
      store.set(chatTurnEndedAtom, (n: number) => n + 1);
      if (isCurrent) {
        store.set(chatStreamingAtom, false);
        if (event.lastError) {
          // The turn failed (stopReason "error") — show the real error
          // instead of the generic "no response" banner.
          store.set(chatErrorAtom, event.lastError);
        } else if (!event.aborted) {
          // A deliberately aborted turn (Stop button) must not surface a
          // "no response" error — the user chose to stop.
          const messages = store.get(messagesAtom);
          const last = messages[messages.length - 1];
          if (!last || last.role !== "assistant" || last.text.trim() === "") {
            store.set(chatErrorAtom, t(locale, "chat.errorNoResponse"));
          }
        }
      }
    } else if (event.type === "error") {
      const isCurrent = event.sessionPath === currentPath;
      store.set(streamingSessionsAtom, (prev: ReadonlySet<string>) => {
        if (!prev.has(event.sessionPath)) return prev;
        const next = new Set(prev);
        next.delete(event.sessionPath);
        return next;
      });
      if (isCurrent) {
        store.set(chatStreamingAtom, false);
        store.set(chatErrorAtom, event.message);
      }
    }
  });

  // Ingest event stream + summary.
  const offIngest = api.onIngestEvent((event) => {
    if (event.type === "agent_start") {
      store.set(ingestErrorAtom, null);
      store.set(ingestStateAtom, "running");
      store.set(ingestStreamAtom, "");
    } else if (event.type === "text_delta") {
      store.set(ingestStreamAtom, (prev: string) => prev + event.delta);
    } else if (event.type === "agent_end") {
      if (event.lastError) {
        // Turn failed (stopReason "error") — surface the real error and
        // reset to idle instead of showing a misleading "done".
        store.set(ingestStateAtom, "idle");
        store.set(ingestErrorAtom, event.lastError);
      } else {
        store.set(ingestStateAtom, "done");
      }
    } else if (event.type === "error") {
      store.set(ingestStateAtom, "idle");
      store.set(ingestErrorAtom, event.message);
    }
  });

  const offSummary = api.onIngestSummary((summary) => {
    store.set(ingestSummaryAtom, summary);
    // The summary is sent only after the ingest fully completes (including
    // any agent turn). It is the reliable completion signal for
    // conformant-only runs, which trigger NO agent_start/agent_end events.
    store.set(ingestStateAtom, "done");
  });

  return () => {
    offAgent();
    offIngest();
    offSummary();
  };
}