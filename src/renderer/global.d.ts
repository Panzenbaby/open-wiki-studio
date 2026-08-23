// Electron preload exposes `window.api` (AgentApi).
import type { AgentApi } from "../shared/ipc-types.ts";

declare global {
  interface Window {
    readonly api: AgentApi;
  }
}

export {};