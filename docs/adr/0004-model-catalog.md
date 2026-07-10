# ADR 0004 — ModelCatalog: a deep module for model discovery + provider registration

Date: 2026-07-10

## Status

Accepted. Implemented in `src/main/model-catalog.ts`. Aligns with (does not
contradict) the model-fetch graceful-degradation behaviour documented as
ADR 0001 — that behaviour is preserved byte-for-byte, only relocated.

> ADR 0001 (model-fetch graceful degradation) and ADR 0002 (OKF wiki studio
> architecture) are referenced in source comments but not present in
> `docs/adr/`. This ADR, like ADR 0003, cites ADR 0001 by behaviour; the 0001
> gap should still be closed by reconstructing it from the code comments.

## Context

`src/main/agent.ts` was a ~1050-line god module — the `AgentRepository` class
fusing five concerns:

1. a **chat session pool** (concurrent `AgentSession`s keyed by session-file
   path, LRU eviction, streaming-text tracking),
2. **ingest orchestration** (fresh-session-per-ingest, snapshot diff,
   no-progress detection, hard timeout),
3. **GitHub Copilot OAuth** (device-code flow, abort, listener wiring),
4. **LLM provider config** (`configureLlm`: register provider / store key /
   resolve model / apply to sessions), and
5. **pure HTTP model-list fetching** for Ollama (local + cloud) and
   OpenAI-compatible endpoints.

Concerns 4 and 5 had **zero coupling** to `AgentSession` / `AgentSessionServices`
beyond `modelRegistry` + `authStorage`, yet they lived inside the chat-pool
module. The model-fetching helpers (`fetchModelList`, `fetchOllamaModels`,
`fetchOpenAiCompatibleModels`, `ensureV1Suffix`, `ollamaCloudId`, the
`MODEL_FETCH_TIMEOUT_MS` / `OLLAMA_CLOUD_CATALOG_URL` constants) were
module-level functions in `agent.ts` calling the global `fetch` directly —
impossible to test without a network.

This surfaced during the architecture review as candidate C2; the deletion test
passed — deleting the model-fetch code from the agent and concentrating it in a
catalog *concentrates* complexity rather than moving it, and gives model
discovery a real test surface.

## Decision

Introduce **ModelCatalog** — a deep module whose interface is the test surface
for model discovery + provider registration. Its constructor takes the two
dependencies it actually needs (`modelRegistry`, `authStorage`) plus an
**injectable `fetch`** (default: global `fetch`):

```ts
interface ModelCatalogDeps {
  readonly modelRegistry: Pick<AgentSessionServices["modelRegistry"], "getAvailable" | "getAll" | "registerProvider">;
  readonly authStorage: Pick<AgentSessionServices["authStorage"], "set" | "get">;
  readonly fetch?: typeof fetch;   // the seam — tests pass an in-memory adapter
}

class ModelCatalog {
  listAvailableModels(provider): Result<readonly ModelOption[]>;
  loadModels(provider, apiKey?, baseUrl?): Promise<Result<readonly ModelOption[]>>;
  registerProvider(config: LlmConfig): void;
  resolveModel(config: LlmConfig): ResolvedModel | null;
}
```

### What moved out of `agent.ts`

- Module-level helpers: `ensureV1Suffix`, `ollamaCloudId`, `fetchModelList`,
  `fetchOllamaModels`, `fetchOpenAiCompatibleModels`, the `OpenAiModelList`
  shape, and the `MODEL_FETCH_TIMEOUT_MS` / `OLLAMA_CLOUD_CATALOG_URL` constants.
- The `listAvailableModels` body (now a one-line delegation).
- The `loadModels` body (now a one-line delegation).
- The provider-registration + model-resolution halves of `configureLlm`
  (`registerProvider` + `resolveModel`).

### What stayed in the agent (agent state, not catalog state)

- `configureLlm` keeps the **policy** of applying the resolved model to its
  session pool: `this.ingestModel = model; await this.ingestSession.setModel(model);`
  best-effort apply across `liveSessions` (swallowing per-session errors). The
  catalog resolves *which* model; the agent decides *what to do with it*.
- The "no `refresh()`" comment — `refresh()` reloads models from disk and would
  drop the dynamically registered providers; the catalog's `registerProvider`
  is still called before `resolveModel`, so the comment stays accurate.
- **GitHub Copilot OAuth** (`loginCopilot`, `cancelCopilotLogin`,
  `logoutCopilot`, the `copilotAbort` field, the listener wiring). This is an
  auth flow entangled with abort + listeners, not model discovery. It now calls
  `this.catalog.listAvailableModels("github-copilot")` instead of the old
  `this.listAvailableModels(...)`.
