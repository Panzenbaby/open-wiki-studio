// App config persisted in Electron userData: recent workspaces + last opened.
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, safeStorage } from "electron";
import { ok, err, errorMessage } from "../shared/result.ts";
import { normalizeAppearance } from "../shared/appearance.ts";
import { mainT } from "./i18n.ts";
import type {
  AppearanceSettings,
  LlmConfig,
  LlmConfigView,
  ProviderId,
  Result,
  WorkspaceInfo,
} from "../shared/ipc-types.ts";

const MAX_RECENT = 12;

/** What the user chose when the OS keychain was unavailable at save time. */
export type UnencryptedKeyChoice = "store-plaintext" | "session-only";

/** Asks the user how to handle an API key that cannot be encrypted. Injected
 *  so the save path stays testable without an Electron dialog. */
export type UnencryptedKeyDecider = () => Promise<UnencryptedKeyChoice>;

/** On-disk shape of the LLM section. `apiKey` and `apiKeyEncrypted` are
 *  separate fields so plaintext and ciphertext are distinguishable without
 *  guessing from the value itself. */
interface StoredLlmConfig {
  readonly provider: ProviderId;
  readonly modelId: string;
  readonly baseUrl?: string;
  /** Legacy plaintext key; migrated to `apiKeyEncrypted` on first read. */
  readonly apiKey?: string;
  /** Base64 of `safeStorage.encryptString(apiKey)`. */
  readonly apiKeyEncrypted?: string;
}

interface ConfigShape {
  readonly recentWorkspaces: readonly WorkspaceInfo[];
  readonly lastWorkspace?: string;
  readonly llm?: StoredLlmConfig;
  readonly appearance?: AppearanceSettings;
}

// Key the user chose not to persist. Lives for this process run only and is
// never written to config.json.
let sessionApiKey: string | undefined;

function configPath(): string {
  return join(app.getPath("userData"), "config.json");
}

// Serialize config reads+writes. Without this, two concurrent
// `setLlmConfig` / `rememberWorkspace` calls interleave their read-modify-
// write cycles and the last writer wins, silently dropping one update.
let configChain: Promise<unknown> = Promise.resolve();
function withConfigLock<T>(work: () => Promise<T>): Promise<T> {
  const run = configChain.then(work, work);
  // Swallow rejections on the chain itself so a failed write doesn't poison
  // every subsequent call; the caller still sees its own rejection.
  configChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readConfig(): Promise<ConfigShape> {
  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<ConfigShape>;
    return {
      recentWorkspaces: Array.isArray(parsed.recentWorkspaces)
        ? parsed.recentWorkspaces
        : [],
      lastWorkspace: parsed.lastWorkspace,
      llm: parsed.llm,
      appearance:
        parsed.appearance === undefined ? undefined : normalizeAppearance(parsed.appearance),
    };
  } catch {
    return { recentWorkspaces: [] };
  }
}

async function writeConfig(config: ConfigShape): Promise<void> {
  await mkdir(dirname(configPath()), { recursive: true });
  await writeFile(configPath(), JSON.stringify(config, null, 2), "utf8");
}

function toInfo(folderPath: string): WorkspaceInfo {
  const segments = folderPath.replace(/\\/g, "/").split("/").filter(Boolean);
  return {
    path: folderPath,
    name: segments[segments.length - 1] ?? folderPath,
    lastOpened: new Date().toISOString(),
  };
}

export async function listRecentWorkspaces(): Promise<Result<readonly WorkspaceInfo[]>> {
  const config = await readConfig();
  // Annotate each entry with whether the linked folder still exists on disk
  // so the picker can show a hint next to stale entries. Computed at list
  // time (the picker refreshes this on startup) — never persisted.
  const annotated = await Promise.all(
    config.recentWorkspaces.map(async (w): Promise<WorkspaceInfo> => {
      try {
        const info = await stat(w.path);
        return { ...w, missing: !info.isDirectory() };
      } catch {
        return { ...w, missing: true };
      }
    }),
  );
  return ok(annotated);
}

/** Remove a workspace from the recent list without touching its folder on
 *  disk. Clears `lastWorkspace` when it matches, so the app does not try to
 *  re-activate a forgotten path on the next launch. */
export async function forgetWorkspace(
  folderPath: string,
): Promise<Result<void>> {
  return withConfigLock(async () => {
    try {
      const config = await readConfig();
      const next: ConfigShape = {
        ...config,
        recentWorkspaces: config.recentWorkspaces.filter(
          (w) => w.path !== folderPath,
        ),
        lastWorkspace:
          config.lastWorkspace === folderPath
            ? undefined
            : config.lastWorkspace,
      };
      await writeConfig(next);
      return ok(undefined);
    } catch (error) {
      return err<void>(mainT("error.forgetWorkspace", { detail: errorMessage(error) }));
    }
  });
}

export async function rememberWorkspace(
  folderPath: string,
): Promise<Result<WorkspaceInfo>> {
  return withConfigLock(async () => {
    try {
      const config = await readConfig();
      const info = toInfo(folderPath);
      const deduped = config.recentWorkspaces.filter((w) => w.path !== folderPath);
      const next: ConfigShape = {
        ...config,
        recentWorkspaces: [info, ...deduped].slice(0, MAX_RECENT),
        lastWorkspace: folderPath,
      };
      await writeConfig(next);
      return ok(info);
    } catch (error) {
      return err<WorkspaceInfo>(mainT("error.rememberWorkspace", { detail: errorMessage(error) }));
    }
  });
}

