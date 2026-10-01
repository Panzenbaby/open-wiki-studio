// ModelCatalog: the deep module that owns model discovery + provider
// registration for the LLM config flow. Its interface is the test surface for
// "which models can I pick for this provider?" and "register this provider /
// store this API key".
//
// What lives here (the deep implementation):
//   - the pure HTTP model-list fetching for Ollama (local + cloud) and
//     OpenAI-compatible endpoints (the OpenAI /v1/models shape)
//   - the cloud-id suffix rule (ollamaCloudId) and the v1-suffix normalization
//   - the auth-gated static catalog projection for anthropic/openai/google
//   - provider registration into modelRegistry (ollama/openai-compatible) and
//     API-key storage into authStorage (anthropic/openai/google)
//   - model resolution from the registry for both roles — the chat model and
//     the ingest model, which follows the chat model unless chosen separately
//     (ADR 0007) — by provider+modelId, falling back to modelId alone
//
// What the agent keeps (its own policies, not model discovery):
//   - applying the resolved models to its sessions (ingest model -> ingest
//     session, chat model -> live chats) — that is agent state, not catalog
//     state
//   - Copilot OAuth (loginCopilot / cancel / logout) — an auth flow entangled
//     with abort + listeners, not model discovery
//
// The seam that makes this testable in isolation is the **injectable `fetch`**
// in `ModelCatalogDeps`: tests pass an in-memory fetch adapter and never touch
// the network. See ADR 0004.
//
// The graceful-degradation behaviour of `loadModels` is documented as ADR 0001
// (the file is missing from docs/adr/ but the behaviour is preserved exactly):
//   - Ollama: local ({base}/models) and cloud (https://ollama.com/v1/models)
//     fetch failures are swallowed INDEPENDENTLY; the dropdown gets whichever
//     succeeded; throw only if both return nothing.
//   - openai-compatible: throw only if the fetch itself fails.
//   - anthropic/openai/google: store the key so the built-in catalog surfaces,
//     then return the auth-gated static list.
//   - github-copilot: err (must use loginCopilot()).
import type { AgentSessionServices } from "@earendil-works/pi-coding-agent";
import { ok, err, errorMessage } from "../shared/result.ts";
import { mainT } from "./i18n.ts";
import type { LlmConfig, ModelOption, ProviderId, Result } from "../shared/ipc-types.ts";

/** A model resolved from the registry. Re-derive the type locally rather than
 *  importing the internal `ResolvedModel` alias from agent.ts, so the catalog
 *  stays decoupled from the agent module. It is the element type of
 *  `modelRegistry.getAll()` — i.e. `Model<Api>`. */
type ResolvedModel = ReturnType<ModelCatalogModelRegistry["getAll"]>[number];

/** The structural slice of `AgentSessionServices["modelRegistry"]` the catalog
 *  actually uses. Narrowing to `Pick` (instead of the full `ModelRegistry`
 *  class) is what makes minimal, typed fakes possible in tests: a plain object
 *  is assignable to an interface but not to a class with private members. The
 *  real `services.modelRegistry` still satisfies this structurally. */
interface ModelCatalogModelRegistry
  extends Pick<AgentSessionServices["modelRegistry"], "getAvailable" | "getAll" | "registerProvider"> {}

/** The structural slice of `AgentSessionServices["authStorage"]` the catalog
 *  actually uses (storing an API key for anthropic/openai/google). */
interface ModelCatalogAuthStorage
  extends Pick<AgentSessionServices["authStorage"], "set" | "get"> {}

export interface ModelCatalogDeps {
  readonly modelRegistry: ModelCatalogModelRegistry;
  readonly authStorage: ModelCatalogAuthStorage;
  /** Injectable so tests can fake HTTP without a network. Default: global fetch. */
  readonly fetch?: typeof fetch;
}

/** The registry models a config runs with, one per role. Both are the same
 *  model unless the config chooses a separate ingest model. */
export interface ResolvedLlmModels {
  readonly chat: ResolvedModel;
  readonly ingest: ResolvedModel;
}

/** The model ID the ingest runs with: the separately chosen ingest model, or
 *  else the chat model (ADR 0007). */
export function effectiveIngestModelId(config: Pick<LlmConfig, "modelId" | "ingestModelId">): string {
  return config.ingestModelId ?? config.modelId;
}

