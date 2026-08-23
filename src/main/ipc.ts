// IPC wiring for workspace-bound handlers. Workspace-selection handlers
// (listRecentWorkspaces, pickWorkspace, openWorkspace) are registered once
// globally in index.ts; this bridge registers the handlers that need an
// active AgentRepository.
import { BrowserWindow, dialog, ipcMain, type WebContents } from "electron";
import { addInputFiles, fileExists, getPreview, listFolder, revealInFileManager } from "./files.ts";
import { buildWikiGraph } from "./wiki-graph.ts";
import { planRemoval, removeFromWiki } from "./wiki-remove.ts";
import { migrateWiki, planMigration } from "./wiki-migrate.ts";
import { getLlmConfig, resolveStoredApiKey, setLlmConfig, type ApiKeyRequest } from "./config.ts";
import { askUnencryptedKeyChoice } from "./api-key-dialog.ts";
import { FolderWatcher } from "./folder-watcher.ts";
import { errorMessage, ok, err } from "../shared/result.ts";
import { mainT } from "./i18n.ts";
import {
  expectPath,
  expectProvider,
  isBoolean,
  isFolder,
  isLlmConfig,
  isNonEmptyString,
  isNonEmptyStringArray,
  isOptionalString,
  type ArgumentValidator,
} from "./validate.ts";
import type { Folder, LlmConfig, ProviderId } from "../shared/ipc-types.ts";
import type { AgentRepository } from "./agent.ts";

const CHAT_CHANNEL = "okf:chat-event";
const INGEST_CHANNEL = "okf:ingest-event";
const SUMMARY_CHANNEL = "okf:ingest-summary";
const COPILOT_LOGIN_CHANNEL = "okf:copilot-login-event";
/** Pushed to the renderer whenever a workspace folder changes on disk (OS
 *  edit, external delete, …) so views can re-list without polling. */
const FOLDER_CHANGED_CHANNEL = "okf:folder-changed";

async function storedApiKeyFor(request: ApiKeyRequest): Promise<string | undefined> {
  return resolveStoredApiKey(await getLlmConfig(), request);
}

const BRIDGE_CHANNELS = [
  "configureLlm",
  "listAvailableModels",
  "loadModels",
  "loginCopilot",
  "cancelCopilotLogin",
  "logoutCopilot",
  "listFolder",
  "getPreview",
  "fileExists",
  "addInputFiles",
  "addInputFilesDialog",
  "revealInFileManager",
  "planRemoval",
  "removeFromWiki",
  "planMigration",
  "migrateWiki",
  "listSessions",
  "newSession",
  "openSession",
  "deleteSession",
  "getMessages",
  "getWikiGraph",
  "ask",
  "retryChat",
  "ingest",
  "abortChat",
  "abort",
] as const;

type BridgeChannel = (typeof BRIDGE_CHANNELS)[number];

/** Runtime shape check per channel. Channels without an entry take no
 *  arguments, so there is nothing to validate. */
const VALIDATORS: Partial<Record<BridgeChannel, ArgumentValidator>> = {
  configureLlm: (args) => (isLlmConfig(args[0]) ? null : mainT("error.invalidPayload", { channel: "configureLlm" })),
  listAvailableModels: expectProvider,
  loadModels: (args) =>
    expectProvider(args) ??
    (isOptionalString(args[1]) && isOptionalString(args[2])
      ? null
      : mainT("error.invalidPayload", { channel: "loadModels" })),
  listFolder: (args) => (isFolder(args[0]) ? null : mainT("error.invalidPayload", { channel: "listFolder" })),
  getPreview: expectPath,
  fileExists: expectPath,
  addInputFiles: (args) =>
    isNonEmptyStringArray(args[0]) ? null : mainT("error.invalidPayload", { channel: "addInputFiles" }),
  revealInFileManager: (args) =>
    isFolder(args[0]) && isNonEmptyString(args[1]) && isBoolean(args[2])
      ? null
      : mainT("error.invalidPayload", { channel: "revealInFileManager" }),
  planRemoval: expectPath,
  removeFromWiki: expectPath,
  openSession: expectPath,
  deleteSession: expectPath,
  getMessages: expectPath,
  ask: (args) => (isNonEmptyString(args[0]) ? null : mainT("error.invalidPayload", { channel: "ask" })),
  retryChat: (args) => (isNonEmptyString(args[0]) ? null : mainT("error.invalidPayload", { channel: "retryChat" })),
};

export class IpcBridge {
  private readonly watcher: FolderWatcher;

