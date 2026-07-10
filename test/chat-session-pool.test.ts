// Tests for ChatSessionPool — the deepened module that owns chat session
// creation + LRU residency + streaming-text tracking. The testability seam is
// the **protected `createLiveChatSession`**: tests subclass ChatSessionPool
// and override it to return a fake LiveChatSession (a plain object whose
// `session` satisfies the structural `ChatSession` slice). That lets these
// exercise the residency invariants (LRU eviction, never-current, never-
// streaming, touch reordering, reuse, applyModelToAll, drop, disposeAll)
// without faking pi, createAgentSessionFromServices, or the resource loader.
//
// `pi` / `services` deps are cast through `unknown` (NOT `any`) because the
// override bypasses them entirely — `services` cannot be narrowed to a `Pick`
// slice (it is passed straight into the real-typed `createAgentSessionFrom`
// Services`), so the test seam is the override, not dep narrowing. See ADR 0005.
import { describe, expect, it } from "vitest";
import {
  ChatSessionPool,
  type AgentMessageLike,
  type ChatSessionManager,
  type ChatSessionPoolDeps,
  type LiveChatSession,
} from "../src/main/chat-session-pool.ts";

// ─── Minimal typed fakes ──────────────────────────────────────────────────

/** A fake agent session: structurally satisfies `ChatSession` (the narrowed
 *  slice the pool stores). Method declarations (not arrow properties) so a
 *  looser `setModel(model: unknown)` is assignable via bivariance. */
interface FakeSession {
  isStreaming: boolean;
  readonly messages: ReadonlyArray<AgentMessageLike>;
  setModel(model: unknown): Promise<void>;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;
}

/** Mutable per-session state the tests inspect / flip (streaming, reject,
 *  disposed, …). Kept separate from the `FakeSession` so the `ChatSession`
 *  slice stays clean. */
interface FakeLiveState {
  setModelRejects: boolean;
  aborted: boolean;
  disposed: boolean;
  unsubscribed: boolean;
}

interface FakeLive {
  readonly live: LiveChatSession;
  readonly session: FakeSession;
  readonly setModelCalls: unknown[];
  readonly state: FakeLiveState;
}

/** Build a fake LiveChatSession at `path` with controllable state. The fake
 *  `session` records setModel/abort/dispose and the `chatUnsub` records
 *  unsubscribe. */
function makeFakeLive(path: string): FakeLive {
  const setModelCalls: unknown[] = [];
  const state: FakeLiveState = {
    setModelRejects: false,
    aborted: false,
    disposed: false,
    unsubscribed: false,
  };
  const session: FakeSession = {
    isStreaming: false,
    messages: [],
    setModel: async (model: unknown) => {
      setModelCalls.push(model);
      if (state.setModelRejects) throw new Error(`setModel rejected for ${path}`);
    },
    prompt: async (_text: string) => {
      /* no-op */
    },
    abort: async () => {
      state.aborted = true;
    },
    dispose: () => {
      state.disposed = true;
    },
  };
  const sessionManager: ChatSessionManager = { getSessionFile: () => path };
  const live: LiveChatSession = {
    session,
    sessionManager,
    chatUnsub: () => {
      state.unsubscribed = true;
    },
    path,
    streamingAssistantText: "",
  };
  return { live, session, setModelCalls, state };
}

// ─── Test pool subclass (the override seam) ───────────────────────────────

type CreateReason = "new" | "resume";
interface CreateCall {
  readonly reason: CreateReason;
  readonly previousSessionFile?: string;
  readonly path?: string;
}

class TestPool extends ChatSessionPool {
  readonly createCalls: CreateCall[] = [];
  /** Every fake ever created, keyed by its path (survives drop/dispose so
   *  tests can still inspect disposed state). */
  private readonly fakesByPath = new Map<string, FakeLive>();
  private counter = 0;

  constructor(maxLiveSessions: number) {
    super({
      // Unused — the override never touches pi/services (creation is faked).
      pi: null as unknown as ChatSessionPoolDeps["pi"],
      services: null as unknown as ChatSessionPoolDeps["services"],
      workspace: "/test-workspace",
      forwardEvents: () => () => {},
      onChatEvent: () => {},
      getIngestModel: () => null,
      maxLiveSessions,
    });
  }

  protected override async createLiveChatSession(
    reason: CreateReason,
    previousSessionFile?: string,
    path?: string,
  ): Promise<LiveChatSession> {
    this.createCalls.push({ reason, previousSessionFile, path });
    // "new" generates a fresh unique path; "resume" uses the requested path
    // (the pool passes it so the live's path matches the file being opened).
    const resolvedPath = reason === "new" ? `/s/${++this.counter}` : path!;
    const rec = makeFakeLive(resolvedPath);
    this.fakesByPath.set(resolvedPath, rec);
    return rec.live;
  }

