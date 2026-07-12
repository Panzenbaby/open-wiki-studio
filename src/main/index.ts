// Electron main entry: window lifecycle, workspace selection dialog,
// activation of the AgentRepository + IpcBridge for the chosen workspace.
import "./polyfill.ts"; // must run before pi-coding-agent loads (undici worker_threads polyfill)
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentRepository } from "./agent.ts";
import { IpcBridge } from "./ipc.ts";
import {
  getLlmConfig,
  listRecentWorkspaces,
  rememberWorkspace,
} from "./config.ts";
import { createUpdateRepository, type UpdateRepository } from "./update-repository.ts";
import { ok, err, errorMessage } from "../shared/result.ts";
import { mainT } from "./i18n.ts";
import type { ProviderId, Result, UpdateEvent, WorkspaceInfo } from "../shared/ipc-types.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function getAppIconPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "icons", "icon.png");
  }
  const iconPath = join(dirname(__dirname), "..", "build", "icon.png");
  log("icon path:", iconPath);
  return iconPath;
}

function log(...parts: unknown[]): void {
  console.log("[open-wiki-studio]", ...parts);
}

interface AppState {
  window: BrowserWindow | null;
  repo: AgentRepository | null;
  bridge: IpcBridge | null;
  workspace: string | null;
  updater: UpdateRepository | null;
  /** Most recent `UpdateEvent` emitted by the updater. Cached so the renderer
   *  can replay it on mount via `okf:getUpdateStatus` — the silent start-check
   *  in `whenReady` may fire `update-available` before the renderer has
   *  subscribed to `okf:update-event`, in which case that message is dropped
   *  (Electron discards messages sent before an `ipcRenderer.on` listener is
   *  registered). The replay closes that startup race. */
  lastUpdateEvent: UpdateEvent | null;
}

const state: AppState = { window: null, repo: null, bridge: null, workspace: null, updater: null, lastUpdateEvent: null };

// Surface any startup failure instead of dying silently.
function fatal(message: string, error?: unknown): void {
  const detail = error ? errorMessage(error) : "";
  log("FATAL", message, detail);
  try {
    dialog.showErrorBox(mainT("dialog.startupError"), `${message}\n${detail}`);
  } catch {
    /* dialog may not be available pre-ready */
  }
  app.quit();
}

async function activateWorkspace(folderPath: string): Promise<Result<WorkspaceInfo>> {
  try {
    if (state.repo) await state.repo.dispose();
    state.repo = null;
    state.bridge = null;
    state.workspace = null;

    const created = await AgentRepository.create(folderPath);
    if (!created.success) return created;

    const llm = await getLlmConfig();
    if (llm) {
      const applied = await created.data.configureLlm(llm);
      if (!applied.success && state.window) {
        state.window.webContents.send("okf:warning", applied.error.message);
      }
    }

    state.repo = created.data;
    state.workspace = folderPath;
    if (state.window) {
      state.bridge = new IpcBridge(state.window.webContents, state.repo, folderPath);
      state.bridge.register();
    }
    return await rememberWorkspace(folderPath);
  } catch (error) {
    return err<WorkspaceInfo>(mainT("error.activateWorkspace", { detail: errorMessage(error) }));
  }
}

