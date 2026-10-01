// Tests for the API-key-at-rest handling in src/main/config.ts. The seams
// that make this testable without Electron: `safeStorage` is mocked (a
// reversible fake cipher + a togglable `isEncryptionAvailable`), and the
// unavailable-keychain fallback is an injected decider rather than a dialog
// call buried in the save path.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LlmConfig } from "../src/shared/ipc-types.ts";

const electronState = vi.hoisted(() => ({
  userDataDir: "/tmp",
  encryptionAvailable: true,
}));

const CIPHER_PREFIX = "cipher:";

vi.mock("electron", () => {
  const electron = {
    app: {
      getLocale: () => "en",
      getPath: () => electronState.userDataDir,
    },
    safeStorage: {
      isEncryptionAvailable: () => electronState.encryptionAvailable,
      encryptString: (plain: string) => Buffer.from(`${CIPHER_PREFIX}${plain}`, "utf8"),
      decryptString: (buffer: Buffer) => {
        const text = buffer.toString("utf8");
        if (!text.startsWith(CIPHER_PREFIX)) throw new Error("not our ciphertext");
        return text.slice(CIPHER_PREFIX.length);
      },
    },
  };
  return { default: electron, ...electron };
});

type ConfigModule = typeof import("../src/main/config.ts");

/** Fresh module instance per test so the session-only key does not leak. */
async function loadConfigModule(): Promise<ConfigModule> {
  vi.resetModules();
  return import("../src/main/config.ts");
}

function configPath(): string {
  return join(electronState.userDataDir, "config.json");
}

async function readRawConfig(): Promise<string> {
  return readFile(configPath(), "utf8");
}

/** The on-disk config shape the assertions inspect. Typed so the tests read
 *  the persisted file without `any` flowing out of `JSON.parse`. */
interface RawConfigFile {
  readonly llm?: {
    readonly provider?: string;
    readonly modelId?: string;
    readonly ingestModelId?: string;
    readonly baseUrl?: string;
    readonly apiKey?: string;
    readonly apiKeyEncrypted?: string;
  };
  readonly lastWorkspace?: string;
  readonly recentWorkspaces?: readonly string[];
}

function parseRawConfig(raw: string): RawConfigFile {
  return JSON.parse(raw) as RawConfigFile;
}

const SECRET = "sk-super-secret-value";

const baseConfig: LlmConfig = {
  provider: "anthropic",
  modelId: "claude-opus-4-7",
  apiKey: SECRET,
};

async function neverAsked(): Promise<never> {
  throw new Error("the fallback decider must not be called");
}

