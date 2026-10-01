// ModelCatalog: the deep module that owns model discovery + provider
// registration for the LLM config flow. Its interface is the test surface for
// model selection and provider setup through Pi's ModelRuntime.
//
// What lives here (the deep implementation):
//   - the pure HTTP model-list fetching for Ollama (local + cloud) and
//     OpenAI-compatible endpoints (the OpenAI /v1/models shape)
//   - the cloud-id suffix rule (ollamaCloudId) and the v1-suffix normalization
//   - the built-in static model catalogs for anthropic/openai/google
//   - provider registration and API-key handling through Pi ModelRuntime
//   - model resolution from the runtime for both roles — the chat model and
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
//   - anthropic/openai/google: return the built-in model catalog; credentials
//     are applied only when the user saves the configuration.
//   - github-copilot: err (must use loginCopilot()).
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ok, err, errorMessage } from "../shared/result.ts";
import { mainT } from "./i18n.ts";
import type { LlmConfig, ModelOption, ProviderId, Result } from "../shared/ipc-types.ts";

/** A chat model resolved from Pi's canonical model runtime. */
type ResolvedModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;

/** Narrow Pi runtime surface: minimal fakes keep catalog tests independent of
 *  ModelRuntime's private implementation. */
export interface ModelCatalogRuntime {
  getModels(providerId?: string): readonly ResolvedModel[];
  getModel(providerId: string, modelId: string): ResolvedModel | undefined;
  getAvailable(providerId?: string): Promise<readonly ResolvedModel[]>;
  registerProvider(
    providerId: string,
    config: Parameters<ModelRuntime["registerProvider"]>[1],
  ): void;
  getRegisteredProviderConfig(
    providerId: string,
  ): ReturnType<ModelRuntime["getRegisteredProviderConfig"]>;
  setRuntimeApiKey(providerId: string, apiKey: string): Promise<void>;
  removeRuntimeApiKey(providerId: string): Promise<void>;
  logout(providerId: string): Promise<void>;
}

export interface ModelCatalogDeps {
  readonly modelRuntime: ModelCatalogRuntime;
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
  async listAvailableModels(provider: ProviderId): Promise<Result<readonly ModelOption[]>> {
    try {
      const models = await this.deps.modelRuntime.getAvailable(provider);
      return ok(models.map((model) => ({ id: model.id, name: model.name })));
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
   *    - anthropic/openai/google -> return the built-in static model catalog;
   *                       credentials are applied when configuration is saved */
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
      // anthropic / openai / google use static built-in catalogs. The renderer
      // gates this request on a supplied/stored key; avoid injecting an
      // unsaved credential into the workspace runtime just to list model IDs.
      const models = this.deps.modelRuntime.getModels(provider);
      return ok(models.map((model) => ({ id: model.id, name: model.name })));
    } catch (error) {
      return err<readonly ModelOption[]>(errorMessage(error));
    }
  }

  /** Register a provider (ollama/openai-compatible) or apply an API key
   *  (anthropic/openai/google) through ModelRuntime. Copilot uses OAuth. */
  async registerProvider(config: LlmConfig): Promise<void> {
    const providerName =
      config.provider === "openai-compatible" ? "openai-compatible" : config.provider;
    const baseUrl =
      config.baseUrl ?? (config.provider === "ollama" ? "http://localhost:11434/v1" : "");
    let endpointChanged = false;

    if (config.provider === "openai-compatible") {
      const previous = this.deps.modelRuntime.getRegisteredProviderConfig(providerName);
      endpointChanged = previous?.baseUrl !== baseUrl;
      if (endpointChanged || !config.apiKey) {
        await this.deps.modelRuntime.removeRuntimeApiKey(providerName);
      } else {
        await this.deps.modelRuntime.setRuntimeApiKey(providerName, config.apiKey);
      }
    } else if (config.apiKey && config.provider !== "github-copilot") {
      await this.deps.modelRuntime.setRuntimeApiKey(config.provider, config.apiKey);
    }

    if (config.provider === "ollama" || config.provider === "openai-compatible") {
      // OpenAI-compatible catalogs may expose per-model vision metadata (for
      // example Requesty's `supports_vision`). Fetch it at configuration time
      // so the ingest extension receives accurate Pi model input metadata.
      // This is optional: endpoints without the field or an available catalog
      // remain text-only rather than blocking LLM configuration.
      const visionModelIds = config.provider === "openai-compatible"
        ? await this.fetchVisionModelIds(baseUrl, config.apiKey).catch(() => new Set<string>())
        : new Set<string>();
      this.deps.modelRuntime.registerProvider(providerName, {
        name: config.provider === "ollama" ? "Ollama" : "OpenAI-compatible",
        baseUrl,
        // Keep secret material out of ModelRuntime's provider config. The
        // actual key is supplied through its runtime credential overlay below.
        apiKey: config.provider === "ollama" ? "ollama" : "not-needed",
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
          input: visionModelIds.has(modelId) ? ["text", "image"] : ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 8192,
        })),
      });
    }
    if (config.provider === "openai-compatible" && config.apiKey && endpointChanged) {
      // After the provider switches hosts, install only the newly supplied key.
      await this.deps.modelRuntime.setRuntimeApiKey(providerName, config.apiKey);
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

  removeApiKey(provider: ProviderId): Promise<void> {
    // logout clears both the runtime override and any credentials saved by an
    // older app version in Pi's auth.json.
    return this.deps.modelRuntime.logout(provider);
  }

  private findModel(provider: ProviderId, modelId: string): ResolvedModel | null {
    return (
      this.deps.modelRuntime.getModel(provider, modelId) ??
      this.deps.modelRuntime.getModels().find((model) => model.id === modelId) ??
      null
    );
  }

  private modelNotFound(provider: ProviderId, modelId: string): Result<ResolvedLlmModels> {
    return err<ResolvedLlmModels>(mainT("error.modelNotFound", { provider, modelId }));
  }

  // ─── HTTP model-list fetch helpers (Ollama / openai-compatible) ──────────
  // See ADR 0001. All endpoints speak the OpenAI-compat /v1/models shape:
  // { data: [{ id: string, ... }] }. Cloud models get a runnable suffix so the
  // local Ollama server routes them to Ollama Cloud (requires `ollama signin`).

  private async fetchVisionModelIds(baseUrl: string, apiKey?: string): Promise<ReadonlySet<string>> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await this.fetchImpl(`${ensureV1Suffix(baseUrl)}/models`, {
      headers,
      signal: AbortSignal.timeout(MODEL_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

    const json: unknown = await response.json();
    if (typeof json !== "object" || json === null || !("data" in json) || !Array.isArray(json.data)) {
      return new Set<string>();
    }
    const visionModelIds = new Set<string>();
    for (const entry of json.data) {
      if (typeof entry !== "object" || entry === null) continue;
      const model = entry as { id?: unknown; supports_vision?: unknown };
      if (typeof model.id === "string" && model.supports_vision === true) {
        visionModelIds.add(model.id);
      }
    }
    return visionModelIds;
  }

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