  /** Look up the fake record for a path (even after it was dropped/disposed). */
  fake(path: string): FakeLive | undefined {
    return this.fakesByPath.get(path);
  }
}

// The model type accepted by applyModelToAll (the pool's local `ResolvedModel`
// alias, re-derived from the public method signature so the test does not
// import the unexported alias).
type PoolModel = Parameters<ChatSessionPool["applyModelToAll"]>[0];
const TEST_MODEL: PoolModel = { id: "test-model" } as unknown as PoolModel;

// ─── tests ───────────────────────────────────────────────────────────────

describe("ChatSessionPool — LRU eviction", () => {
  it("evicts the least-recently-used idle session beyond the cap", async () => {
    const pool = new TestPool(3);
    const paths: string[] = [];
    for (let i = 0; i < 5; i++) {
      paths.push((await pool.newSession()).path);
    }
    // cap=3, 5 created → the two oldest idle non-current sessions are evicted.
    expect(pool.has(paths[0])).toBe(false);
    expect(pool.has(paths[1])).toBe(false);
    expect(pool.has(paths[2])).toBe(true);
    expect(pool.has(paths[3])).toBe(true);
    expect(pool.has(paths[4])).toBe(true);
    expect(pool.getCurrentPath()).toBe(paths[4]);
  });

  it("never evicts the current session — eviction stops rather than evicting it", async () => {
    const pool = new TestPool(2);
    const s1 = (await pool.newSession()).path;
    pool.fake(s1)!.session.isStreaming = true;
    const s2 = (await pool.newSession()).path;
    pool.fake(s2)!.session.isStreaming = true;
    // s3 is created (current) and is the only IDLE session; s1/s2 are streaming.
    const s3 = (await pool.newSession()).path;
    expect(pool.fake(s3)!.session.isStreaming).toBe(false);
    // Pool is now over the cap (3 > 2). The only idle session is s3, which is
    // current → eviction skips it and stops (cannot evict streaming ones).
    expect(pool.has(s1)).toBe(true);
    expect(pool.has(s2)).toBe(true);
    expect(pool.has(s3)).toBe(true);
    expect(pool.getCurrentPath()).toBe(s3);
  });

  it("never evicts a streaming session (an idle one is evicted instead)", async () => {
    const pool = new TestPool(2);
    const s1 = (await pool.newSession()).path;
    pool.fake(s1)!.session.isStreaming = true; // oldest, but streaming
    const s2 = (await pool.newSession()).path;
    const s3 = (await pool.newSession()).path; // triggers eviction
    // Eviction walks [s1, s2, s3]: skip s3 (current), skip s1 (streaming),
    // evict s2 (idle, non-current).
    expect(pool.has(s1)).toBe(true);
    expect(pool.has(s2)).toBe(false);
    expect(pool.has(s3)).toBe(true);
    expect(pool.getCurrentPath()).toBe(s3);
  });

  it("touches a pooled session to most-recently-used on openSession (reuse)", async () => {
    const pool = new TestPool(3);
    const s1 = (await pool.newSession()).path;
    const _s2 = (await pool.newSession()).path;
    const s3 = (await pool.newSession()).path; // current=s3, order [s1, s2, s3]
    // Reopen s1 → reuse: current=s1, touch moves it to the back (MRU).
    await pool.openSession(s1);
    expect(pool.getCurrentPath()).toBe(s1);
    // Now create one more to trigger eviction. Without the touch, s1 (oldest)
    // would be evicted; with the touch, s2 is now the oldest → evicted instead.
    const s4 = (await pool.newSession()).path;
    expect(pool.has(s1)).toBe(true);
    expect(pool.has(_s2)).toBe(false);
    expect(pool.getCurrentPath()).toBe(s4);
  });
});

describe("ChatSessionPool — openSession reuse", () => {
  it("reuses the pooled live session without calling the creation seam", async () => {
    const pool = new TestPool(3);
    const first = await pool.newSession();
    const path = first.path;
    const createCountBefore = pool.createCalls.length;

    const reopened = await pool.openSession(path);

    expect(pool.createCalls.length).toBe(createCountBefore); // no new creation
    expect(reopened.session).toBe(first.session); // same session identity
    expect(pool.getCurrentPath()).toBe(path);
  });

  it("creates a new live for a non-pooled path (resume)", async () => {
    const pool = new TestPool(3);
    const createCountBefore = pool.createCalls.length;
    const live = await pool.openSession("/external/session.md");
    expect(live.path).toBe("/external/session.md");
    expect(pool.createCalls.length).toBe(createCountBefore + 1);
    expect(pool.createCalls[pool.createCalls.length - 1]).toEqual({
      reason: "resume",
      previousSessionFile: undefined,
      path: "/external/session.md",
    });
    expect(pool.getCurrentPath()).toBe("/external/session.md");
  });

  it("forwards previousSessionFile (the session being left) to the seam", async () => {
    const pool = new TestPool(3);
    const s1 = (await pool.newSession()).path; // current
    // The agent passes previousSessionFile = currentPath; here we pass it
    // explicitly (the pool forwards it, it does not derive it).
    await pool.openSession("/other.md", s1);
    const last = pool.createCalls[pool.createCalls.length - 1];
    expect(last.previousSessionFile).toBe(s1);
    expect(last.reason).toBe("resume");
    expect(last.path).toBe("/other.md");
  });
});

