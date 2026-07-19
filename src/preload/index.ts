// Preload: exposes a strictly-typed AgentApi to the renderer via contextBridge.
// Event methods subscribe to the streaming channels from the main process.
import { contextBridge, ipcRenderer } from "electron";
import type { AgentApi, AgentEvent, CopilotLoginEvent, Folder, IngestSummary, UpdateEvent } from "../shared/ipc-types.ts";

const api: AgentApi = {
  getAppSelf: () => ipcRenderer.invoke("okf:getAppSelf"),
  getLlmConfig: () => ipcRenderer.invoke("okf:getLlmConfig"),
  listRecentWorkspaces: () => ipcRenderer.invoke("okf:listRecentWorkspaces"),
  openWorkspace: (path) => ipcRenderer.invoke("okf:openWorkspace", path),
  pickWorkspace: () => ipcRenderer.invoke("okf:pickWorkspace"),
  forgetWorkspace: (path) => ipcRenderer.invoke("okf:forgetWorkspace", path),

  configureLlm: (config) => ipcRenderer.invoke("okf:configureLlm", config),
  listAvailableModels: (provider) => ipcRenderer.invoke("okf:listAvailableModels", provider),
  loadModels: (provider, apiKey, baseUrl) => ipcRenderer.invoke("okf:loadModels", provider, apiKey, baseUrl),
  loginCopilot: () => ipcRenderer.invoke("okf:loginCopilot"),
  cancelCopilotLogin: () => ipcRenderer.invoke("okf:cancelCopilotLogin"),
  logoutCopilot: () => ipcRenderer.invoke("okf:logoutCopilot"),
  openExternal: (url) => ipcRenderer.invoke("okf:openExternal", url),

  // auto-update
  downloadUpdate: () => ipcRenderer.invoke("okf:downloadUpdate"),
  installUpdateNow: () => ipcRenderer.invoke("okf:installUpdateNow"),
  getUpdateStatus: () => ipcRenderer.invoke("okf:getUpdateStatus"),

  listFolder: (folder) => ipcRenderer.invoke("okf:listFolder", folder),
  getPreview: (relativePath) => ipcRenderer.invoke("okf:getPreview", relativePath),
  addInputFiles: (filePaths) => ipcRenderer.invoke("okf:addInputFiles", filePaths),
  addInputFilesDialog: () => ipcRenderer.invoke("okf:addInputFilesDialog"),
  revealInFileManager: (folder, relativePath, isDirectory) => ipcRenderer.invoke("okf:revealInFileManager", folder, relativePath, isDirectory),

  listSessions: () => ipcRenderer.invoke("okf:listSessions"),
  newSession: () => ipcRenderer.invoke("okf:newSession"),
  openSession: (path) => ipcRenderer.invoke("okf:openSession", path),
  deleteSession: (path) => ipcRenderer.invoke("okf:deleteSession", path),
  getMessages: (path: string) => ipcRenderer.invoke("okf:getMessages", path),
  getWikiGraph: () => ipcRenderer.invoke("okf:getWikiGraph"),

  ask: (question) => ipcRenderer.invoke("okf:ask", question),
  retryChat: (question) => ipcRenderer.invoke("okf:retryChat", question),
  ingest: () => ipcRenderer.invoke("okf:ingest"),
  abortChat: () => ipcRenderer.invoke("okf:abortChat"),
  abort: () => ipcRenderer.invoke("okf:abort"),

  onAgentEvent: (listener) => {
    const handler = (_event: unknown, payload: AgentEvent) => listener(payload);
    ipcRenderer.on("okf:chat-event", handler);
    return () => ipcRenderer.removeListener("okf:chat-event", handler);
  },
  onIngestEvent: (listener) => {
    const handler = (_event: unknown, payload: AgentEvent) => listener(payload);
    ipcRenderer.on("okf:ingest-event", handler);
    return () => ipcRenderer.removeListener("okf:ingest-event", handler);
  },
  onIngestSummary: (listener) => {
    const handler = (_event: unknown, payload: IngestSummary) => listener(payload);
    ipcRenderer.on("okf:ingest-summary", handler);
    return () => ipcRenderer.removeListener("okf:ingest-summary", handler);
  },
  onCopilotLoginEvent: (listener) => {
    const handler = (_event: unknown, payload: CopilotLoginEvent) => listener(payload);
    ipcRenderer.on("okf:copilot-login-event", handler);
    return () => ipcRenderer.removeListener("okf:copilot-login-event", handler);
  },
  onUpdateEvent: (listener) => {
    const handler = (_event: unknown, payload: UpdateEvent) => listener(payload);
    ipcRenderer.on("okf:update-event", handler);
    return () => ipcRenderer.removeListener("okf:update-event", handler);
  },
  onFolderChanged: (listener) => {
    const handler = (_event: unknown, payload: Folder) => listener(payload);
    ipcRenderer.on("okf:folder-changed", handler);
    return () => ipcRenderer.removeListener("okf:folder-changed", handler);
  },
};

contextBridge.exposeInMainWorld("api", api);
