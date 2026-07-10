// Tests for ModelCatalog — the deepened module whose interface is the test
// surface for model discovery + provider registration. The testability win is
// the **injectable `fetch`** (the seam): an in-memory fetch adapter lets these
// exercise the Ollama local+cloud graceful-degradation path and the
// openai-compatible path without touching the network. The `modelRegistry` and
// `authStorage` deps are narrowed to a structural `Pick`, so minimal typed fakes
// (plain objects) stand in for them — no `any`, no real services, no disk.
import { describe, expect, it } from "vitest";
import { ModelCatalog, type ModelCatalogDeps } from "../src/main/model-catalog.ts";
import type { LlmConfig, ModelOption, ProviderId, Result } from "../src/shared/ipc-types.ts";

// ─── Minimal typed fakes ────────────────────────────────────────────────
// Shapes follow the `Pick` slices in ModelCatalogDeps. Deriving the model and
// credential types FROM the catalog's deps keeps the fakes structurally
// compatible with the real `Model<Api>` / `AuthCredential` (no `any`, no
// hand-maintained parallel types).

/** The real `Model<Api>` element type returned by `getAll()`. */
type CatalogModel = ReturnType<ModelCatalogDeps["modelRegistry"]["getAll"]>[number];
/** The real `AuthCredential` union accepted by `authStorage.set`. */
type CatalogCredential = Parameters<ModelCatalogDeps["authStorage"]["set"]>[1];
/** The real `ProviderConfigInput` accepted by `registerProvider`. */
type CatalogProviderConfig = Parameters<ModelCatalogDeps["modelRegistry"]["registerProvider"]>[1];

/** Recorded `registerProvider` call. `config` is the real `ProviderConfigInput`. */
interface RegisteredProvider {
  readonly providerName: string;
  readonly config: CatalogProviderConfig;
}

interface FakeModelRegistry {
  getAvailable: () => CatalogModel[];
  getAll: () => CatalogModel[];
  registerProvider: (providerName: string, config: CatalogProviderConfig) => void;
}

function makeModel(provider: string, id: string): CatalogModel {
  return {
    id,
    name: id,
    api: "openai-completions",
    provider,
    baseUrl: "http://x/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  };
}

function makeModelRegistry(
  available: readonly CatalogModel[],
  all: readonly CatalogModel[],
): { registry: FakeModelRegistry; registered: RegisteredProvider[] } {
  const registered: RegisteredProvider[] = [];
  const registry: FakeModelRegistry = {
    getAvailable: () => [...available],
    getAll: () => [...all],
    registerProvider: (providerName, config) => {
      registered.push({ providerName, config });
    },
  };
  return { registry, registered };
}

/** A recorded `authStorage.set` call. `credential` is the real union; tests
 *  narrow it (`type === "api_key"`) before reading `key`. */
interface SetCall {
  readonly provider: string;
  readonly credential: CatalogCredential;
}

interface FakeAuthStorage {
  set: (provider: string, credential: CatalogCredential) => void;
  get: (provider: string) => CatalogCredential | undefined;
  readonly setCalls: SetCall[];
  readonly store: Map<string, CatalogCredential>;
}

function makeAuthStorage(): FakeAuthStorage {
  const store = new Map<string, CatalogCredential>();
  const setCalls: SetCall[] = [];
  return {
    store,
    setCalls,
    set: (provider, credential) => {
      setCalls.push({ provider, credential });
      store.set(provider, credential);
    },
    get: (provider) => store.get(provider),
  };
}

/** Read the `key` from an `api_key` credential (undefined for oauth / absent). */
function apiKey(cred: CatalogCredential | undefined): string | undefined {
  return cred?.type === "api_key" ? cred.key : undefined;
}

// ─── Fake fetch (the seam) ──────────────────────────────────────────────

/** Build a fetch fake that maps URL -> OpenAI-compat model list response, or
 *  -> a failure (throws / non-ok) for specific URLs. */
interface FetchRoute {
  readonly url: string;
  readonly ids: readonly string[];
  /** When true, the fetch for this URL rejects (network failure). */
  readonly fail?: boolean;
  /** When set, the fetch resolves with this HTTP status (non-ok). */
  readonly status?: number;
}

function makeFetch(routes: readonly FetchRoute[]): typeof fetch {
  const map = new Map(routes.map((r) => [r.url, r] as const));
  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const route = map.get(url);
    if (!route) throw new Error(`Unexpected fetch URL: ${url}`);
    if (route.fail) throw new Error(`network error for ${url}`);
    const status = route.status ?? 200;
    const body = JSON.stringify({ data: route.ids.map((id) => ({ id })) });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      json: async () => JSON.parse(body) as { data: readonly { id: string }[] },
    } as Response;
  }) as typeof fetch;
}