describe("ChatSessionPool — applyModelToAll", () => {
  it("calls setModel on every pooled session", async () => {
    const pool = new TestPool(4);
    const s1 = (await pool.newSession()).path;
    const s2 = (await pool.newSession()).path;
    await pool.applyModelToAll(TEST_MODEL);
    expect(pool.fake(s1)!.setModelCalls).toEqual([TEST_MODEL]);
    expect(pool.fake(s2)!.setModelCalls).toEqual([TEST_MODEL]);
  });

  it("swallows a per-session setModel rejection (loop continues)", async () => {
    const pool = new TestPool(4);
    const s1 = (await pool.newSession()).path;
    const s2 = (await pool.newSession()).path;
    pool.fake(s2)!.state.setModelRejects = true; // s2 rejects
    await pool.applyModelToAll(TEST_MODEL);
    // s1 still gets the model even though s2 rejected.
    expect(pool.fake(s1)!.setModelCalls).toEqual([TEST_MODEL]);
    expect(pool.fake(s2)!.setModelCalls).toEqual([TEST_MODEL]); // s2 was called (then threw)
  });
});

describe("ChatSessionPool — drop", () => {
  it("disposes the fake and removes it from the pool; returns true", async () => {
    const pool = new TestPool(3);
    const s1 = (await pool.newSession()).path;
    expect(pool.drop(s1)).toBe(true);
    expect(pool.fake(s1)!.state.disposed).toBe(true);
    expect(pool.fake(s1)!.state.unsubscribed).toBe(true);
    expect(pool.has(s1)).toBe(false);
  });

  it("returns false for an unknown path (no-op)", async () => {
    const pool = new TestPool(3);
    expect(pool.drop("/nonexistent")).toBe(false);
  });
});

describe("ChatSessionPool — disposeAll", () => {
  it("disposes every pooled session and empties the pool", async () => {
    const pool = new TestPool(4);
    const s1 = (await pool.newSession()).path;
    const s2 = (await pool.newSession()).path;
    pool.disposeAll();
    expect(pool.fake(s1)!.state.disposed).toBe(true);
    expect(pool.fake(s2)!.state.disposed).toBe(true);
    expect(pool.has(s1)).toBe(false);
    expect(pool.has(s2)).toBe(false);
    expect(pool.getCurrentPath()).toBeNull();
  });
});

describe("ChatSessionPool — current path management", () => {
  it("tracks current path via getCurrentPath / setCurrentPath / getCurrent", async () => {
    const pool = new TestPool(3);
    expect(pool.getCurrentPath()).toBeNull();
    expect(pool.getCurrent()).toBeUndefined();

    const s1 = (await pool.newSession()).path;
    expect(pool.getCurrentPath()).toBe(s1);
    expect(pool.getCurrent()?.path).toBe(s1);

    const s2 = (await pool.newSession()).path;
    expect(pool.getCurrentPath()).toBe(s2);

    // Manually switch current back to s1.
    pool.setCurrentPath(s1);
    expect(pool.getCurrentPath()).toBe(s1);
    expect(pool.getCurrent()?.path).toBe(s1);

    pool.setCurrentPath(null);
    expect(pool.getCurrentPath()).toBeNull();
    expect(pool.getCurrent()).toBeUndefined();
  });
});

describe("ChatSessionPool — accessors", () => {
  it("isStreaming reflects the session's streaming flag", async () => {
    const pool = new TestPool(3);
    const s1 = (await pool.newSession()).path;
    expect(pool.isStreaming(s1)).toBe(false);
    pool.fake(s1)!.session.isStreaming = true;
    expect(pool.isStreaming(s1)).toBe(true);
    expect(pool.isStreaming("/unknown")).toBe(false);
  });

  it("get / has read the pool", async () => {
    const pool = new TestPool(3);
    const s1 = (await pool.newSession()).path;
    expect(pool.has(s1)).toBe(true);
    expect(pool.get(s1)?.path).toBe(s1);
    expect(pool.has("/unknown")).toBe(false);
    expect(pool.get("/unknown")).toBeUndefined();
  });
});