// Tests for `awaitIngestTurn` — the ingest turn wait. The timeout is an IDLE
// timeout: it measures silence between session events, not total turn
// duration, so a long-but-active ingest is not killed mid-run.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { awaitIngestTurn, DEFAULT_INGEST_TURN_TIMING } from "../src/main/agent.ts";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

type SessionEvent = Parameters<Parameters<AgentSession["subscribe"]>[0]>[0];

/** A fake AgentSession: records the subscriber so the test can drive events,
 *  and resolves `prompt` immediately (the real one is fire-and-forget too). */
function fakeSession(): {
  session: AgentSession;
  emit: (event: SessionEvent) => void;
  subscribed: () => boolean;
} {
  let listener: ((event: SessionEvent) => void) | null = null;
  const session = {
    subscribe: (fn: (event: SessionEvent) => void) => {
      listener = fn;
      return () => {
        listener = null;
      };
    },
    prompt: async () => {},
  } as unknown as AgentSession;
  return {
    session,
    emit: (event) => listener?.(event),
    subscribed: () => listener !== null,
  };
}

const agentStart = { type: "agent_start" } as unknown as SessionEvent;
const agentEnd = { type: "agent_end", messages: [] } as unknown as SessionEvent;
const textDelta = {
  type: "message_update",
  assistantMessageEvent: { type: "text_delta", delta: "…" },
} as unknown as SessionEvent;

describe("awaitIngestTurn", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves false when no turn starts within the grace window", async () => {
    const { session } = fakeSession();
    const pending = awaitIngestTurn(session, { graceMs: 3000, idleMs: 1000 });
    await vi.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toBe(false);
  });

  it("survives far past the old 5-minute cap while events keep arriving", async () => {
    const { session, emit } = fakeSession();
    const idleMs = DEFAULT_INGEST_TURN_TIMING.idleMs;
    const pending = awaitIngestTurn(session, DEFAULT_INGEST_TURN_TIMING);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    emit(agentStart);
    await vi.advanceTimersByTimeAsync(DEFAULT_INGEST_TURN_TIMING.graceMs);

    // Twelve rounds of "an event, then almost idle" — an hour of wall clock,
    // twelve times the old hard cap.
    for (let round = 0; round < 12; round++) {
      emit(textDelta);
      await vi.advanceTimersByTimeAsync(idleMs - 1);
    }
    expect(settled).toBe(false);

    emit(agentEnd);
    await expect(pending).resolves.toBe(true);
  });

  it("rejects once a started turn goes silent for the idle window", async () => {
    const { session, emit } = fakeSession();
    const pending = awaitIngestTurn(session, { graceMs: 3000, idleMs: 60_000 });
    const assertion = expect(pending).rejects.toThrow();

    await vi.advanceTimersByTimeAsync(0);
    emit(agentStart);
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });

  it("unsubscribes from the session when the turn ends", async () => {
    const { session, emit, subscribed } = fakeSession();
    const pending = awaitIngestTurn(session, { graceMs: 3000, idleMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);
    emit(agentStart);
    await vi.advanceTimersByTimeAsync(3000);
    emit(agentEnd);
    await pending;
    expect(subscribed()).toBe(false);
  });

  it("rejects with the assistant error when the turn fails", async () => {
    const { session, emit } = fakeSession();
    const pending = awaitIngestTurn(session, { graceMs: 3000, idleMs: 60_000 });
    const assertion = expect(pending).rejects.toThrow("provider unreachable");

    await vi.advanceTimersByTimeAsync(0);
    emit(agentStart);
    await vi.advanceTimersByTimeAsync(3000);
    emit({
      type: "auto_retry_end",
      success: false,
      finalError: "provider unreachable",
    } as unknown as SessionEvent);
    await assertion;
  });
});
