// Electron preload exposes `window.api` (AgentApi).
import type { AgentApi } from "../shared/ipc-types.ts";

declare global {
  interface Window {
    readonly api: AgentApi;
  }

  interface File {
    readonly path: string;
  }
}

export {};