export async function getAppearance(): Promise<AppearanceSettings> {
  const config = await readConfig();
  return normalizeAppearance(config.appearance);
}

export async function setAppearance(
  appearance: AppearanceSettings,
): Promise<Result<void>> {
  return withConfigLock(async () => {
    try {
      const current = await readConfig();
      await writeConfig({ ...current, appearance });
      return ok(undefined);
    } catch (error) {
      return err<void>(mainT("error.saveAppearance", { detail: errorMessage(error) }));
    }
  });
}

function decryptApiKey(encrypted: string): string | undefined {
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  } catch {
    // Ciphertext from another machine/keychain entry — unrecoverable. Report
    // "no key" so the user is prompted to enter it again.
    return undefined;
  }
}

function toLlmConfig(stored: StoredLlmConfig, apiKey: string | undefined): LlmConfig {
  return {
    provider: stored.provider,
    modelId: stored.modelId,
    baseUrl: stored.baseUrl,
    apiKey,
  };
}

function normalizeBaseUrl(baseUrl: string | undefined): string | undefined {
  const trimmed = baseUrl?.trim().replace(/\/+$/, "");
  return trimmed ? trimmed : undefined;
}

/** A request from the renderer that may reuse the stored key instead of
 *  carrying one. */
export interface ApiKeyRequest {
  readonly provider: ProviderId;
  readonly baseUrl?: string;
}

/**
 * The stored API key, but only when the request targets the stored
 * configuration. The renderer can no longer see the key, so it must not be
 * able to aim it somewhere else either: a `baseUrl` that differs from the
 * stored one would send the credential to a host the user never configured.
 * Such a request gets no key — the same position as configuring a new
 * endpoint from scratch.
 */
export function resolveStoredApiKey(
  stored: LlmConfig | undefined,
  request: ApiKeyRequest,
): string | undefined {
  if (!stored || stored.provider !== request.provider) return undefined;
  const requested = normalizeBaseUrl(request.baseUrl);
  if (requested !== undefined && requested !== normalizeBaseUrl(stored.baseUrl)) {
    return undefined;
  }
  return stored.apiKey;
}

/** Strip the API key for the renderer: only its presence crosses IPC. */
export function toLlmConfigView(config: LlmConfig): LlmConfigView {
  return {
    provider: config.provider,
    modelId: config.modelId,
    baseUrl: config.baseUrl,
    hasApiKey: !!config.apiKey,
  };
}

export async function getLlmConfig(): Promise<LlmConfig | undefined> {
  return withConfigLock(async () => {
    const current = await readConfig();
    const stored = current.llm;
    if (!stored) return undefined;

    // Migrate a legacy plaintext key in place. Inside the lock so a concurrent
    // writer cannot lose the rewrite.
    if (stored.apiKey !== undefined && safeStorage.isEncryptionAvailable()) {
      const migrated: StoredLlmConfig = {
        provider: stored.provider,
        modelId: stored.modelId,
        baseUrl: stored.baseUrl,
        apiKeyEncrypted: safeStorage.encryptString(stored.apiKey).toString("base64"),
      };
      await writeConfig({ ...current, llm: migrated });
      return toLlmConfig(migrated, stored.apiKey);
    }

    if (stored.apiKeyEncrypted !== undefined) {
      return toLlmConfig(stored, decryptApiKey(stored.apiKeyEncrypted));
    }
    return toLlmConfig(stored, stored.apiKey ?? sessionApiKey);
  });
}

async function toStoredLlmConfig(
  config: LlmConfig,
  decideUnencrypted: UnencryptedKeyDecider,
): Promise<StoredLlmConfig> {
  const base: StoredLlmConfig = {
    provider: config.provider,
    modelId: config.modelId,
    baseUrl: config.baseUrl,
  };
  if (!config.apiKey) {
    sessionApiKey = undefined;
    return base;
  }
  if (safeStorage.isEncryptionAvailable()) {
    sessionApiKey = undefined;
    return { ...base, apiKeyEncrypted: safeStorage.encryptString(config.apiKey).toString("base64") };
  }
  const choice = await decideUnencrypted();
  if (choice === "store-plaintext") {
    sessionApiKey = undefined;
    return { ...base, apiKey: config.apiKey };
  }
  sessionApiKey = config.apiKey;
  return base;
}

/** Revoke the stored API key: drops it from disk and from the session,
 *  keeping the rest of the LLM config (provider, model, base URL). */
export async function removeLlmApiKey(): Promise<Result<void>> {
  return withConfigLock(async () => {
    try {
      sessionApiKey = undefined;
      const current = await readConfig();
      const stored = current.llm;
      if (!stored) return ok(undefined);
      const llm: StoredLlmConfig = {
        provider: stored.provider,
        modelId: stored.modelId,
        baseUrl: stored.baseUrl,
      };
      await writeConfig({ ...current, llm });
      return ok(undefined);
    } catch (error) {
      return err<void>(mainT("error.removeApiKey", { detail: errorMessage(error) }));
    }
  });
}

export async function setLlmConfig(
  config: LlmConfig,
  decideUnencrypted: UnencryptedKeyDecider,
): Promise<Result<void>> {
  return withConfigLock(async () => {
    try {
      const current = await readConfig();
      const llm = await toStoredLlmConfig(config, decideUnencrypted);
      await writeConfig({ ...current, llm });
      return ok(undefined);
    } catch (error) {
      return err<void>(mainT("error.saveLlmConfig", { detail: errorMessage(error) }));
    }
  });
}