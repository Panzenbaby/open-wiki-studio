// App config persisted in Electron userData: recent workspaces + last opened.
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
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
        recentWorkspaces: config.recentWorkspaces.filter(
          (w) => w.path !== folderPath,
        ),
        lastWorkspace:
          config.lastWorkspace === folderPath
            ? undefined
            : config.lastWorkspace,
        llm: config.llm,
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