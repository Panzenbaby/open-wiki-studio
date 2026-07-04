// Typed client around window.api (exposed by the preload bridge).
import type { AgentApi } from "../shared/ipc-types.ts";

export const api: AgentApi = window.api;