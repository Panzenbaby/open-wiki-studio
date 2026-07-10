// App config persisted in Electron userData: recent workspaces + last opened.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";
import { ok, err, errorMessage } from "../shared/result.ts";
import { mainT } from "./i18n.ts";
import type { LlmConfig, Result, WorkspaceInfo } from "../shared/ipc-types.ts";

const MAX_RECENT = 12;

interface ConfigShape {
  readonly recentWorkspaces: readonly WorkspaceInfo[];
  readonly lastWorkspace?: string;
  readonly llm?: LlmConfig;
}

function configPath(): string {
  return join(app.getPath("userData"), "config.json");
}

// Serialize config reads+writes. Without this, two concurrent
// `setLlmConfig` / `rememberWorkspace` calls interleave their
// read-modify-write cycles and the last writer wins, silently dropping one
// update. A simple promise chain is enough — config access is low-frequency.
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
  return ok(config.recentWorkspaces);
}

export async function getLastWorkspace(): Promise<string | undefined> {
  return (await readConfig()).lastWorkspace;
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
        recentWorkspaces: [info, ...deduped].slice(0, MAX_RECENT),
        lastWorkspace: folderPath,
        llm: config.llm,
      };
      await writeConfig(next);
      return ok(info);
    } catch (error) {
      return err<WorkspaceInfo>(mainT("error.rememberWorkspace", { detail: errorMessage(error) }));
    }
  });
}

export async function getLlmConfig(): Promise<LlmConfig | undefined> {
  return (await readConfig()).llm;
}

export async function setLlmConfig(config: LlmConfig): Promise<Result<void>> {
  return withConfigLock(async () => {
    try {
      const current = await readConfig();
      await writeConfig({ ...current, llm: config });
      return ok(undefined);
    } catch (error) {
      return err<void>(mainT("error.saveLlmConfig", { detail: errorMessage(error) }));
    }
  });
}