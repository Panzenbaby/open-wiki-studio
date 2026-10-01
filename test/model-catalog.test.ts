// Tests for ModelCatalog — the deepened module whose interface is the test
// surface for model discovery + provider registration. The testability win is
// the **injectable `fetch`** (the seam): an in-memory fetch adapter lets these
// exercise the Ollama local+cloud graceful-degradation path and the
// openai-compatible path without touching the network. A narrow ModelRuntime
// interface lets minimal typed fakes stand in without real services or disk.
import { describe, expect, it } from "vitest";
import { effectiveIngestModelId, ModelCatalog, type ModelCatalogRuntime, type ResolvedLlmModels } from "../src/main/model-catalog.ts";
import type { LlmConfig, ModelOption, Result } from "../src/shared/ipc-types.ts";

// ─── Minimal typed fakes ────────────────────────────────────────────────
// Shapes follow the narrow ModelRuntime interface used by ModelCatalog. The
// model type comes from the Pi runtime API; there is no real runtime or disk.

/** The real `Model<Api>` element type returned by `getModels()`. */
type CatalogModel = ReturnType<ModelCatalogRuntime["getModels"]>[number];
/** The credential shape used by ModelRuntime's runtime API-key setter. */
type CatalogCredential = { readonly type: "api_key"; readonly key: string };
/** The real `ProviderConfigInput` accepted by `registerProvider`. */
type CatalogProviderConfig = Parameters<ModelCatalogRuntime["registerProvider"]>[1];

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

function makeModelRuntime(registry: FakeModelRegistry, auth: FakeAuthStorage): ModelCatalogRuntime {
  const registeredProviders = new Map<string, CatalogProviderConfig>();
  return {
    getModels: (provider) => registry.getAll().filter((model) => provider === undefined || model.provider === provider),
    getModel: (provider, id) => registry.getAll().find((model) => model.provider === provider && model.id === id),
    getAvailable: async (provider) => registry.getAvailable().filter((model) => provider === undefined || model.provider === provider),
    registerProvider: (provider, config) => {
      auth.keysAtProviderRegistration.push(apiKey(auth.store.get(provider)));
      registry.registerProvider(provider, config);
      registeredProviders.set(provider, config);
    },
    getRegisteredProviderConfig: (provider) => registeredProviders.get(provider),
    setRuntimeApiKey: async (provider, key) => auth.set(provider, { type: "api_key", key }),
    removeRuntimeApiKey: async (provider) => {
      auth.store.delete(provider);
    },
    logout: async (provider) => {
      auth.store.delete(provider);
    },
  };
}

/** A recorded ModelRuntime API-key setter call. */
interface SetCall {
  readonly provider: string;
  readonly credential: CatalogCredential;
}

interface FakeAuthStorage {
  set: (provider: string, credential: CatalogCredential) => void;
  get: (provider: string) => CatalogCredential | undefined;
  readonly setCalls: SetCall[];
  readonly keysAtProviderRegistration: Array<string | undefined>;
  readonly store: Map<string, CatalogCredential>;
}

