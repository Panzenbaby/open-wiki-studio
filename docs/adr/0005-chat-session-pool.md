# ADR 0005 — ChatSessionPool: a deep module for chat session creation + LRU residency

Date: 2026-07-10

## Status

Accepted. Implemented in `src/main/chat-session-pool.ts`. Aligns with (does not
contradict) the session-pool behaviour documented in the original `agent.ts`
header comment — that behaviour is preserved byte-for-byte, only relocated
behind a deep interface.

> Builds on the deepening series: ADR 0003 (ConceptStore, C1) and ADR 0004
> (ModelCatalog, C2). Like them, this is a pure internal extraction — only
> `src/main/agent.ts` changed and `src/main/chat-session-pool.ts` was added.

## Context

`src/main/agent.ts` remained a god module even after C2 extracted model
discovery. The `AgentRepository` class still fused five concerns, of which the
**chat session pool** had the worst locality:

- a pool of up to 8 concurrent `AgentSession`s keyed by session-file path,
  so multiple sessions stream answers in parallel,
- LRU eviction of the least-recently-used **idle** session (never the current,
  never a streaming one) beyond a cap,
- in-progress assistant text tracking (the partial answer that lives nowhere
  else while a turn streams),
- session creation (`resourceLoader.reload`, `createAgentSessionFromServices`,
  `bindExtensions`, ingest-model apply, event + streaming-text subscribe),
- current-path tracking + touch/drop.

These invariants — "never evict the current", "never evict a streaming one",
"walk the LRU map and drop the first eligible, repeat, stop if a pass evicts
nothing" — were smeared across private methods (`createLiveChatSession`,
`dropLiveChatSession`, `touchLiveChatSession`, `evictIdleSessions`) and three
fields (`liveSessions`, `currentPath`, `MAX_LIVE_SESSIONS`) interleaved with
ingest orchestration, Copilot OAuth, and LLM config. The residency policy had
**no test surface** and **no locality**: an eviction bug could hide anywhere in
the class.

This surfaced during the architecture review as candidate C3. The deletion test
passed — concentrating the pool's invariants in a deep module *concentrates*
complexity rather than moving it, and gives the LRU policy a real test surface.

### The "wider seam" caveat

Unlike C2 (ModelCatalog), whose only I/O was HTTP and whose deps narrowed
cleanly to `Pick` slices, the chat pool's creation path needs the full
`AgentSessionServices` (passed straight into `createAgentSessionFromServices`,
whose real-typed options require it) plus the `pi` module (`SessionManager.
create/open`, `createAgentSessionFromServices`). `services` **cannot** be
narrowed to a `Pick` slice without breaking production assignability (a
function accepting a *narrower* `services` is not assignable to the real
function that accepts the *full* one — contravariance). So the pool's seam is
wider than the catalog's: it needs `pi` + `services` + a model provider + a chat
event sink. This was the central design tension, resolved by grilling.

## Decision

Introduce **ChatSessionPool** — a deep module that owns chat session creation
+ residency (LRU eviction) + streaming-text tracking. Its constructor takes the
deps it needs and a **protected `createLiveChatSession`** that is the test seam:

```ts
interface ChatSessionPoolDeps {
  readonly pi: PiModule;
  readonly services: AgentSessionServices;
  readonly workspace: string;
  readonly forwardEvents: (session, path, emit) => () => void;  // injected
  readonly onChatEvent: (event: AgentEvent) => void;
  readonly getIngestModel: () => ResolvedModel | null;
  readonly maxLiveSessions?: number;  // default 8
}

class ChatSessionPool {
  getCurrentPath(): string | null;
  setCurrentPath(path: string | null): void;
  getCurrent(): LiveChatSession | undefined;
  get(path): LiveChatSession | undefined;
  has(path): boolean;
  isStreaming(path): boolean;
  newSession(previousSessionFile?): Promise<LiveChatSession>;
  openSession(path, previousSessionFile?): Promise<LiveChatSession>;
  drop(path): boolean;
  applyModelToAll(model): Promise<void>;
  disposeAll(): void;
  protected createLiveChatSession(reason, previousSessionFile?, path?): Promise<LiveChatSession>;
}
```

### What moved out of `agent.ts`

- The `LiveChatSession` shape, the `liveSessions` map, `currentPath`, and
  `MAX_LIVE_SESSIONS` — now owned by the pool (`cap` defaulting to 8).
- `createLiveChatSession` (resourceLoader.reload, pi session creation with a
  `session_start` event, `bindExtensions`, best-effort ingest-model apply with
  the existing `console.log` on failure, `forwardEvents` subscribe + the second
  streaming-text subscribe using `extractText`).