function registerGlobalHandlers(): void {
  ipcMain.handle("okf:listRecentWorkspaces", async () => listRecentWorkspaces());

  ipcMain.handle("okf:getLlmConfig", async () => ok(await getLlmConfig()));

// App self-info is workspace-independent. Registered globally so the renderer
  // can call it at bootstrap, before any workspace is active.
  ipcMain.handle("okf:getAppSelf", async () => {
    const llm = await getLlmConfig();
    // Providers without an API key in config.json: ollama/openai-compatible use
    // a placeholder or custom endpoint; copilot uses an OAuth credential in
    // auth.json, so config.json carries provider+modelId.
    const noKeyProviders: ReadonlyArray<ProviderId> = [
      "ollama",
      "openai-compatible",
      "github-copilot",
    ];
    const hasLlmConfig =
      !!llm &&
      !!llm.modelId &&
      (!!llm.apiKey || noKeyProviders.includes(llm.provider));
    return ok({ version: app.getVersion(), hasLlmConfig, platform: process.platform });
  });

  // Opens the Copilot OAuth verification URL in the default browser (global).
  ipcMain.handle("okf:openExternal", async (_event, url: string) => {
    try {
      if (typeof url !== "string" || url === "") {
        return err(mainT("error.invalidUrl"));
      }
      // http(s) only — guard against `open` launching local files.
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return err(mainT("error.invalidUrl"));
      }
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return err(mainT("error.invalidUrl"));
      }
      await shell.openExternal(url);
      return ok(undefined);
    } catch (error) {
      return err(mainT("error.openUrl", { detail: errorMessage(error) }));
    }
  });

  ipcMain.handle("okf:pickWorkspace", async (): Promise<Result<WorkspaceInfo | null>> => {
    if (!state.window) return ok(null);
    const result = await dialog.showOpenDialog(state.window, {
      properties: ["openDirectory"],
      title: mainT("dialog.chooseWorkspace"),
    });
    if (result.canceled || result.filePaths.length === 0) return ok(null);
    return activateWorkspace(result.filePaths[0]);
  });

  ipcMain.handle("okf:openWorkspace", async (_event, path: string) => {
    // The renderer can pass any string here; validate it resolves to an
    // existing directory before activating. Refusing early gives a clear error.
    if (typeof path !== "string" || path === "") {
      return err<WorkspaceInfo>(mainT("error.invalidWorkspacePath"));
    }
    try {
      const info = await stat(path);
      if (!info.isDirectory()) {
        return err<WorkspaceInfo>(mainT("error.notADirectory", { path }), { path });
      }
    } catch {
      return err<WorkspaceInfo>(mainT("error.workspaceNotFound", { path }), { path });
    }
    return activateWorkspace(path);
  });

  // ─── auto-update (workspace-independent, global) ───────────────────
  // The renderer triggers downloads / installs via these handlers; status
  // arrives as `UpdateEvent`s on the `okf:update-event` channel. The silent
  // start-check is kicked off in `app.whenReady()` below.
  ipcMain.handle("okf:downloadUpdate", async () => {
    if (!state.updater) return err(mainT("update.downloadFailed"));
    return state.updater.downloadUpdate();
  });

  ipcMain.handle("okf:installUpdateNow", async () => {
    if (!state.updater) return err(mainT("update.installFailed"));
    return state.updater.installUpdateNow();
  });

  // Replay the most recent update event so the renderer can recover the
  // start-check result even if it subscribed after the event was forwarded.
  ipcMain.handle("okf:getUpdateStatus", async (): Promise<UpdateEvent | null> => {
    return state.lastUpdateEvent;
  });
}

async function createWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0e1214",
    title: mainT("app.name"),
    autoHideMenuBar: true,
    icon: getAppIconPath(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    log("did-fail-load", errorCode, errorDescription, validatedURL);
  });
  win.webContents.on("console-message", (_event, level, message) => {
    log("renderer:", level, message);
  });

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  try {
    if (devUrl) {
      await win.loadURL(devUrl);
      win.webContents.openDevTools({ mode: "right" });
    } else {
      await win.loadFile(join(__dirname, "../renderer/index.html"));
    }
  } catch (error) {
    fatal(mainT("error.windowLoad"), error);
    throw error;
  }
  return win;
}

app.whenReady().then(async () => {
  log("ready");
  registerGlobalHandlers();
  try {
    state.window = await createWindow();
    log("window created");
    if (process.platform === "darwin" && app.dock) {
      app.dock.setIcon(getAppIconPath());
    }
  } catch (error) {
    fatal(mainT("error.windowCreate"), error);
    return;
  }

  // Auto-update: create the repository (no-op in dev) and forward its event
  // stream to the renderer. The start-check is fire-and-forget — failures are
  // swallowed silently inside the repository (transient network errors must
  // not block or nag on every launch). Only runs in a packaged build.
  try {
    state.updater = await createUpdateRepository();
    const win = state.window;
    state.updater.setListener((event: UpdateEvent) => {
      state.lastUpdateEvent = event;
      if (win && !win.isDestroyed()) win.webContents.send("okf:update-event", event);
    });
    void state.updater.checkForUpdates();
  } catch (error) {
    log("updater init failed (ignored):", errorMessage(error));
  }

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      state.window = await createWindow();
    }
  });
});

process.on("unhandledRejection", (reason) => {
  log("unhandledRejection", reason);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (!state.repo) return;
  // `before-quit` is not awaitable by default: prevent the quit, dispose the
  // agent cleanly, then quit again. Without this, Electron may exit before
  // `dispose()` finishes flushing session state.
  event.preventDefault();
  const repo = state.repo;
  state.repo = null;
  void repo.dispose().finally(() => {
    app.exit(0);
  });
});