function makeAuthStorage(): FakeAuthStorage {
  const store = new Map<string, CatalogCredential>();
  const setCalls: SetCall[] = [];
  const keysAtProviderRegistration: Array<string | undefined> = [];
  return {
    store,
    setCalls,
    keysAtProviderRegistration,
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
  return (async (input: string | URL | Request): Promise<Response> => {
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

function resolved(r: Result<ResolvedLlmModels>): ResolvedLlmModels {
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
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, makeAuthStorage()), fetch });

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
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, makeAuthStorage()), fetch });

    const out = models(await catalog.loadModels("ollama", undefined, "http://localhost:11434"));
    expect(out.map((m) => m.id)).toEqual(["llama3"]);
  });

  it("returns local models when the cloud fetch fails (independent swallowing)", async () => {
    const { registry } = makeModelRegistry([], []);
    const fetch = makeFetch([
      { url: "http://localhost:11434/v1/models", ids: ["llama3"] },
      { url: "https://ollama.com/v1/models", ids: [], fail: true },
    ]);
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, makeAuthStorage()), fetch });

    const out = models(await catalog.loadModels("ollama"));
    expect(out.map((m) => m.id)).toEqual(["llama3"]);
  });

  it("returns cloud models when the local fetch fails (independent swallowing)", async () => {
    const { registry } = makeModelRegistry([], []);
    const fetch = makeFetch([
      { url: "http://localhost:11434/v1/models", ids: [], fail: true },
      { url: "https://ollama.com/v1/models", ids: ["qwen2"] },
    ]);
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, makeAuthStorage()), fetch });

    const out = models(await catalog.loadModels("ollama"));
    expect(out.map((m) => m.id)).toEqual(["qwen2:cloud"]);
  });

  it("errors when both local and cloud return nothing (server not running)", async () => {
    const { registry } = makeModelRegistry([], []);
    const fetch = makeFetch([
      { url: "http://localhost:11434/v1/models", ids: [] },
      { url: "https://ollama.com/v1/models", ids: [] },
    ]);
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, makeAuthStorage()), fetch });

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
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, makeAuthStorage()), fetch });

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
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, makeAuthStorage()), fetch });

    const out = models(await catalog.loadModels("openai-compatible", "key", "http://my-endpoint"));
    expect(out.map((m) => m.id)).toEqual(["foo", "bar"]);
  });

  it("errors when baseUrl is missing", async () => {
    const { registry } = makeModelRegistry([], []);
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, makeAuthStorage()) });

    const r = await catalog.loadModels("openai-compatible");
    expect(r.success).toBe(false);
    expect(errorOf(r)).toContain("Base URL required");
  });

  it("surfaces an error when the fetch itself fails", async () => {
    const { registry } = makeModelRegistry([], []);
    const fetch = makeFetch([
      { url: "http://my-endpoint/v1/models", ids: [], fail: true },
    ]);
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, makeAuthStorage()), fetch });

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
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, makeAuthStorage()), fetch: fakeFetch });

    const out = models(await catalog.loadModels("openai-compatible", "secret", "http://my-endpoint/v1"));
    expect(out.map((m) => m.id)).toEqual(["foo"]);
    expect(seenAuth).toBe("Bearer secret");
  });
});

describe("ModelCatalog.loadModels — github-copilot", () => {
  it("returns an error (must use loginCopilot)", async () => {
    const { registry } = makeModelRegistry([], []);
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, makeAuthStorage()) });

    const r = await catalog.loadModels("github-copilot");
    expect(r.success).toBe(false);
    expect(errorOf(r)).toContain("loginCopilot");
  });
});

describe("ModelCatalog.loadModels — anthropic / openai / google", () => {
  it("returns built-in provider models without mutating runtime credentials", async () => {
    const anthropicModels = [makeModel("anthropic", "claude-3"), makeModel("anthropic", "claude-4")];
    const openaiModels = [makeModel("openai", "gpt-4")];
    const { registry } = makeModelRegistry([...anthropicModels, ...openaiModels], [...anthropicModels, ...openaiModels]);
    const auth = makeAuthStorage();
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, auth) });

    const out = models(await catalog.loadModels("anthropic", "sk-ant-key"));
    expect(out.map((m) => m.id)).toEqual(["claude-3", "claude-4"]);
    // Model preview must not install an unsaved key into the runtime.
    expect(auth.setCalls).toHaveLength(0);
    expect(apiKey(auth.store.get("anthropic"))).toBeUndefined();

    // openai is filtered separately
    const out2 = models(await catalog.loadModels("openai", "sk-key"));
    expect(out2.map((m) => m.id)).toEqual(["gpt-4"]);
    expect(auth.setCalls).toHaveLength(0);
  });

  it("returns built-in models when no key is passed", async () => {
    const { registry } = makeModelRegistry([makeModel("google", "gemini")], [makeModel("google", "gemini")]);
    const auth = makeAuthStorage();
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, auth) });

    const out = models(await catalog.loadModels("google"));
    expect(out.map((m) => m.id)).toEqual(["gemini"]);
    expect(auth.setCalls).toHaveLength(0);
  });

  it("removes stored credentials through ModelRuntime logout", async () => {
    const { registry } = makeModelRegistry([], []);
    const credentials = makeAuthStorage();
    credentials.set("anthropic", { type: "api_key", key: "secret" });
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, credentials) });

    await catalog.removeApiKey("anthropic");

    expect(credentials.store.has("anthropic")).toBe(false);
  });
});