// ─── helpers for reading results ────────────────────────────────────────

function models(r: Result<readonly ModelOption[]>): readonly ModelOption[] {
  if (!r.success) throw new Error(`expected success, got error: ${r.error.message}`);
  return r.data;
}

function errorOf<T>(r: Result<T>): string {
  if (r.success) throw new Error(`expected error, got data: ${JSON.stringify(r.data)}`);
  return r.error.message;
}

// ─── tests ──────────────────────────────────────────────────────────────

describe("ModelCatalog.loadModels — ollama", () => {
  it("returns local ids unchanged and applies the cloud suffix to cloud ids", async () => {
    const { registry } = makeModelRegistry([], []);
    const fetch = makeFetch([
      { url: "http://localhost:11434/v1/models", ids: ["llama3", "mistral"] },
      { url: "https://ollama.com/v1/models", ids: ["qwen2:7b", "gpt-oss"] },
    ]);
    const catalog = new ModelCatalog({ modelRegistry: registry, authStorage: makeAuthStorage(), fetch });

    const out = models(await catalog.loadModels("ollama"));
    const ids = out.map((m) => m.id);
    expect(ids).toContain("llama3");
    expect(ids).toContain("mistral");
    // cloud suffix rule: ":" present -> "-cloud", else ":cloud"
    expect(ids).toContain("qwen2:7b-cloud");
    expect(ids).toContain("gpt-oss:cloud");
    // cloud model display name keeps the base id + " (cloud)"
    const qwen = out.find((m) => m.id === "qwen2:7b-cloud");
    expect(qwen?.name).toBe("qwen2:7b (cloud)");
  });

  it("ensures a /v1 suffix on the local base URL before fetching", async () => {
    const { registry } = makeModelRegistry([], []);
    const fetch = makeFetch([
      // base passed without /v1 -> catalog appends /v1/models
      { url: "http://localhost:11434/v1/models", ids: ["llama3"] },
      { url: "https://ollama.com/v1/models", ids: [] },
    ]);
    const catalog = new ModelCatalog({ modelRegistry: registry, authStorage: makeAuthStorage(), fetch });

    const out = models(await catalog.loadModels("ollama", undefined, "http://localhost:11434"));
    expect(out.map((m) => m.id)).toEqual(["llama3"]);
  });

  it("returns local models when the cloud fetch fails (independent swallowing)", async () => {
    const { registry } = makeModelRegistry([], []);
    const fetch = makeFetch([
      { url: "http://localhost:11434/v1/models", ids: ["llama3"] },
      { url: "https://ollama.com/v1/models", ids: [], fail: true },
    ]);
    const catalog = new ModelCatalog({ modelRegistry: registry, authStorage: makeAuthStorage(), fetch });

    const out = models(await catalog.loadModels("ollama"));
    expect(out.map((m) => m.id)).toEqual(["llama3"]);
  });

  it("returns cloud models when the local fetch fails (independent swallowing)", async () => {
    const { registry } = makeModelRegistry([], []);
    const fetch = makeFetch([
      { url: "http://localhost:11434/v1/models", ids: [], fail: true },
      { url: "https://ollama.com/v1/models", ids: ["qwen2"] },
    ]);
    const catalog = new ModelCatalog({ modelRegistry: registry, authStorage: makeAuthStorage(), fetch });

    const out = models(await catalog.loadModels("ollama"));
    expect(out.map((m) => m.id)).toEqual(["qwen2:cloud"]);
  });

  it("errors when both local and cloud return nothing (server not running)", async () => {
    const { registry } = makeModelRegistry([], []);
    const fetch = makeFetch([
      { url: "http://localhost:11434/v1/models", ids: [] },
      { url: "https://ollama.com/v1/models", ids: [] },
    ]);
    const catalog = new ModelCatalog({ modelRegistry: registry, authStorage: makeAuthStorage(), fetch });

    const r = await catalog.loadModels("ollama");
    expect(r.success).toBe(false);
    expect(errorOf(r)).toContain("No Ollama models found");
  });

  it("errors when both local and cloud fetches fail", async () => {
    const { registry } = makeModelRegistry([], []);
    const fetch = makeFetch([
      { url: "http://localhost:11434/v1/models", ids: [], fail: true },
      { url: "https://ollama.com/v1/models", ids: [], fail: true },
    ]);
    const catalog = new ModelCatalog({ modelRegistry: registry, authStorage: makeAuthStorage(), fetch });

    const r = await catalog.loadModels("ollama");
    expect(r.success).toBe(false);
  });
});