- `hasLlmConfig()` (trivial: `modelRegistry.getAvailable().length > 0`).
- `createIngestSession` / `createLiveChatSession` keep applying
  `this.ingestModel`; the `ResolvedModel` alias stays in `agent.ts`.

### `AgentRepository` public signatures are unchanged

`listAvailableModels`, `loadModels`, and `configureLlm` keep their **exact**
public signatures, so `src/main/ipc.ts` and `src/main/index.ts` need **no
changes** — this is a pure internal extraction. Only `agent.ts` changed and
`model-catalog.ts` was added.

## Design choices resolved during the review

- **The injectable `fetch` is the seam.** The catalog's only I/O is HTTP; making
  `fetch` a constructor dep turns it into an in-memory adapter in tests. This is
  the testability win — the Ollama local+cloud independent-swallowing path and
  the openai-compatible path are now exercised with a fake `fetch` and no
  network. Two adapters (real `fetch` in production, fake in tests) make this a
  real seam, not a thin wrapper.
- **`Pick`-narrowed deps, not the full `ModelRegistry` class.** The catalog
  depends on the structural *slice* of `AgentSessionServices["modelRegistry"]`
  it uses (`getAvailable` / `getAll` / `registerProvider`) and of
  `authStorage` (`set` / `get`). This is more decoupled than the full class, and
  it is what makes minimal, typed fakes possible: a plain object is assignable
  to an interface but **not** to a class with private members (`ModelRegistry`
  has ~25 private fields + private members). The real
  `services.modelRegistry` / `services.authStorage` still satisfy the `Pick`
  interfaces structurally. `ResolvedModel` is re-derived locally
  (`ReturnType<…["getAll"]>[number]`) rather than imported from `agent.ts`, so
  the catalog does not depend on the agent module at all.
- **Copilot OAuth stays in the agent.** It is an auth flow (device-code +
  abort + listener streaming), not model discovery. Forcing it into the catalog
  would drag `copilotAbort`, the login listener, and the cancel surface into a
  module whose job is "which models can I pick?" — a worse fit. The agent calls
  `catalog.listAvailableModels("github-copilot")` for the post-login probe.
  Accepted as a future **C2.5** extraction if the OAuth flow grows.
- **`registerProvider` returns `void` (may throw); `loadModels` returns
  `Result`.** `registerProvider` is the side-effecting half of the old
  `configureLlm`; the agent's `configureLlm` still wraps the whole flow in
  try/catch and returns `Result<void>`, so a throwing `registerProvider`
  surfaces as an `err` exactly as before. `loadModels` keeps its own try/catch
  and returns `Result` (never throws to the caller) per the repo-wide rule.
- **Public signatures kept stable.** `listAvailableModels` / `loadModels` /
  `configureLlm` keep identical signatures so the IPC bridge and
  `index.ts` activation path are untouched — the extraction is invisible to
  callers.

## Consequences

**Positive**

- The agent loses ~120 lines of unrelated HTTP + provider-registration code
  (agent.ts: ~1050 → ~911 lines); model-discovery bugs now have **locality** —
  they live in one module.
- Model discovery is **testable in isolation**: `test/model-catalog.test.ts`
  covers the Ollama local+cloud path (independent swallowing, cloud suffix
  rule, both-empty error), the openai-compatible path (v1 suffix, Bearer key,
  fetch-failure error, missing-baseUrl error), the Copilot "use loginCopilot"
  guard, the auth-gated static catalog for anthropic/openai/google (key stored
  on `authStorage`), `resolveModel` (provider+id, id-fallback, null),
  `listAvailableModels` (provider filter), and `registerProvider` (ollama /
  openai-compatible / anthropic / copilot no-op). The `electron` mock in
  `test/setup.ts` is reused (the catalog's real dependency is `mainT` for the
  error keys + the injectable `fetch` + the fake deps; Electron is an internal
  i18n detail).
- Two adapters (real `fetch`, fake `fetch`) make the seam real, not nominal.
- The catalog has **no dependency on `agent.ts`** (the `ResolvedModel` type is
  re-derived, not imported), so it can be reused or tested without the agent.

**Negative / accepted**

- Copilot OAuth stays entangled in the agent (`loginCopilot` /
  `cancelCopilotLogin` / `logoutCopilot` + `copilotAbort` + the listener). This
  is a deliberate scope cut — OAuth is auth, not model discovery. Tracked as a
  future **C2.5** if the flow grows.
- The `ResolvedModel` alias is duplicated (one in `agent.ts`, one re-derived in
  `model-catalog.ts`). Both derive the same way from the same source type, so
  they are identical; the duplication is the price of keeping the catalog
  decoupled from the agent module.
- The agent still depends on the full `AgentSessionServices` (it needs the
  session pool, ingest, OAuth, etc.); only the model-discovery slice was
  extracted. Further extractions (ingest orchestration, session pool) are
  separate candidates.