describe("ModelCatalog.listAvailableModels", () => {
  it("filters the registry's available models by provider", async () => {
    const { registry } = makeModelRegistry(
      [makeModel("anthropic", "claude"), makeModel("openai", "gpt-4")],
      [],
    );
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, makeAuthStorage()) });

    const out = models(await catalog.listAvailableModels("openai"));
    expect(out.map((m) => m.id)).toEqual(["gpt-4"]);
  });

  it("returns an empty list when no models match", async () => {
    const { registry } = makeModelRegistry([makeModel("anthropic", "claude")], []);
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, makeAuthStorage()) });

    const out = models(await catalog.listAvailableModels("ollama"));
    expect(out).toEqual([]);
  });
});

describe("effectiveIngestModelId", () => {
  it("follows the chat model while no separate ingest model is set", () => {
    expect(effectiveIngestModelId({ modelId: "chat" })).toBe("chat");
  });

  it("uses the separately chosen ingest model", () => {
    expect(effectiveIngestModelId({ modelId: "chat", ingestModelId: "strong" })).toBe("strong");
  });
});

describe("ModelCatalog.resolveModels", () => {
  it("finds a model by provider + modelId and uses it for both roles by default", () => {
    const all = [makeModel("ollama", "llama3"), makeModel("openai-compatible", "llama3")];
    const { registry } = makeModelRegistry([], all);
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, makeAuthStorage()) });

    const config: LlmConfig = { provider: "ollama", modelId: "llama3" };
    const { chat, ingest } = resolved(catalog.resolveModels(config));
    expect(chat.provider).toBe("ollama");
    expect(chat.id).toBe("llama3");
    expect(ingest).toBe(chat);
  });

  it("resolves a separately chosen ingest model", () => {
    const all = [makeModel("anthropic", "claude-haiku"), makeModel("anthropic", "claude-opus")];
    const { registry } = makeModelRegistry([], all);
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, makeAuthStorage()) });

    const config: LlmConfig = { provider: "anthropic", modelId: "claude-haiku", ingestModelId: "claude-opus" };
    const { chat, ingest } = resolved(catalog.resolveModels(config));
    expect(chat.id).toBe("claude-haiku");
    expect(ingest.id).toBe("claude-opus");
    expect(ingest.provider).toBe("anthropic");
  });

  it("falls back to modelId alone when the provider has no exact match", () => {
    const all = [makeModel("openai-compatible", "llama3")];
    const { registry } = makeModelRegistry([], all);
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, makeAuthStorage()) });

    // provider mismatch, but id matches -> fallback by id alone
    const config: LlmConfig = { provider: "ollama", modelId: "llama3" };
    expect(resolved(catalog.resolveModels(config)).chat.id).toBe("llama3");
  });

  it("fails with the missing chat model when it is absent", () => {
    const { registry } = makeModelRegistry([], [makeModel("anthropic", "claude")]);
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, makeAuthStorage()) });

    const config: LlmConfig = { provider: "ollama", modelId: "missing" };
    expect(errorOf(catalog.resolveModels(config))).toBe("Model not found in registry: ollama/missing");
  });

  it("fails as a whole with the missing ingest model when only the chat model exists", () => {
    const { registry } = makeModelRegistry([], [makeModel("anthropic", "claude")]);
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, makeAuthStorage()) });

    const config: LlmConfig = { provider: "anthropic", modelId: "claude", ingestModelId: "gone" };
    expect(errorOf(catalog.resolveModels(config))).toBe("Model not found in registry: anthropic/gone");
  });

  it("treats openai-compatible provider name as 'openai-compatible'", () => {
    const all = [makeModel("openai-compatible", "my-model")];
    const { registry } = makeModelRegistry([], all);
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, makeAuthStorage()) });

    const config: LlmConfig = { provider: "openai-compatible", modelId: "my-model" };
    const { chat } = resolved(catalog.resolveModels(config));
    expect(chat.provider).toBe("openai-compatible");
    expect(chat.id).toBe("my-model");
  });
});