describe("ModelCatalog.loadModels — openai-compatible", () => {
  it("ensures the v1 suffix and maps ids through", async () => {
    const { registry } = makeModelRegistry([], []);
    const fetch = makeFetch([
      // base passed without /v1 -> catalog normalizes to /v1/models
      { url: "http://my-endpoint/v1/models", ids: ["foo", "bar"] },
    ]);
    const catalog = new ModelCatalog({ modelRegistry: registry, authStorage: makeAuthStorage(), fetch });

    const out = models(await catalog.loadModels("openai-compatible", "key", "http://my-endpoint"));
    expect(out.map((m) => m.id)).toEqual(["foo", "bar"]);
  });

  it("errors when baseUrl is missing", async () => {
    const { registry } = makeModelRegistry([], []);
    const catalog = new ModelCatalog({ modelRegistry: registry, authStorage: makeAuthStorage() });

    const r = await catalog.loadModels("openai-compatible");
    expect(r.success).toBe(false);
    expect(errorOf(r)).toContain("Base URL required");
  });

  it("surfaces an error when the fetch itself fails", async () => {
    const { registry } = makeModelRegistry([], []);
    const fetch = makeFetch([
      { url: "http://my-endpoint/v1/models", ids: [], fail: true },
    ]);
    const catalog = new ModelCatalog({ modelRegistry: registry, authStorage: makeAuthStorage(), fetch });

    const r = await catalog.loadModels("openai-compatible", undefined, "http://my-endpoint/v1");
    expect(r.success).toBe(false);
  });

  it("sends the Bearer api key when provided", async () => {
    const { registry } = makeModelRegistry([], []);
    let seenAuth: string | undefined;
    const fakeFetch: typeof fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toBe("http://my-endpoint/v1/models");
      seenAuth = (init?.headers as Record<string, string> | undefined)?.["Authorization"];
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ data: [{ id: "foo" }] }) as { data: readonly { id: string }[] },
      } as Response;
    }) as typeof fetch;
    const catalog = new ModelCatalog({ modelRegistry: registry, authStorage: makeAuthStorage(), fetch: fakeFetch });

    const out = models(await catalog.loadModels("openai-compatible", "secret", "http://my-endpoint/v1"));
    expect(out.map((m) => m.id)).toEqual(["foo"]);
    expect(seenAuth).toBe("Bearer secret");
  });
});

