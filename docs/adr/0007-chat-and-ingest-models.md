# ADR 0007 — Chat and ingest models: one connection, a model per role

Date: 2026-10-01

## Status

Accepted. Implemented in `src/shared/ipc-types.ts` (`LlmConfig.ingestModelId`),
`src/main/config.ts`, `src/main/model-catalog.ts` (`resolveModels`,
`registerProvider`), `src/main/agent.ts`, `src/main/chat-session-pool.ts`
(`getChatModel`), and `src/renderer/components/IngestModelField.tsx`.

Amends ADR 0004 (`resolveModel(config)` became `resolveModels(config)`, and
`configureLlm` applies a model per role) and ADR 0005 (the pool dep
`getIngestModel` became `getChatModel`).

## Context

The app had exactly one LLM configuration: one provider, one set of
credentials, one model. `configureLlm` resolved that model and applied it to
the ingest session and to every chat session.

Ingest and chat have different needs. The ingest reads source documents and
writes the wiki — long, structure-heavy work where a stronger (slower, more
expensive) model pays off. Chat answers questions against the finished wiki,
where a faster, cheaper model is often good enough. Users want to pick a
stronger model for the ingest without paying for it on every chat turn.

## Decision

**One connection, a model per role.** Chat and ingest share the provider, the
API key, and the base URL. Only the model can differ.

- `LlmConfig.modelId` stays the **chat model** and is the base: the ingest uses
  it too unless `LlmConfig.ingestModelId` is set. The field name `modelId` is
  kept because it is an existing on-disk contract (`config.json`).
- `ingestModelId` absent means **"use the same model as chat"**. This is a
  following setting: when the chat model changes later, the ingest changes
  with it.
- `ingestModelId` present is an **explicit choice**. It stays when the chat
  model changes, until the user picks another one or switches back to "use the
  same model as chat".
- The configuration stays **app-wide**, like before — not per workspace.

### Migration

None needed. Configs saved before this decision have no `ingestModelId`, so
they keep using one model for chat and ingest. `config.ts` copies the key-free
connection fields through one helper (`toLlmConnection`), so key migration and
key removal cannot drop `ingestModelId`. A malformed stored value counts as
"not set".

### UI

- **First run** asks for one model only; it is used for chat and ingest. A hint
  points to Settings for a separate ingest model.
- **Settings** shows the chat model picker and below it an "Ingest model" group
  with a "Use the same model as chat" checkbox (checked by default). Clearing it
  shows a second picker over the same provider model list. Saving requires a
  chosen ingest model while the box is cleared. A chosen ingest model that the
  loaded model list does not offer counts as not chosen, so the user picks
  again instead of being switched to another model silently.
- Switching the provider resets the ingest model to "use the same model as
  chat", since model IDs belong to a provider.

### Runtime

- `ModelCatalog.resolveModels(config)` resolves both roles and fails as a
  whole, naming the missing model, if either is absent. `configureLlm` applies
  nothing in that case, so the previously configured models stay active.
- `ModelCatalog.registerProvider` registers the chat and the ingest model for
  Ollama / OpenAI-compatible in **one** call: the registry replaces all models
  of a provider on each registration, so a second call would drop the first
  model.
- `AgentRepository` keeps `chatModel` and `ingestModel`. The chat model goes to
  every pooled chat session (best-effort, as before) and, through the pool dep
  `getChatModel`, to every newly created one. The ingest model is applied to
  the current ingest session and to the fresh session each ingest starts in —
  so a new ingest model is used from the next ingest on at the latest.

## Consequences

- One more optional field on the config contract and the IPC payload
  (`isLlmConfig` accepts a non-empty `ingestModelId`).
- The ingest can run on a stronger model than chat without touching chat cost
  or latency.
- Image ingest needs a vision-capable model; with a separate ingest model this
  is a property of the ingest model, not of the chat model.

## Alternatives considered

- **Fully independent roles** (own provider, credentials, base URL per role).
  Rejected for now: it doubles credential handling and the settings UI for a
  need ("a stronger model for ingest") that one provider covers. The shape
  leaves room to add it later.
- **Per-workspace models.** Rejected: the LLM configuration is app-wide by
  design; per-workspace settings would be a separate feature.
- **Both models required at first run.** Rejected: it makes the first contact
  heavier for a choice most users do not need on day one.
- **Rename `modelId` to `chatModelId`.** Rejected: it would break the existing
  `config.json` contract and need a migration for no behavioural gain.