describe("LLM API key at rest", () => {
  beforeEach(async () => {
    electronState.userDataDir = await mkdtemp(join(tmpdir(), "okf-config-"));
    electronState.encryptionAvailable = true;
  });

  afterEach(async () => {
    await rm(electronState.userDataDir, { recursive: true, force: true });
  });

  it("encrypts the key on write and decrypts it on read", async () => {
    const config = await loadConfigModule();

    const saved = await config.setLlmConfig(baseConfig, neverAsked);
    expect(saved.success).toBe(true);

    const raw = await readRawConfig();
    expect(raw).not.toContain(SECRET);
    expect(parseRawConfig(raw).llm?.apiKeyEncrypted).toBeTruthy();
    expect(parseRawConfig(raw).llm?.apiKey).toBeUndefined();

    const loaded = await config.getLlmConfig();
    expect(loaded?.apiKey).toBe(SECRET);
    expect(loaded?.modelId).toBe("claude-opus-4-7");
  });

  it("keeps unrelated config sections intact", async () => {
    const config = await loadConfigModule();
    await config.rememberWorkspace("/tmp/some-workspace");
    await config.setLlmConfig(baseConfig, neverAsked);

    const parsed = parseRawConfig(await readRawConfig());
    expect(parsed.lastWorkspace).toBe("/tmp/some-workspace");
    expect(parsed.recentWorkspaces).toHaveLength(1);
  });

  it("migrates an existing plaintext config in place on first read", async () => {
    await writeFile(
      configPath(),
      JSON.stringify({
        recentWorkspaces: [],
        lastWorkspace: "/tmp/ws",
        llm: { provider: "openai", modelId: "gpt-5", apiKey: SECRET },
      }),
      "utf8",
    );
    const config = await loadConfigModule();

    const loaded = await config.getLlmConfig();
    expect(loaded?.apiKey).toBe(SECRET);

    const raw = await readRawConfig();
    expect(raw).not.toContain(SECRET);
    const parsed = parseRawConfig(raw);
    expect(parsed.llm?.apiKey).toBeUndefined();
    expect(parsed.llm?.apiKeyEncrypted).toBeTruthy();
    expect(parsed.lastWorkspace).toBe("/tmp/ws");

    // Second read goes through the ciphertext path and still returns the key.
    expect((await config.getLlmConfig())?.apiKey).toBe(SECRET);
  });

  it("reports no key when the ciphertext cannot be decrypted", async () => {
    await writeFile(
      configPath(),
      JSON.stringify({
        recentWorkspaces: [],
        llm: {
          provider: "openai",
          modelId: "gpt-5",
          apiKeyEncrypted: Buffer.from("from-another-machine", "utf8").toString("base64"),
        },
      }),
      "utf8",
    );
    const config = await loadConfigModule();

    const loaded = await config.getLlmConfig();
    expect(loaded?.provider).toBe("openai");
    expect(loaded?.apiKey).toBeUndefined();
  });

  describe("when encryption is unavailable", () => {
    beforeEach(() => {
      electronState.encryptionAvailable = false;
    });

    it("persists the key in plaintext when the user chooses that", async () => {
      const config = await loadConfigModule();
      const decider = vi.fn(async () => "store-plaintext" as const);

      const saved = await config.setLlmConfig(baseConfig, decider);
      expect(saved.success).toBe(true);
      expect(decider).toHaveBeenCalledOnce();

      const parsed = parseRawConfig(await readRawConfig());
      expect(parsed.llm?.apiKey).toBe(SECRET);
      expect(parsed.llm?.apiKeyEncrypted).toBeUndefined();
      expect((await config.getLlmConfig())?.apiKey).toBe(SECRET);
    });

    it("keeps the key in memory only when the user declines to persist it", async () => {
      const config = await loadConfigModule();
      const decider = vi.fn(async () => "session-only" as const);

      const saved = await config.setLlmConfig(baseConfig, decider);
      expect(saved.success).toBe(true);
      expect(decider).toHaveBeenCalledOnce();

      const raw = await readRawConfig();
      expect(raw).not.toContain(SECRET);
      const parsed = parseRawConfig(raw);
      expect(parsed.llm?.apiKey).toBeUndefined();
      expect(parsed.llm?.apiKeyEncrypted).toBeUndefined();

      // Served from memory for the rest of the run.
      expect((await config.getLlmConfig())?.apiKey).toBe(SECRET);

      // A restart loses it — a fresh module instance has no session key.
      const restarted = await loadConfigModule();
      expect((await restarted.getLlmConfig())?.apiKey).toBeUndefined();
    });

    it("does not ask when the config carries no key at all", async () => {
      const config = await loadConfigModule();
      const saved = await config.setLlmConfig(
        { provider: "ollama", modelId: "llama3", baseUrl: "http://localhost:11434/v1" },
        neverAsked,
      );
      expect(saved.success).toBe(true);
      expect((await config.getLlmConfig())?.apiKey).toBeUndefined();
    });

    it("leaves a legacy plaintext key readable instead of dropping it", async () => {
      await writeFile(
        configPath(),
        JSON.stringify({
          recentWorkspaces: [],
          llm: { provider: "openai", modelId: "gpt-5", apiKey: SECRET },
        }),
        "utf8",
      );
      const config = await loadConfigModule();

      expect((await config.getLlmConfig())?.apiKey).toBe(SECRET);
      expect(parseRawConfig(await readRawConfig()).llm?.apiKey).toBe(SECRET);
    });
  });
});