describe("ModelCatalog.loadModels — github-copilot", () => {
  it("returns an error (must use loginCopilot)", async () => {
    const { registry } = makeModelRegistry([], []);
    const catalog = new ModelCatalog({ modelRegistry: registry, authStorage: makeAuthStorage() });

    const r = await catalog.loadModels("github-copilot");
    expect(r.success).toBe(false);
    expect(errorOf(r)).toContain("loginCopilot");
  });
});

describe("ModelCatalog.loadModels — anthropic / openai / google (auth-gated)", () => {
  it("stores the API key and returns the provider's available models", async () => {
    const anthropicModels = [makeModel("anthropic", "claude-3"), makeModel("anthropic", "claude-4")];
    const openaiModels = [makeModel("openai", "gpt-4")];
    const { registry } = makeModelRegistry([...anthropicModels, ...openaiModels], [...anthropicModels, ...openaiModels]);
    const auth = makeAuthStorage();
    const catalog = new ModelCatalog({ modelRegistry: registry, authStorage: auth });

    const out = models(await catalog.loadModels("anthropic", "sk-ant-key"));
    expect(out.map((m) => m.id)).toEqual(["claude-3", "claude-4"]);
    // key stored on authStorage
    expect(auth.setCalls).toEqual([{ provider: "anthropic", credential: { type: "api_key", key: "sk-ant-key" } }]);
    expect(apiKey(auth.store.get("anthropic"))).toBe("sk-ant-key");

    // openai is filtered separately
    const out2 = models(await catalog.loadModels("openai", "sk-key"));
    expect(out2.map((m) => m.id)).toEqual(["gpt-4"]);
  });

  it("does not store a key when no apiKey is given", async () => {
    const { registry } = makeModelRegistry([makeModel("google", "gemini")], [makeModel("google", "gemini")]);
    const auth = makeAuthStorage();
    const catalog = new ModelCatalog({ modelRegistry: registry, authStorage: auth });

    const out = models(await catalog.loadModels("google"));
    expect(out.map((m) => m.id)).toEqual(["gemini"]);
    expect(auth.setCalls).toHaveLength(0);
  });
});

describe("ModelCatalog.listAvailableModels", () => {
  it("filters the registry's available models by provider", () => {
    const { registry } = makeModelRegistry(
      [makeModel("anthropic", "claude"), makeModel("openai", "gpt-4")],
      [],
    );
    const catalog = new ModelCatalog({ modelRegistry: registry, authStorage: makeAuthStorage() });

    const out = models(catalog.listAvailableModels("openai"));
    expect(out.map((m) => m.id)).toEqual(["gpt-4"]);
  });

  it("returns an empty list when no models match", () => {
    const { registry } = makeModelRegistry([makeModel("anthropic", "claude")], []);
    const catalog = new ModelCatalog({ modelRegistry: registry, authStorage: makeAuthStorage() });

    const out = models(catalog.listAvailableModels("ollama"));
    expect(out).toEqual([]);
  });
});

describe("ModelCatalog.resolveModel", () => {
  it("finds a model by provider + modelId", () => {
    const all = [makeModel("ollama", "llama3"), makeModel("openai-compatible", "llama3")];
    const { registry } = makeModelRegistry([], all);
    const catalog = new ModelCatalog({ modelRegistry: registry, authStorage: makeAuthStorage() });

    const config: LlmConfig = { provider: "ollama", modelId: "llama3" };
    const model = catalog.resolveModel(config);
    expect(model?.provider).toBe("ollama");
    expect(model?.id).toBe("llama3");
  });

  it("falls back to modelId alone when the provider has no exact match", () => {
    const all = [makeModel("openai-compatible", "llama3")];
    const { registry } = makeModelRegistry([], all);
    const catalog = new ModelCatalog({ modelRegistry: registry, authStorage: makeAuthStorage() });

    // provider mismatch, but id matches -> fallback by id alone
    const config: LlmConfig = { provider: "ollama", modelId: "llama3" };
    const model = catalog.resolveModel(config);
    expect(model?.id).toBe("llama3");
  });

  it("returns null when the model is absent", () => {
    const { registry } = makeModelRegistry([], [makeModel("anthropic", "claude")]);
    const catalog = new ModelCatalog({ modelRegistry: registry, authStorage: makeAuthStorage() });

    const config: LlmConfig = { provider: "ollama", modelId: "missing" };
    expect(catalog.resolveModel(config)).toBeNull();
  });

  it("treats openai-compatible provider name as 'openai-compatible'", () => {
    const all = [makeModel("openai-compatible", "my-model")];
    const { registry } = makeModelRegistry([], all);
    const catalog = new ModelCatalog({ modelRegistry: registry, authStorage: makeAuthStorage() });

    const config: LlmConfig = { provider: "openai-compatible", modelId: "my-model" };
    const model = catalog.resolveModel(config);
    expect(model?.provider).toBe("openai-compatible");
    expect(model?.id).toBe("my-model");
  });
});