- `dropLiveChatSession` / `touchLiveChatSession` / `evictIdleSessions` — the
  LRU residency policy, preserved byte-for-byte (skip current, skip streaming,
  drop the first eligible, repeat, stop if a pass evicts nothing).
- `extractText` (the pure 6-line partial-text helper) — moved into the pool
  file and exported, so the agent's `extractMessages` imports it from there
  (avoids a pool→agent import cycle: the agent imports the pool, not the
  reverse). `AgentMessageLike` (the message shape) moved with it for the same
  reason and is shared by the agent's `getMessages` / `extractMessages`.

### `forward()` → `forwardAgentEvents` (shared, injected, not imported)

The pi→`AgentEvent` translator was a private `forward` method. It is shared with
the ingest path (`bindIngest` uses it too). It becomes a **module-level free
function `forwardAgentEvents(session, path, emit)` in `agent.ts`** — same body,
same helpers (`lastAssistantErrorMessage`, `lastAssistantAborted`,
`dedupeProviderErrorMessage`, `mainT`). `bindIngest` calls it directly; the pool
**receives it as the `forwardEvents` dep** rather than importing it. This keeps
the pool decoupled from the agent module (no cycle, no duplication).

### What stayed in the agent (agent state / policy, not pool state)

- **Ingest session lifecycle**: `createIngestSession`, `resetIngestSession`,
  `bindIngest`, and the `ingest()` orchestration (fresh-session-per-ingest,
  snapshot diff, no-progress detection, start/end promise race, hard timeout).
- **GitHub Copilot OAuth**: `loginCopilot` / `cancelCopilotLogin` /
  `logoutCopilot` + `copilotAbort` + the login listener wiring.
- The four listeners + their setters (`chatListener`, `ingestListener`,
  `summaryListener`, `copilotLoginListener`).
- `hasLlmConfig()` and the catalog delegation (`listAvailableModels` /
  `loadModels`).
- `configureLlm` keeps the **policy** of applying the resolved model: register
  via the catalog, resolve, then `this.ingestModel = model;
  await this.ingestSession.setModel(model); await this.pool.applyModelToAll(model);`
  — the pool owns the *best-effort apply across the pool*; the agent owns the
  *decision to apply*.
- `getMessages` stays in the agent: the non-pooled fallback
  (`pi.SessionManager.open(path).buildSessionContext().messages`) + message
  extraction (`extractMessages`) are caller-facing, not pool state. It reads
  `live.session.messages` + `live.streamingAssistantText` from the pool.
- `extractMessages` + the `lastAssistant*` / `dedupeProviderErrorMessage`
  helpers (used by `forwardAgentEvents`).

### `AgentRepository` public signatures are unchanged

`listSessions`, `newSession`, `openSession`, `deleteSession`, `getMessages`,
`ask`, `retryChat`, `abortChat`, `abort`, `configureLlm`, `dispose` keep their
**exact** public signatures, so `src/main/ipc.ts` and `src/main/index.ts` need
**no changes** — this is a pure internal extraction. The repo thins to
delegations (`this.pool.newSession(...)`, `this.pool.getCurrent()`,
`this.pool.isStreaming(s.path)`, `this.pool.drop(path)`,
`this.pool.applyModelToAll(model)`, `this.pool.disposeAll()`).

## Design choices resolved during the grilling

- **Deep pool (B) over narrow lifecycle-only pool (A).** A narrow pool that
  owned only `liveSessions` + LRU + current-path (delegating creation to the
  agent) was rejected: creation is where the deep invariants live (reload order,
  session_start event shape, setModel best-effort, the two subscribe wirings).
  Splitting creation from residency would give the pool a wide interface but a
  shallow implementation, and the agent would keep the creation logic that
  touches pool state — the worst of both. The deep pool owns creation +
  lifecycle; the agent injects `forwardEvents` + `getIngestModel` + `onChatEvent`
  so the pool never imports the agent. Accepted cost: the seam is wide (pi +
  services + model + listener), accepted because creation is the real
  deepening.
- **`createLiveChatSession` is `protected` and overridable — the test seam.**
  Tests subclass `ChatSessionPool` and override `createLiveChatSession` to
  return a fake `LiveChatSession` (a plain object whose `session` satisfies the
  structural `ChatSession` slice). The LRU / streaming / touch / drop /
  `applyModelToAll` invariants are then exercised **without faking pi,
  `createAgentSessionFromServices`, or the resource loader**. The unused `pi` /
  `services` deps are cast through `unknown` (NOT `any`) in tests because the
  override bypasses them entirely — `services` cannot be narrowed to a `Pick`
  slice (it is passed into the real-typed `createAgentSessionFromServices`),
  so the seam is the override, not dep narrowing. This differs from C2, where
  deps narrowed cleanly; here they genuinely cannot.
