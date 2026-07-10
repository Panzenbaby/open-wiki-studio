# ADR 0006 — Agent-events binding: a deep module for the AgentEvent → jotai store adapter

Date: 2026-07-10

## Status

Accepted. Implemented in `src/renderer/agent-events.ts`. Aligns with the
deepening series: ADR 0003 (ConceptStore, C1), ADR 0004 (ModelCatalog, C2),
ADR 0005 (ChatSessionPool, C3). Like them, this is a pure internal extraction —
only `src/renderer/App.tsx` changed and `src/renderer/agent-events.ts` was
added.

> This is the renderer-side counterpart to the main-process deepenings (C1–C3).
> It does NOT touch the main process, preload, or shared types.

## Context

`src/renderer/App.tsx` hosted ~110 lines of event routing inline in two
`useEffect`s interleaved with bootstrap (`listRecentWorkspaces`,
`getAppSelf`, `setScreen`) and the `document.title` effect:

- `api.onAgentEvent` (chat router): route by `sessionPath`, update
  `messagesAtom` / `chatStreamingAtom` / `chatErrorAtom` /
  `chatTurnEndedAtom` / `streamingSessionsAtom`, with a background-vs-current
  split.
- `api.onIngestEvent` + `api.onIngestSummary` (ingest router): update
  `ingestStateAtom` / `ingestStreamAtom` / `ingestSummaryAtom` /
  `ingestErrorAtom`.

This is the renderer-side adapter from the `AgentEvent` stream to jotai atoms.
It is exactly the kind of logic that needs **locality**: the comments record a
**stuck-composer / no-response bug** fixed by careful flag ordering — an aborted
turn (Stop button) must NOT surface a "no response" error, while a turn that
ended with no assistant text (and was not aborted) must. That ordering
(`lastError` → `aborted` → empty-last-assistant check) is the fragile part,
and it was smeared across inline arrow functions next to unrelated bootstrap
code.

The router also relied on a `tRef = useRef(t); tRef.current = t;` workaround
because `useT()` returns a **new** function every render, so the effect's
dependency array could not include `t` without re-binding on every render.
This is a code smell that signals the logic is in the wrong place.

This surfaced during the architecture review as candidate C4. The deletion test
passed — concentrating the routing in a deep module *concentrates* complexity
rather than moving it, and gives the stuck-composer / no-response ordering a
real test surface.

## Decision

Introduce **`bindAgentEvents(api, store, locale)`** — a plain module function
(not a React hook) that owns both event routers and returns a disposer.
`App.tsx` calls it once and stops caring about event shapes:

```ts
export type AgentEventApi = Pick<
  AgentApi,
  "onAgentEvent" | "onIngestEvent" | "onIngestSummary"
>;

export function updateLastAssistant(
  messages: readonly ChatMessage[],
  delta: string,
): ChatMessage[];

export function bindAgentEvents(
  api: AgentEventApi,
  store: Store,
  locale: Locale,
): () => void;
```

`App.tsx` keeps only: the bootstrap `useEffect`, the `document.title`
`useEffect`, the render branches, and the one new
`useEffect(() => bindAgentEvents(api, store, locale), [store, locale])`.

### Design choices

- **A plain module function, not a hook — so it is testable without React.**
  The routing logic is pure store mutation; wrapping it in a hook would force
  every test to mount a React tree. A free function takes a real jotai `Store`
  (`createStore()`) and a fake `api`, and is exercised directly.
- **Pass the stable `locale` string, not the `t` function.** `useT()` returns a
  new function every render, so passing `t` would force a re-bind on every
  render (or re-introduce the `tRef` workaround). Passing the stable `locale`
  string lets the module call the pure `t(locale, key, …)` from
  `src/shared/i18n.ts`. The effect re-binds only when `locale` changes (rare —
  the user switches language) or the jotai `store` identity changes (it does
  not across renders — `useStore()` returns a stable default store). This
  **removes the `tRef` hack entirely.**
- **Minimal `AgentEventApi` param type** (`Pick<AgentApi, …>`) so tests pass a
  fake that implements only the three listeners, not the full `AgentApi`. The
  fake is structurally assignable — no `any`, no `as unknown as` needed.
- **`updateLastAssistant` moves in.** It was a module-level helper in
  `App.tsx`; it now lives next to its only caller and is exported for direct
  unit tests. `App.tsx` no longer imports `ChatMessage`.
- **`Store` and `createStore` resolve from `jotai`** (`import type { Store }
  from "jotai"`, `import { createStore } from "jotai"`). Verified against the
  installed jotai package's exports.
- **Routing bodies moved verbatim** from App.tsx. Each `setX((prev) => …)`
  (from `useSetAtom`) becomes `store.set(atom, (prev) => …)`; each
  `store.get(atom)` stays. `store.set` on a primitive atom accepts a function
  updater the same way `useSetAtom`'s setter does (that is what the original
  code already relied on). Every comment and the exact branching / flag
  ordering is preserved (especially the `lastError` → `aborted` →
  empty-last-assistant sequence).

### What stayed in `App.tsx`

The bootstrap `useEffect` (`listRecentWorkspaces` / `getAppSelf` /
`setScreen("picker")`), the `document.title` `useEffect`, and the render
branches are unchanged. `App.tsx` keeps only the atoms it still uses directly
(`screenAtom`, `recentWorkspacesAtom`, `platformAtom`) and the `useStore()`
result it passes to the binder. Its public component signature
`App(): JSX.Element` is unchanged.

## Consequences

**Positive**

- The stuck-composer / no-response ordering — "aborted → no error",
  "no/empty last assistant and not aborted → localized error",
  "lastError → real error" — now has **locality** (one module) and a **test
  surface**. `test/agent-events.test.ts` covers every branch: agent_start
  current/background, text_delta current/non-current, agent_end success /
  no-response / aborted / lastError / background, error current/background,
  ingest agent_start/text_delta/agent_end-success/agent_end-error/error,
  onIngestSummary, the disposer, and the `de`-locale no-response string.
- The `tRef` workaround is gone — the binder depends only on the stable
  `locale` string and the stable jotai `Store`, so it re-binds only on a
  language change.
- `App.tsx` thins from ~200 lines to ~75: it owns bootstrap, title, render,
  and one `useEffect` call. It no longer imports seven `useSetAtom` setters,
  the chat/ingest atoms, `ChatMessage`, `useRef`, or `useSetAtom` for those
  atoms.
- Two adapters (real `api` + `useStore()` in production, fake `api` +
  `createStore()` in tests) make the seam real, not nominal — the routing is
  exercised against a real jotai store, not a mock of the atom API.
- The module has **no React dependency** (`Store` + `t(locale, …)` + the atoms),
  so it can be tested or reused without mounting a component tree.

**Negative / accepted**

- The binder re-binds on a locale change (rare — the user switches language
  once, at most). The cost is three unsub + re-subscribe calls; negligible
  compared to the per-render re-bind the `tRef` workaround was papering over.
- The binder holds a jotai `Store` reference, which is stable across renders
  (`useStore()` returns the default store). If a future `Provider`-based
  per-window store were introduced, the `[store, locale]` dependency array
  already tracks `store` identity, so the effect would re-bind correctly.
- `updateLastAssistant` is duplicated only in the sense that it was already
  module-level in `App.tsx`; it now lives in the binder module, which is its
  only caller. `App.tsx` no longer references it.