describe("ModelCatalog.registerProvider", () => {
  it("registers an ollama provider with the OpenAI-completions wire protocol", async () => {
    const { registry, registered } = makeModelRegistry([], []);
    const auth = makeAuthStorage();
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, auth) });

    const config: LlmConfig = { provider: "ollama", modelId: "llama3", baseUrl: "http://localhost:11434/v1" };
    await catalog.registerProvider(config);

    expect(registered).toHaveLength(1);
    const [call] = registered;
    expect(call.providerName).toBe("ollama");
    expect(call.config.name).toBe("Ollama");
    expect(call.config.baseUrl).toBe("http://localhost:11434/v1");
    expect(call.config.api).toBe("openai-completions");
    expect(call.config.apiKey).toBe("ollama"); // placeholder for ollama without apiKey
    expect(call.config.models?.[0]?.id).toBe("llama3");
    expect(call.config.models).toHaveLength(1);
    // Ollama does not need a runtime API key.
    expect(auth.setCalls).toHaveLength(0);
  });

  it("registers the chat and a separate ingest model in ONE call (a second call would replace the first)", async () => {
    const { registry, registered } = makeModelRegistry([], []);
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, makeAuthStorage()) });

    const config: LlmConfig = {
      provider: "ollama",
      modelId: "llama3",
      ingestModelId: "qwen3:32b",
      baseUrl: "http://localhost:11434/v1",
    };
    await catalog.registerProvider(config);

    expect(registered).toHaveLength(1);
    expect(registered[0]!.config.models?.map((model) => model.id)).toEqual(["llama3", "qwen3:32b"]);
  });

  it("registers a model only once when the ingest model equals the chat model", async () => {
    const { registry, registered } = makeModelRegistry([], []);
    const catalog = new ModelCatalog({
      modelRuntime: makeModelRuntime(registry, makeAuthStorage()),
      fetch: makeFetch([{ url: "http://my-endpoint/v1/models", ids: ["my-model"] }]),
    });

    const config: LlmConfig = {
      provider: "openai-compatible",
      modelId: "my-model",
      ingestModelId: "my-model",
      baseUrl: "http://my-endpoint/v1",
    };
    await catalog.registerProvider(config);

    expect(registered[0]!.config.models?.map((model) => model.id)).toEqual(["my-model"]);
  });

  it("registers Requesty vision metadata as image input per model", async () => {
    const { registry, registered } = makeModelRegistry([], []);
    const auth = makeAuthStorage();
    const fetch: typeof globalThis.fetch = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toBe("https://router.requesty.ai/v1/models");
      expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBe("Bearer key-1");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          data: [
            { id: "anthropic/claude-opus-4-5", supports_vision: true },
            { id: "text-only-model", supports_vision: false },
          ],
        }),
      } as Response;
    };
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, auth), fetch });

    await catalog.registerProvider({
      provider: "openai-compatible",
      modelId: "anthropic/claude-opus-4-5",
      ingestModelId: "text-only-model",
      baseUrl: "https://router.requesty.ai/v1",
      apiKey: "key-1",
    });

    const registeredModels = registered[0]?.config.models ?? [];
    expect(registeredModels.map((model) => [model.id, model.input])).toEqual([
      ["anthropic/claude-opus-4-5", ["text", "image"]],
      ["text-only-model", ["text"]],
    ]);
  });

  it("continues with text-only metadata when an endpoint does not expose vision fields", async () => {
    const { registry, registered } = makeModelRegistry([], []);
    const catalog = new ModelCatalog({
      modelRuntime: makeModelRuntime(registry, makeAuthStorage()),
      fetch: makeFetch([{ url: "https://example.test/v1/models", ids: ["my-model"] }]),
    });

    await catalog.registerProvider({
      provider: "openai-compatible",
      modelId: "my-model",
      baseUrl: "https://example.test/v1",
    });

    expect(registered[0]?.config.models?.[0]?.input).toEqual(["text"]);
  });

  it("registers an openai-compatible provider without persisting its key in provider config", async () => {
    const { registry, registered } = makeModelRegistry([], []);
    const auth = makeAuthStorage();
    const catalog = new ModelCatalog({
      modelRuntime: makeModelRuntime(registry, auth),
      fetch: makeFetch([{ url: "http://my-endpoint/v1/models", ids: ["my-model"] }]),
    });

    const config: LlmConfig = {
      provider: "openai-compatible",
      modelId: "my-model",
      baseUrl: "http://my-endpoint/v1",
      apiKey: "key-1",
    };
    await catalog.registerProvider(config);

    expect(registered).toHaveLength(1);
    const [call] = registered;
    expect(call.providerName).toBe("openai-compatible");
    expect(call.config.name).toBe("OpenAI-compatible");
    expect(call.config.baseUrl).toBe("http://my-endpoint/v1");
    expect(call.config.apiKey).toBe("not-needed");
    expect(call.config.models?.[0]?.id).toBe("my-model");
    expect(auth.setCalls).toEqual([{ provider: "openai-compatible", credential: { type: "api_key", key: "key-1" } }]);
  });

  it("clears a stale OpenAI-compatible key when configuring a new endpoint without one", async () => {
    const { registry } = makeModelRegistry([], []);
    const runtimeCredentials = makeAuthStorage();
    const catalog = new ModelCatalog({
      modelRuntime: makeModelRuntime(registry, runtimeCredentials),
      fetch: makeFetch([
        { url: "https://old.example/v1/models", ids: ["old-model"] },
        { url: "https://new.example/v1/models", ids: ["new-model"] },
      ]),
    });

    await catalog.registerProvider({
      provider: "openai-compatible",
      modelId: "old-model",
      baseUrl: "https://old.example/v1",
      apiKey: "old-secret",
    });
    expect(apiKey(runtimeCredentials.store.get("openai-compatible"))).toBe("old-secret");

    await catalog.registerProvider({
      provider: "openai-compatible",
      modelId: "new-model",
      baseUrl: "https://new.example/v1",
    });

    expect(runtimeCredentials.store.has("openai-compatible")).toBe(false);
    expect(runtimeCredentials.keysAtProviderRegistration).toEqual([undefined, undefined]);
  });

  it("sets the runtime API key for anthropic (and openai/google)", async () => {
    const { registry, registered } = makeModelRegistry([], []);
    const auth = makeAuthStorage();
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, auth) });

    const config: LlmConfig = { provider: "anthropic", modelId: "claude-3", apiKey: "sk-ant" };
    await catalog.registerProvider(config);

    // Built-in providers are not re-registered; keys are runtime credentials.
    expect(registered).toHaveLength(0);
    expect(auth.setCalls).toEqual([{ provider: "anthropic", credential: { type: "api_key", key: "sk-ant" } }]);
  });

  it("is a no-op for github-copilot", async () => {
    const { registry, registered } = makeModelRegistry([], []);
    const auth = makeAuthStorage();
    const catalog = new ModelCatalog({ modelRuntime: makeModelRuntime(registry, auth) });

    const config: LlmConfig = { provider: "github-copilot", modelId: "gpt-4" };
    await catalog.registerProvider(config);

    expect(registered).toHaveLength(0);
    expect(auth.setCalls).toHaveLength(0);
  });
});