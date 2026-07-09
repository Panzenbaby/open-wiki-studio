// IPC wiring for workspace-bound handlers. Workspace-selection handlers
// (listRecentWorkspaces, pickWorkspace, openWorkspace) are registered once
// globally in index.ts; this bridge registers the handlers that need an
// active AgentRepository.
import { BrowserWindow, dialog, ipcMain, type WebContents } from "electron";
import { addInputFiles, getPreview, listFolder, revealInFileManager } from "./files.ts";
import { buildWikiGraph } from "./wiki-graph.ts";
import { setLlmConfig } from "./config.ts";
import { errorMessage, ok, err } from "../shared/result.ts";
import { mainT } from "./i18n.ts";
import type { Folder, LlmConfig, ProviderId } from "../shared/ipc-types.ts";
import type { AgentRepository } from "./agent.ts";

const CHAT_CHANNEL = "okf:chat-event";
const INGEST_CHANNEL = "okf:ingest-event";
const SUMMARY_CHANNEL = "okf:ingest-summary";
const COPILOT_LOGIN_CHANNEL = "okf:copilot-login-event";

/** Known `ProviderId` values — used to validate IPC payloads before forwarding. */
const VALID_PROVIDERS: ReadonlyArray<ProviderId> = [
  "anthropic",
  "openai",
  "google",
  "openai-compatible",
  "ollama",
  "github-copilot",
];

const BRIDGE_CHANNELS = [
  "configureLlm",
  "listAvailableModels",
  "loginCopilot",
  "cancelCopilotLogin",
  "logoutCopilot",
  "listFolder",
  "getPreview",
  "addInputFiles",
  "addInputFilesDialog",
  "revealInFileManager",
  "listSessions",
  "newSession",
  "openSession",
  "deleteSession",
  "getMessages",
  "getWikiGraph",
  "ask",
  "ingest",
  "abortChat",
  "abort",
] as const;

export class IpcBridge {
  constructor(
    private readonly webContents: WebContents,
    private readonly repo: AgentRepository,
    private readonly workspace: string,
  ) {
    repo.setChatListener((e) => this.send(CHAT_CHANNEL, e));
    repo.setIngestListener((e) => this.send(INGEST_CHANNEL, e));
    repo.setSummaryListener((s) => this.send(SUMMARY_CHANNEL, s));
    repo.setCopilotLoginListener((e) => this.send(COPILOT_LOGIN_CHANNEL, e));
  }

  private send(channel: string, payload: unknown): void {
    if (!this.webContents.isDestroyed()) this.webContents.send(channel, payload);
  }

  register(): void {
    const repo = this.repo;
    const workspace = this.workspace;
    const webContents = this.webContents;

    const handlers: Record<string, (...args: never[]) => Promise<unknown>> = {
      configureLlm: async (config: LlmConfig) => {
        const saved = await setLlmConfig(config);
        if (!saved.success) return saved;
        return repo.configureLlm(config);
      },
      listAvailableModels: async (provider: string) => {
        if (!VALID_PROVIDERS.includes(provider as ProviderId)) {
          return err(`Unknown provider: ${provider}`);
        }
        return repo.listAvailableModels(provider as ProviderId);
      },
      loginCopilot: async () => repo.loginCopilot(),
      cancelCopilotLogin: async () => repo.cancelCopilotLogin(),
      logoutCopilot: async () => repo.logoutCopilot(),
      listFolder: async (folder: Folder) => listFolder(workspace, folder),
      getPreview: async (relativePath: string) => getPreview(workspace, relativePath),
      addInputFiles: async (filePaths: readonly string[]) => addInputFiles(workspace, filePaths),
      addInputFilesDialog: async () => {
        const win = BrowserWindow.fromWebContents(webContents);
        const opts: Electron.OpenDialogOptions = {
          title: mainT("dialog.addFiles"),
          properties: ["openFile", "multiSelections"],
        };
        const result = win
          ? await dialog.showOpenDialog(win, opts)
          : await dialog.showOpenDialog(opts);
        if (result.canceled || result.filePaths.length === 0) return ok([]);
        return addInputFiles(workspace, result.filePaths);
      },
      revealInFileManager: async (folder: Folder, relativePath: string, isDirectory: boolean) =>
        revealInFileManager(workspace, folder, relativePath, isDirectory),
      listSessions: async () => repo.listSessions(),
      newSession: async () => repo.newSession(),
      openSession: async (path: string) => repo.openSession(path),
      deleteSession: async (path: string) => repo.deleteSession(path),
      getMessages: async (path: string) => repo.getMessages(path),
      getWikiGraph: async () => buildWikiGraph(workspace),
      ask: async (question: string) => repo.ask(question),
      ingest: async () => repo.ingest(),
      abortChat: async () => repo.abortChat(),
      abort: async () => repo.abort(),
    };

    for (const name of BRIDGE_CHANNELS) {
      const channel = `okf:${name}`;
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (_event, ...args) => {
        try {
          return await handlers[name](...(args as never[]));
        } catch (error) {
          return { success: false, error: { message: errorMessage(error) } };
        }
      });
    }
  }
}