- **`ChatSession` / `ChatSessionManager` are structural slices, not the full
  classes.** `LiveChatSession.session` is typed as a structural `ChatSession`
  interface (`isStreaming`, `messages`, `setModel`, `prompt`, `abort`,
  `dispose`) and `sessionManager` as `ChatSessionManager` (`getSessionFile`),
  not the full `AgentSession` / `SessionManager` classes. The real objects
  satisfy these structurally; narrowing is what makes minimal typed fakes
  possible (a plain object is assignable to an interface but not to a class
  with private members — the same rationale as ADR 0004's `Pick` slices).
  Members are declared as methods so a fake with looser parameter types
  (e.g. `setModel(model: unknown)`) is assignable via bivariance. Creation-time
  methods (`bindExtensions`, `subscribe`, `sessionId`) are used on the full
  `AgentSession` returned by pi *before* it is narrowed into the stored
  `LiveChatSession`.
- **`forwardAgentEvents` is a free function, injected as a dep.** Making it a
  method on the agent and having the pool import it would create a pool→agent
  cycle; duplicating it would lose the sharing with the ingest path. A
  module-level free function in `agent.ts`, passed to the pool as `forwardEvents`
  and called directly by `bindIngest`, keeps one copy and no cycle.
- **`extractText` + `AgentMessageLike` move to the pool file** (and are
  exported), not the other way. The pool's streaming-text subscribe is their
  primary user; the agent's `extractMessages` / `getMessages` import them from
  the pool. This avoids a pool→agent import (which would cycle, since the agent
  imports the pool). `ResolvedModel` is re-derived locally in the pool
  (`ReturnType<AgentSessionServices["modelRegistry"]["getAll"]>[number]`),
  matching ADR 0004's decoupling — the pool does not import the agent's alias.
- **Public signatures kept stable.** Every session method keeps its identical
  signature so the IPC bridge and `index.ts` activation path are untouched —
  the extraction is invisible to callers.
- **`evictIdle` stops if a full pass evicts nothing.** Preserved exactly: when
  every session is current or streaming, the loop breaks rather than spinning
  forever. The "never evict current" guard is effectively redundant in
  production (current is always touched to MRU before eviction), but it is a
  safety invariant the tests now pin.

## Consequences

**Positive**

- The LRU residency invariants — "never evict the current", "never evict a
  streaming one", "evict the first idle non-current in LRU order, repeat, stop
  if nothing evicted", "touch reorders to MRU" — now have **locality** (one
  module) and a **test surface**. `test/chat-session-pool.test.ts` covers LRU
  eviction, current-protection (eviction stops rather than evicting the only
  idle session when it is current), streaming-protection, touch reordering,
  reuse-on-open (no creation, same session identity), `applyModelToAll`
  (per-session rejection swallowed), `drop`, `disposeAll`, and current-path
  management — 15 tests exercising the invariants that previously had no
  locality.
- The agent thins: the session methods become delegations, and the pool's
  creation + residency code (~120 lines) leaves the class. The agent keeps the
  ingest orchestration, Copilot OAuth, listeners, and the caller-facing
  `getMessages` / `extractMessages`.
- Two adapters (real pi + services in production, fake `createLiveChatSession`
  in tests) make the seam real, not nominal — the override is exercised, not
  bypassed, by the residency tests.
- The pool has **no dependency on `agent.ts`** (`ResolvedModel` re-derived,
  `forwardAgentEvents` injected, `extractText` owned), so it can be tested or
  reused without the agent.

**Negative / accepted**

- The seam is wider than C2's: the pool needs `pi` + `services` + a model
  provider + a chat event sink. Accepted because creation is the real
  deepening — a narrower pool would have left the creation invariants in the
  agent. The unused `pi` / `services` are cast via `unknown` (not `any`) in
  tests, isolated to the `TestPool` helper, because the override bypasses them.
- `ResolvedModel` is now derived in three places (`agent.ts`,
  `model-catalog.ts`, `chat-session-pool.ts`). All derive the same way from the
  same source type, so they are identical; the duplication is the price of
  keeping each deep module decoupled from the others (same trade-off as ADR
  0004).
- Copilot OAuth + ingest orchestration remain in the agent. These are separate
  concerns (an auth flow; a snapshot-diff orchestration) and did not meet the
  deletion test as cleanly as the pool — forcing them out would drag listeners
  and ingest-specific helpers into modules whose jobs are different. Tracked as
  future candidates (C3.5 / C4) if either grows.
- `getMessages` stays in the agent (the non-pooled fallback + message
  extraction are caller-facing). The pool exposes `get` / `isStreaming` /
  `getCurrent` so the agent can read live state without owning the map.