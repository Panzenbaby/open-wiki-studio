// Tests for agent-events binding — the renderer-side adapter from the
// AgentEvent stream to jotai atoms. Uses a real jotai store (createStore())
// and a fake api capturing the three listeners. Tests the actual routing —
// the locality the deepening is after. See ADR 0006.
import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { bindAgentEvents, updateLastAssistant, type AgentEventApi } from "../src/renderer/agent-events.ts";
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
} from "../src/renderer/store.ts";
import { t } from "../src/shared/i18n.ts";
import type { AgentEvent, IngestSummary, SessionInfo } from "../src/shared/ipc-types.ts";

// ─── Minimal typed fake ───────────────────────────────────────────────────

/** The binder only uses the three listener methods. The fake captures each
 *  listener and returns an unsub that clears it. */
function makeApi() {
  let agent: ((e: AgentEvent) => void) | null = null;
  let ingest: ((e: AgentEvent) => void) | null = null;
  let summary: ((s: IngestSummary) => void) | null = null;
  const api: AgentEventApi = {
    onAgentEvent: (l) => {
      agent = l;
      return () => {
        agent = null;
      };
    },
    onIngestEvent: (l) => {
      ingest = l;
      return () => {
        ingest = null;
      };
    },
    onIngestSummary: (l) => {
      summary = l;
      return () => {
        summary = null;
      };
    },
  };
  return {
    api,
    emitAgent: (e: AgentEvent) => agent?.(e),
    emitIngest: (e: AgentEvent) => ingest?.(e),
    emitSummary: (s: IngestSummary) => summary?.(s),
    hasAgent: () => agent !== null,
    hasIngest: () => ingest !== null,
    hasSummary: () => summary !== null,
  };
}

function session(path: string, streaming = false): SessionInfo {
  return { path, name: path, lastModified: "", streaming };
}

const EMPTY_SUMMARY: IngestSummary = {
  leftover: [],
  createdConcepts: [],
  updatedConcepts: [],
  wikiConceptCountBefore: 0,
  wikiConceptCountAfter: 0,
};

// ─── tests ───────────────────────────────────────────────────────────────