/** Every model ID a config uses, chat model first, without duplicates. */
function configuredModelIds(config: LlmConfig): readonly string[] {
  const ingestModelId = effectiveIngestModelId(config);
  return ingestModelId === config.modelId ? [config.modelId] : [config.modelId, ingestModelId];
}

/** Per-request timeout for model-list fetches. */
const MODEL_FETCH_TIMEOUT_MS = 6000;
/** Public Ollama Cloud model catalog (OpenAI-compat shape, no auth). */
const OLLAMA_CLOUD_CATALOG_URL = "https://ollama.com/v1/models";

/** Ensure a base URL ends with `/v1` so `{base}/models` resolves. */
function ensureV1Suffix(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

/** Runnable cloud model id per the suffix rule in ADR 0001. */
function ollamaCloudId(id: string): string {
  return id.includes(":") ? `${id}-cloud` : `${id}:cloud`;
}

/** OpenAI-compatible /v1/models response shape. */
interface OpenAiModelList {
  readonly data?: ReadonlyArray<{ readonly id?: string }>;
}

export class ModelCatalog {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly deps: ModelCatalogDeps) {
    this.fetchImpl = deps.fetch ?? fetch;
  }

  /** Models already available for a provider (auth configured). For Copilot a
   *  non-empty result doubles as the "already logged in" probe: the form shows
   *  the model dropdown instead of the login button. */
  listAvailableModels(provider: ProviderId): Result<readonly ModelOption[]> {
    try {
      const models = this.deps.modelRegistry
        .getAvailable()
        .filter((model) => model.provider === provider)
        .map((model) => ({ id: model.id, name: model.name }));
      return ok(models);
    } catch (error) {
      return err<readonly ModelOption[]>(
        mainT("error.listModels", { detail: errorMessage(error) }),
      );
    }
  }

  /** Load selectable models for a provider given credentials/base URL.
   *  Preserves the ADR 0001 graceful-degradation behaviour:
   *    - github-copilot -> err (use loginCopilot(), not loadModels())
   *    - ollama        -> fetch local {base}/models + cloud catalog,
   *                       swallow each failure independently, throw only if
   *                       both return nothing
   *    - openai-compat -> fetch {base}/v1/models, err only if the fetch fails
   *    - anthropic/openai/google -> store apiKey so the built-in catalog
   *                       surfaces, return the static auth-gated list */
  async loadModels(
    provider: ProviderId,
    apiKey?: string,
    baseUrl?: string,
  ): Promise<Result<readonly ModelOption[]>> {
    try {
      if (provider === "github-copilot") {
        return err<readonly ModelOption[]>("Copilot uses loginCopilot(), not loadModels()");
      }
      if (provider === "ollama") {
        const base = ensureV1Suffix(baseUrl ?? "http://localhost:11434/v1");
        return ok(await this.fetchOllamaModels(base));
      }
      if (provider === "openai-compatible") {
        if (!baseUrl) return err<readonly ModelOption[]>(mainT("error.baseUrlRequired"));
        return ok(await this.fetchOpenAiCompatibleModels(baseUrl, apiKey));
      }
      // anthropic / openai / google — static built-in catalog, auth-gated.
      if (apiKey) {
        this.deps.authStorage.set(provider, { type: "api_key", key: apiKey });
      }
      const models = this.deps.modelRegistry
        .getAvailable()
        .filter((model) => model.provider === provider)
        .map((model) => ({ id: model.id, name: model.name }));
      return ok(models);
    } catch (error) {
      return err<readonly ModelOption[]>(errorMessage(error));
    }
  }

  /** Register a provider into the registry (ollama/openai-compatible) and/or
   *  store an API key (anthropic/openai/google). No-op for copilot. This is the
   *  side-effecting half of the old `configureLlm`; the agent still applies the
   *  resolved models to its sessions afterwards. */
  registerProvider(config: LlmConfig): void {
    const providerName =
      config.provider === "openai-compatible" ? "openai-compatible" : config.provider;

    if (config.provider === "ollama" || config.provider === "openai-compatible") {
      const baseUrl =
        config.baseUrl ?? (config.provider === "ollama" ? "http://localhost:11434/v1" : "");
      this.deps.modelRegistry.registerProvider(providerName, {
        name: config.provider === "ollama" ? "Ollama" : "OpenAI-compatible",
        baseUrl,
        // registerProvider requires an apiKey; for providers that don't need
        // one, pass a placeholder.
        apiKey: config.apiKey || (config.provider === "ollama" ? "ollama" : "not-needed"),
        // "openai-completions" is the OpenAI chat completions wire protocol,
        // spoken by Ollama and OpenAI-compatible endpoints.
        api: "openai-completions",
        // Registering a provider with models REPLACES all of its models, so
        // the chat and the ingest model must be registered in one call — a
        // second call would drop the first model again.
        models: configuredModelIds(config).map((modelId) => ({
          id: modelId,
          name: modelId,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 8192,
        })),
      });
    } else if (config.apiKey) {
      this.deps.authStorage.set(config.provider, { type: "api_key", key: config.apiKey });
    }
    // github-copilot: no-op — auth flows through loginCopilot().
  }

  /** Find the chat and the ingest model of a config in the registry (each by
   *  provider+modelId, falling back to modelId alone). Fails as a whole when
   *  either is missing, so the agent never applies only half of a config; the
   *  error names the missing model. */
  resolveModels(config: LlmConfig): Result<ResolvedLlmModels> {
    const chat = this.findModel(config.provider, config.modelId);
    if (!chat) return this.modelNotFound(config.provider, config.modelId);
    const ingestModelId = effectiveIngestModelId(config);
    const ingest = ingestModelId === config.modelId ? chat : this.findModel(config.provider, ingestModelId);
    if (!ingest) return this.modelNotFound(config.provider, ingestModelId);
    return ok({ chat, ingest });
  }

  private findModel(provider: ProviderId, modelId: string): ResolvedModel | null {
    const all = this.deps.modelRegistry.getAll();
    const model =
      all.find((m) => m.provider === provider && m.id === modelId) ??
      all.find((m) => m.id === modelId);
    return model ?? null;
  }

  private modelNotFound(provider: ProviderId, modelId: string): Result<ResolvedLlmModels> {
    return err<ResolvedLlmModels>(mainT("error.modelNotFound", { provider, modelId }));
  }

  // ─── HTTP model-list fetch helpers (Ollama / openai-compatible) ──────────
  // See ADR 0001. All endpoints speak the OpenAI-compat /v1/models shape:
  // { data: [{ id: string, ... }] }. Cloud models get a runnable suffix so the
  // local Ollama server routes them to Ollama Cloud (requires `ollama signin`).

  private async fetchModelList(url: string, apiKey?: string): Promise<readonly string[]> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await this.fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(MODEL_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const json = (await response.json()) as OpenAiModelList;
    if (!Array.isArray(json.data)) return [];
    const entries: readonly unknown[] = json.data;
    return entries
      .map((entry) =>
        typeof entry === "object" && entry !== null
          ? (entry as { id?: unknown }).id
          : undefined,
      )
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  /**
   * Fetch Ollama local + cloud models. Local and cloud fetch failures are
   * swallowed independently: the dropdown gets whichever sources succeeded.
   * Only if both fail does this throw, surfacing the local error.
   */
  private async fetchOllamaModels(baseUrl: string): Promise<readonly ModelOption[]> {
    const localIds = await this.fetchModelList(`${baseUrl}/models`).catch(
      () => [] as string[],
    );
    const cloudIds = await this.fetchModelList(OLLAMA_CLOUD_CATALOG_URL).catch(
      () => [] as string[],
    );

    const seen = new Set<string>();
    const models: ModelOption[] = [];

    for (const id of localIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      models.push({ id, name: id });
    }
    for (const id of cloudIds) {
      const cloudId = ollamaCloudId(id);
      if (seen.has(cloudId)) continue;
      seen.add(cloudId);
      models.push({ id: cloudId, name: `${id} (cloud)` });
    }

    if (models.length === 0) {
      // Both fetches returned nothing — most likely the local Ollama server is
      // not running. Throw so the form shows an actionable error.
      throw new Error(mainT("error.ollamaNoModels", { baseUrl }));
    }
    return models;
  }

  /** Fetch models from an OpenAI-compatible endpoint (`{baseUrl}/v1/models`). */
  private async fetchOpenAiCompatibleModels(
    baseUrl: string,
    apiKey?: string,
  ): Promise<readonly ModelOption[]> {
    const normalized = ensureV1Suffix(baseUrl);
    const ids = await this.fetchModelList(`${normalized}/models`, apiKey);
    if (ids.length === 0) {
      throw new Error(mainT("error.endpointNoModels", { url: normalized }));
    }
    return ids.map((id) => ({ id, name: id }));
  }
}