describe("removeLlmApiKey", () => {
  beforeEach(async () => {
    electronState.userDataDir = await mkdtemp(join(tmpdir(), "okf-config-"));
    electronState.encryptionAvailable = true;
  });

  afterEach(async () => {
    await rm(electronState.userDataDir, { recursive: true, force: true });
  });

  it("clears an encrypted key but keeps the rest of the config", async () => {
    const config = await loadConfigModule();
    await config.setLlmConfig({ ...baseConfig, baseUrl: "https://trusted.example/v1" }, neverAsked);

    const removed = await config.removeLlmApiKey();
    expect(removed.success).toBe(true);

    const parsed = parseRawConfig(await readRawConfig());
    expect(parsed.llm?.apiKeyEncrypted).toBeUndefined();
    expect(parsed.llm?.apiKey).toBeUndefined();
    expect(parsed.llm?.provider).toBe("anthropic");
    expect(parsed.llm?.modelId).toBe("claude-opus-4-7");
    expect(parsed.llm?.baseUrl).toBe("https://trusted.example/v1");

    const loaded = await config.getLlmConfig();
    expect(loaded?.apiKey).toBeUndefined();
  });

  it("clears a session-only key so it is no longer served from memory", async () => {
    electronState.encryptionAvailable = false;
    const config = await loadConfigModule();
    await config.setLlmConfig(baseConfig, async () => "session-only");
    expect((await config.getLlmConfig())?.apiKey).toBe(SECRET);

    const removed = await config.removeLlmApiKey();
    expect(removed.success).toBe(true);
    expect((await config.getLlmConfig())?.apiKey).toBeUndefined();
  });

  it("clears a plaintext key that was persisted on the user's request", async () => {
    electronState.encryptionAvailable = false;
    const config = await loadConfigModule();
    await config.setLlmConfig(baseConfig, async () => "store-plaintext");
    expect(await readRawConfig()).toContain(SECRET);

    await config.removeLlmApiKey();
    expect(await readRawConfig()).not.toContain(SECRET);
  });

  it("leaves the view reporting no key, and the key no longer reusable", async () => {
    const config = await loadConfigModule();
    await config.setLlmConfig(baseConfig, neverAsked);
    await config.removeLlmApiKey();

    const loaded = await config.getLlmConfig();
    expect(loaded).toBeDefined();
    expect(config.toLlmConfigView(loaded!).hasApiKey).toBe(false);
    expect(config.resolveStoredApiKey(loaded, { provider: "anthropic" })).toBeUndefined();
  });

  it("is a no-op when nothing is configured", async () => {
    const config = await loadConfigModule();
    const removed = await config.removeLlmApiKey();
    expect(removed.success).toBe(true);
    expect(await config.getLlmConfig()).toBeUndefined();
  });
});

describe("resolveStoredApiKey", () => {
  const storedCustomEndpoint: LlmConfig = {
    provider: "openai-compatible",
    modelId: "local-model",
    apiKey: SECRET,
    baseUrl: "https://trusted.example/v1",
  };

  it("reuses the key when the request carries no base URL", async () => {
    const config = await loadConfigModule();
    expect(config.resolveStoredApiKey(baseConfig, { provider: "anthropic" })).toBe(SECRET);
    expect(
      config.resolveStoredApiKey(storedCustomEndpoint, { provider: "openai-compatible" }),
    ).toBe(SECRET);
  });

  it("reuses the key when the request targets the stored base URL", async () => {
    const config = await loadConfigModule();
    expect(
      config.resolveStoredApiKey(storedCustomEndpoint, {
        provider: "openai-compatible",
        baseUrl: "https://trusted.example/v1/",
      }),
    ).toBe(SECRET);
  });

  it("withholds the key when the request redirects it to another host", async () => {
    const config = await loadConfigModule();
    expect(
      config.resolveStoredApiKey(storedCustomEndpoint, {
        provider: "openai-compatible",
        baseUrl: "https://attacker.example/v1",
      }),
    ).toBeUndefined();
    // A provider that stores no base URL must not accept an injected one
    // either — that would ship an Anthropic key to an arbitrary endpoint.
    expect(
      config.resolveStoredApiKey(baseConfig, {
        provider: "anthropic",
        baseUrl: "https://attacker.example/v1",
      }),
    ).toBeUndefined();
  });

  it("withholds the key for a different provider or an empty store", async () => {
    const config = await loadConfigModule();
    expect(config.resolveStoredApiKey(baseConfig, { provider: "openai" })).toBeUndefined();
    expect(config.resolveStoredApiKey(undefined, { provider: "anthropic" })).toBeUndefined();
  });
});