describe("bindAgentEvents — chat router", () => {
  it("agent_start on current session: streaming=true, error=null", () => {
    const store = createStore();
    store.set(currentSessionAtom, session("p1"));
    const f = makeApi();
    const dispose = bindAgentEvents(f.api, store, "en");

    f.emitAgent({ type: "agent_start", sessionId: "s1", sessionPath: "p1" });

    expect(store.get(chatStreamingAtom)).toBe(true);
    expect(store.get(chatErrorAtom)).toBeNull();
    expect(store.get(streamingSessionsAtom)).toEqual(new Set(["p1"]));

    dispose();
  });

  it("agent_start on background session: only streamingSessions updated", () => {
    const store = createStore();
    store.set(currentSessionAtom, session("p1"));
    const f = makeApi();
    bindAgentEvents(f.api, store, "en");

    f.emitAgent({ type: "agent_start", sessionId: "s2", sessionPath: "p2" });

    expect(store.get(chatStreamingAtom)).toBe(false);
    expect(store.get(chatErrorAtom)).toBeNull();
    expect(store.get(streamingSessionsAtom)).toEqual(new Set(["p2"]));
  });

  it("text_delta on current session extends the last assistant (new bubble)", () => {
    const store = createStore();
    store.set(currentSessionAtom, session("p1"));
    store.set(messagesAtom, [{ role: "user", text: "hi" }]);
    const f = makeApi();
    bindAgentEvents(f.api, store, "en");

    f.emitAgent({ type: "agent_start", sessionId: "s1", sessionPath: "p1" });
    f.emitAgent({ type: "text_delta", sessionId: "s1", sessionPath: "p1", delta: "Hello" });
    f.emitAgent({ type: "text_delta", sessionId: "s1", sessionPath: "p1", delta: " world" });

    expect(store.get(messagesAtom)).toEqual([
      { role: "user", text: "hi" },
      { role: "assistant", text: "Hello world" },
    ]);
    expect(store.get(chatErrorAtom)).toBeNull();
  });

  it("text_delta on non-current session does not mutate messages", () => {
    const store = createStore();
    store.set(currentSessionAtom, session("p1"));
    store.set(messagesAtom, [{ role: "user", text: "hi" }]);
    const f = makeApi();
    bindAgentEvents(f.api, store, "en");

    f.emitAgent({ type: "text_delta", sessionId: "s2", sessionPath: "p2", delta: "x" });

    expect(store.get(messagesAtom)).toEqual([{ role: "user", text: "hi" }]);
  });

  it("agent_end success with assistant present + current: no error", () => {
    const store = createStore();
    store.set(currentSessionAtom, session("p1"));
    store.set(messagesAtom, [{ role: "assistant", text: "answer" }]);
    store.set(streamingSessionsAtom, new Set(["p1"]));
    store.set(chatStreamingAtom, true);
    const f = makeApi();
    bindAgentEvents(f.api, store, "en");

    const before = store.get(chatTurnEndedAtom);
    f.emitAgent({ type: "agent_end", sessionId: "s1", sessionPath: "p1", aborted: false });

    expect(store.get(chatStreamingAtom)).toBe(false);
    expect(store.get(chatErrorAtom)).toBeNull();
    expect(store.get(streamingSessionsAtom).has("p1")).toBe(false);
    expect(store.get(chatTurnEndedAtom)).toBe(before + 1);
  });

  it("agent_end no-response (current, no last assistant, not aborted) → localized error", () => {
    const store = createStore();
    store.set(currentSessionAtom, session("p1"));
    store.set(messagesAtom, []);
    const f = makeApi();
    bindAgentEvents(f.api, store, "en");

    f.emitAgent({ type: "agent_end", sessionId: "s1", sessionPath: "p1", aborted: false });

    expect(store.get(chatStreamingAtom)).toBe(false);
    expect(store.get(chatErrorAtom)).toBe(t("en", "chat.errorNoResponse"));
  });

  it("agent_end no-response with empty (whitespace-only) assistant → localized error", () => {
    const store = createStore();
    store.set(currentSessionAtom, session("p1"));
    store.set(messagesAtom, [{ role: "assistant", text: "   " }]);
    const f = makeApi();
    bindAgentEvents(f.api, store, "en");

    f.emitAgent({ type: "agent_end", sessionId: "s1", sessionPath: "p1", aborted: false });

    expect(store.get(chatErrorAtom)).toBe(t("en", "chat.errorNoResponse"));
  });

  it("agent_end aborted (current) → streaming false, NO error set", () => {
    const store = createStore();
    store.set(currentSessionAtom, session("p1"));
    store.set(messagesAtom, []);
    const f = makeApi();
    bindAgentEvents(f.api, store, "en");

    f.emitAgent({ type: "agent_end", sessionId: "s1", sessionPath: "p1", aborted: true });

    expect(store.get(chatStreamingAtom)).toBe(false);
    expect(store.get(chatErrorAtom)).toBeNull();
  });

  it("agent_end with lastError (current) → chatError = lastError", () => {
    const store = createStore();
    store.set(currentSessionAtom, session("p1"));
    const f = makeApi();
    bindAgentEvents(f.api, store, "en");

    f.emitAgent({ type: "agent_end", sessionId: "s1", sessionPath: "p1", aborted: false, lastError: "boom" });

    expect(store.get(chatStreamingAtom)).toBe(false);
    expect(store.get(chatErrorAtom)).toBe("boom");
  });

  it("agent_end on background path → removed from streamingSessions, turn bumped, no chat mutation", () => {
    const store = createStore();
    store.set(currentSessionAtom, session("p1"));
    store.set(streamingSessionsAtom, new Set(["p2"]));
    store.set(chatStreamingAtom, true);
    const f = makeApi();
    bindAgentEvents(f.api, store, "en");

    const before = store.get(chatTurnEndedAtom);
    f.emitAgent({ type: "agent_end", sessionId: "s2", sessionPath: "p2", aborted: false });

    expect(store.get(streamingSessionsAtom).has("p2")).toBe(false);
    expect(store.get(chatTurnEndedAtom)).toBe(before + 1);
    expect(store.get(chatStreamingAtom)).toBe(true); // unchanged — not current
  });

  it("error on current session → streaming false, chatError = message", () => {
    const store = createStore();
    store.set(currentSessionAtom, session("p1"));
    store.set(chatStreamingAtom, true);
    const f = makeApi();
    bindAgentEvents(f.api, store, "en");

    f.emitAgent({ type: "error", sessionPath: "p1", message: "oops" });

    expect(store.get(chatStreamingAtom)).toBe(false);
    expect(store.get(chatErrorAtom)).toBe("oops");
  });

  it("error on background path → removed from streamingSessions only", () => {
    const store = createStore();
    store.set(currentSessionAtom, session("p1"));
    store.set(streamingSessionsAtom, new Set(["p2"]));
    const f = makeApi();
    bindAgentEvents(f.api, store, "en");

    f.emitAgent({ type: "error", sessionPath: "p2", message: "oops" });

    expect(store.get(streamingSessionsAtom).has("p2")).toBe(false);
    expect(store.get(chatStreamingAtom)).toBe(false);
    expect(store.get(chatErrorAtom)).toBeNull();
  });
});

