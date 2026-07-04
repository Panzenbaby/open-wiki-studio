// Polyfill a Node 24.10+ `node:worker_threads` API that undici 8.x (bundled
// with @earendil-works/pi-coding-agent) calls at module load:
//   const { markAsUncloneable } = require('node:worker_threads')
// Electron 31 ships Node 20, where this symbol is absent, which makes undici
// throw "webidl.util.markAsUncloneable is not a function" at load and crashes
// the main process. We inject a no-op before anything imports pi-coding-agent.
// The real function only prevents structured-cloning of the object across
// worker boundaries — irrelevant in our single-process host, so a no-op is safe.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const workerThreads = require("node:worker_threads") as Record<string, unknown>;
if (typeof workerThreads.markAsUncloneable !== "function") {
  workerThreads.markAsUncloneable = function markAsUncloneable() {
    /* no-op: structured-clone marker not needed in-process */
  };
}

export {};