describe("separate ingest model", () => {
  beforeEach(async () => {
    electronState.userDataDir = await mkdtemp(join(tmpdir(), "okf-config-"));
    electronState.encryptionAvailable = true;
  });

  afterEach(async () => {
    await rm(electronState.userDataDir, { recursive: true, force: true });
  });

  const withIngestModel: LlmConfig = { ...baseConfig, ingestModelId: "claude-opus-4-7-strong" };

  it("persists the ingest model next to the chat model", async () => {
    const config = await loadConfigModule();
    await config.setLlmConfig(withIngestModel, neverAsked);

    const parsed = parseRawConfig(await readRawConfig());
    expect(parsed.llm?.modelId).toBe("claude-opus-4-7");
    expect(parsed.llm?.ingestModelId).toBe("claude-opus-4-7-strong");

    const loaded = await config.getLlmConfig();
    expect(loaded?.modelId).toBe("claude-opus-4-7");
    expect(loaded?.ingestModelId).toBe("claude-opus-4-7-strong");
  });

  it("writes no ingest model while the ingest follows the chat model", async () => {
    const config = await loadConfigModule();
    await config.setLlmConfig(withIngestModel, neverAsked);
    await config.setLlmConfig(baseConfig, neverAsked);

    expect(parseRawConfig(await readRawConfig()).llm).not.toHaveProperty("ingestModelId");
    expect((await config.getLlmConfig())?.ingestModelId).toBeUndefined();
  });

  it("reads a config saved before separate ingest models as one model for both", async () => {
    await writeFile(
      configPath(),
      JSON.stringify({
        recentWorkspaces: [],
        llm: { provider: "ollama", modelId: "llama3", baseUrl: "http://localhost:11434/v1" },
      }),
      "utf8",
    );
    const config = await loadConfigModule();

    const loaded = await config.getLlmConfig();
    expect(loaded?.modelId).toBe("llama3");
    expect(loaded?.ingestModelId).toBeUndefined();
  });

  it("ignores a malformed stored ingest model", async () => {
    await writeFile(
      configPath(),
      JSON.stringify({
        recentWorkspaces: [],
        llm: { provider: "ollama", modelId: "llama3", ingestModelId: 42 },
      }),
      "utf8",
    );
    const config = await loadConfigModule();

    expect((await config.getLlmConfig())?.ingestModelId).toBeUndefined();
  });

  it("keeps the ingest model when a legacy plaintext key is migrated", async () => {
    await writeFile(
      configPath(),
      JSON.stringify({
        recentWorkspaces: [],
        llm: { provider: "openai", modelId: "gpt-5-mini", ingestModelId: "gpt-5", apiKey: SECRET },
      }),
      "utf8",
    );
    const config = await loadConfigModule();

    expect((await config.getLlmConfig())?.ingestModelId).toBe("gpt-5");
    const parsed = parseRawConfig(await readRawConfig());
    expect(parsed.llm?.apiKeyEncrypted).toBeTruthy();
    expect(parsed.llm?.ingestModelId).toBe("gpt-5");
  });

  it("keeps the ingest model when the stored key is removed", async () => {
    const config = await loadConfigModule();
    await config.setLlmConfig(withIngestModel, neverAsked);

    await config.removeLlmApiKey();

    const parsed = parseRawConfig(await readRawConfig());
    expect(parsed.llm?.apiKeyEncrypted).toBeUndefined();
    expect(parsed.llm?.ingestModelId).toBe("claude-opus-4-7-strong");
  });

  it("exposes the ingest model in the renderer view", async () => {
    const config = await loadConfigModule();
    expect(config.toLlmConfigView(withIngestModel).ingestModelId).toBe("claude-opus-4-7-strong");
    expect(config.toLlmConfigView(baseConfig).ingestModelId).toBeUndefined();
  });
});

describe("toLlmConfigView", () => {
  it("strips the API key and reports only its presence", async () => {
    const config = await loadConfigModule();

    const withKey = config.toLlmConfigView(baseConfig);
    expect(withKey.hasApiKey).toBe(true);
    expect(JSON.stringify(withKey)).not.toContain(SECRET);

    const withoutKey = config.toLlmConfigView({ provider: "ollama", modelId: "llama3" });
    expect(withoutKey.hasApiKey).toBe(false);
  });
});