describe("bindAgentEvents — ingest router", () => {
  it("ingest agent_start → running + empty stream + cleared error", () => {
    const store = createStore();
    store.set(ingestErrorAtom, "prev");
    store.set(ingestStreamAtom, "stale");
    const f = makeApi();
    bindAgentEvents(f.api, store, "en");

    f.emitIngest({ type: "agent_start", sessionId: "", sessionPath: "" });

    expect(store.get(ingestStateAtom)).toBe("running");
    expect(store.get(ingestStreamAtom)).toBe("");
    expect(store.get(ingestErrorAtom)).toBeNull();
  });

  it("ingest text_delta → stream concatenated", () => {
    const store = createStore();
    const f = makeApi();
    bindAgentEvents(f.api, store, "en");

    f.emitIngest({ type: "text_delta", sessionId: "", sessionPath: "", delta: "foo" });
    f.emitIngest({ type: "text_delta", sessionId: "", sessionPath: "", delta: "bar" });

    expect(store.get(ingestStreamAtom)).toBe("foobar");
  });

  it("ingest agent_end with lastError → idle + error", () => {
    const store = createStore();
    store.set(ingestStateAtom, "running");
    const f = makeApi();
    bindAgentEvents(f.api, store, "en");

    f.emitIngest({ type: "agent_end", sessionId: "", sessionPath: "", aborted: false, lastError: "failed" });

    expect(store.get(ingestStateAtom)).toBe("idle");
    expect(store.get(ingestErrorAtom)).toBe("failed");
  });

  it("ingest agent_end success → done", () => {
    const store = createStore();
    store.set(ingestStateAtom, "running");
    const f = makeApi();
    bindAgentEvents(f.api, store, "en");

    f.emitIngest({ type: "agent_end", sessionId: "", sessionPath: "", aborted: false });

    expect(store.get(ingestStateAtom)).toBe("done");
  });

  it("ingest error → idle + error", () => {
    const store = createStore();
    const f = makeApi();
    bindAgentEvents(f.api, store, "en");

    f.emitIngest({ type: "error", sessionPath: "", message: "broken" });

    expect(store.get(ingestStateAtom)).toBe("idle");
    expect(store.get(ingestErrorAtom)).toBe("broken");
  });

  it("onIngestSummary → summary set + state done", () => {
    const store = createStore();
    const f = makeApi();
    bindAgentEvents(f.api, store, "en");

    const summary: IngestSummary = {
      ...EMPTY_SUMMARY,
      createdConcepts: ["a", "b"],
      wikiConceptCountBefore: 1,
      wikiConceptCountAfter: 3,
    };
    f.emitSummary(summary);

    expect(store.get(ingestSummaryAtom)).toEqual(summary);
    expect(store.get(ingestStateAtom)).toBe("done");
  });
});

describe("bindAgentEvents — disposer + locale", () => {
  it("disposer unsubscribes all three channels", () => {
    const store = createStore();
    store.set(currentSessionAtom, session("p1"));
    const f = makeApi();
    const dispose = bindAgentEvents(f.api, store, "en");

    expect(f.hasAgent()).toBe(true);
    expect(f.hasIngest()).toBe(true);
    expect(f.hasSummary()).toBe(true);

    dispose();

    expect(f.hasAgent()).toBe(false);
    expect(f.hasIngest()).toBe(false);
    expect(f.hasSummary()).toBe(false);

    // After dispose, emits no longer mutate the store.
    store.set(chatStreamingAtom, false);
    f.emitAgent({ type: "agent_start", sessionId: "s1", sessionPath: "p1" });
    expect(store.get(chatStreamingAtom)).toBe(false);
    expect(store.get(streamingSessionsAtom)).toEqual(new Set());

    store.set(ingestStateAtom, "idle");
    f.emitIngest({ type: "agent_start", sessionId: "", sessionPath: "" });
    expect(store.get(ingestStateAtom)).toBe("idle");

    store.set(ingestSummaryAtom, null);
    f.emitSummary(EMPTY_SUMMARY);
    expect(store.get(ingestSummaryAtom)).toBeNull();
  });

  it("locale: 'de' yields the German no-response string", () => {
    const store = createStore();
    store.set(currentSessionAtom, session("p1"));
    store.set(messagesAtom, []);
    const f = makeApi();
    bindAgentEvents(f.api, store, "de");

    f.emitAgent({ type: "agent_end", sessionId: "s1", sessionPath: "p1", aborted: false });

    expect(store.get(chatErrorAtom)).toBe(t("de", "chat.errorNoResponse"));
    expect(store.get(chatErrorAtom)).not.toBe(t("en", "chat.errorNoResponse"));
  });
});

describe("updateLastAssistant", () => {
  it("creates a new assistant bubble when last is a user message", () => {
    const result = updateLastAssistant(
      [{ role: "user", text: "hi" }],
      "Hello",
    );
    expect(result).toEqual([
      { role: "user", text: "hi" },
      { role: "assistant", text: "Hello" },
    ]);
  });

  it("extends the last assistant bubble when last is assistant", () => {
    const result = updateLastAssistant(
      [{ role: "assistant", text: "Hello" }],
      " world",
    );
    expect(result).toEqual([{ role: "assistant", text: "Hello world" }]);
  });

  it("creates a new assistant bubble when the list is empty", () => {
    expect(updateLastAssistant([], "Hi")).toEqual([
      { role: "assistant", text: "Hi" },
    ]);
  });
});