  constructor(
    private readonly webContents: WebContents,
    private readonly repo: AgentRepository,
    private readonly workspace: string,
  ) {
    repo.setChatListener((e) => this.send(CHAT_CHANNEL, e));
    repo.setIngestListener((e) => this.send(INGEST_CHANNEL, e));
    repo.setSummaryListener((s) => this.send(SUMMARY_CHANNEL, s));
    repo.setCopilotLoginListener((e) => this.send(COPILOT_LOGIN_CHANNEL, e));
    // Watch the workspace folders for external (OS) changes and forward a
    // coalesced event per folder. The renderer re-lists on receipt.
    this.watcher = new FolderWatcher(workspace, (folder) =>
      this.send(FOLDER_CHANGED_CHANNEL, folder),
    );
  }

  private send(channel: string, payload: unknown): void {
    if (!this.webContents.isDestroyed()) this.webContents.send(channel, payload);
  }

  /** Tear down the folder watcher. IPC handlers are NOT removed here: `register()`
   *  calls `ipcMain.removeHandler(channel)` for every bridge channel before
   *  re-`handle`-ing, so a workspace switch cleanly overwrites all handlers
   *  (no duplicate-handler crash). On app quit the process is exiting anyway.
   *  The watcher, by contrast, holds an OS resource that must be closed
   *  explicitly — that's what this method does. */
  dispose(): void {
    this.watcher.dispose();
  }

  register(): void {
    const repo = this.repo;
    const workspace = this.workspace;
    const webContents = this.webContents;

    const handlers: Record<string, (...args: never[]) => Promise<unknown>> = {
      configureLlm: async (config: LlmConfig) => {
        // The renderer only sends a key when the user typed a new one; an
        // untouched masked field must keep the stored key.
        const effective = config.apiKey ? config : { ...config, apiKey: await storedApiKeyFor(config) };
        const saved = await setLlmConfig(effective, askUnencryptedKeyChoice(webContents));
        if (!saved.success) return saved;
        return repo.configureLlm(effective);
      },
      listAvailableModels: async (provider: ProviderId) => repo.listAvailableModels(provider),
      loadModels: async (provider: ProviderId, apiKey: string | undefined, baseUrl: string | undefined) => {
        const key = apiKey ?? (await storedApiKeyFor({ provider, baseUrl }));
        return repo.loadModels(provider, key, baseUrl);
      },
      loginCopilot: async () => repo.loginCopilot(),
      cancelCopilotLogin: async () => repo.cancelCopilotLogin(),
      logoutCopilot: async () => repo.logoutCopilot(),
      listFolder: async (folder: Folder) => listFolder(workspace, folder),
      getPreview: async (relativePath: string) => getPreview(workspace, relativePath),
      fileExists: async (relativePath: string) => fileExists(workspace, relativePath),
      addInputFiles: async (filePaths: readonly string[]) => addInputFiles(workspace, filePaths),
      addInputFilesDialog: async () => {
        const win = BrowserWindow.fromWebContents(webContents);
        const opts: Electron.OpenDialogOptions = {
          title: mainT("dialog.addFiles"),
          properties: ["openFile", "openDirectory", "multiSelections"],
        };
        const result = win
          ? await dialog.showOpenDialog(win, opts)
          : await dialog.showOpenDialog(opts);
        if (result.canceled || result.filePaths.length === 0) return ok([]);
        return addInputFiles(workspace, result.filePaths);
      },
      revealInFileManager: async (folder: Folder, relativePath: string, isDirectory: boolean) =>
        revealInFileManager(workspace, folder, relativePath, isDirectory),
      planRemoval: async (relativePath: string) => planRemoval(workspace, relativePath),
      removeFromWiki: async (relativePath: string) => removeFromWiki(workspace, relativePath),
      planMigration: async () => planMigration(workspace),
      migrateWiki: async () => migrateWiki(workspace),
      listSessions: async () => repo.listSessions(),
      newSession: async () => repo.newSession(),
      openSession: async (path: string) => repo.openSession(path),
      deleteSession: async (path: string) => repo.deleteSession(path),
      getMessages: async (path: string) => repo.getMessages(path),
      getWikiGraph: async () => buildWikiGraph(workspace),
      ask: async (question: string) => repo.ask(question),
      retryChat: async (question: string) => repo.retryChat(question),
      ingest: async () => repo.ingest(),
      abortChat: async () => repo.abortChat(),
      abort: async () => repo.abort(),
    };

    for (const name of BRIDGE_CHANNELS) {
      const channel = `okf:${name}`;
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
        try {
          const invalid = VALIDATORS[name]?.(args);
          if (invalid) return err(invalid);
          return await handlers[name](...(args as never[]));
        } catch (error) {
          return { success: false, error: { message: errorMessage(error) } };
        }
      });
    }
  }
}