describe("ModelCatalog.registerProvider", () => {
  it("registers an ollama provider with the OpenAI-completions wire protocol", () => {
    const { registry, registered } = makeModelRegistry([], []);
    const auth = makeAuthStorage();
    const catalog = new ModelCatalog({ modelRegistry: registry, authStorage: auth });

    const config: LlmConfig = { provider: "ollama", modelId: "llama3", baseUrl: "http://localhost:11434/v1" };
    catalog.registerProvider(config);

    expect(registered).toHaveLength(1);
    const [call] = registered;
    expect(call.providerName).toBe("ollama");
    expect(call.config.name).toBe("Ollama");
    expect(call.config.baseUrl).toBe("http://localhost:11434/v1");
    expect(call.config.api).toBe("openai-completions");
    expect(call.config.apiKey).toBe("ollama"); // placeholder for ollama without apiKey
    expect(call.config.models?.[0]?.id).toBe("llama3");
    // ollama does NOT touch authStorage
    expect(auth.setCalls).toHaveLength(0);
  });

  it("registers an openai-compatible provider with the provided baseUrl + apiKey", () => {
    const { registry, registered } = makeModelRegistry([], []);
    const auth = makeAuthStorage();
    const catalog = new ModelCatalog({ modelRegistry: registry, authStorage: auth });

    const config: LlmConfig = {
      provider: "openai-compatible",
      modelId: "my-model",
      baseUrl: "http://my-endpoint/v1",
      apiKey: "key-1",
    };
    catalog.registerProvider(config);

    expect(registered).toHaveLength(1);
    const [call] = registered;
    expect(call.providerName).toBe("openai-compatible");
    expect(call.config.name).toBe("OpenAI-compatible");
    expect(call.config.baseUrl).toBe("http://my-endpoint/v1");
    expect(call.config.apiKey).toBe("key-1");
    expect(call.config.models?.[0]?.id).toBe("my-model");
    expect(auth.setCalls).toHaveLength(0);
  });

  it("stores the API key on authStorage for anthropic (and openai/google)", () => {
    const { registry, registered } = makeModelRegistry([], []);
    const auth = makeAuthStorage();
    const catalog = new ModelCatalog({ modelRegistry: registry, authStorage: auth });

    const config: LlmConfig = { provider: "anthropic", modelId: "claude-3", apiKey: "sk-ant" };
    catalog.registerProvider(config);

    // anthropic does NOT register a provider into the registry
    expect(registered).toHaveLength(0);
    expect(auth.setCalls).toEqual([{ provider: "anthropic", credential: { type: "api_key", key: "sk-ant" } }]);
  });

  it("is a no-op for github-copilot", () => {
    const { registry, registered } = makeModelRegistry([], []);
    const auth = makeAuthStorage();
    const catalog = new ModelCatalog({ modelRegistry: registry, authStorage: auth });

    const config: LlmConfig = { provider: "github-copilot", modelId: "gpt-4" };
    catalog.registerProvider(config);

    expect(registered).toHaveLength(0);
    expect(auth.setCalls).toHaveLength(0);
  });
});