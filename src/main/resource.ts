// Resolve the bundled pi-okf-wiki extension entry path (loaded by the
// ResourceLoader via jiti at runtime).
//
// `pi-okf-wiki` is declared as a git dependency so `npm install` checks out a
// real copy into node_modules — used in dev.
//
// In a packaged build the extension is NOT shipped inside the asar, because
// jiti reads files via `fs` and does not reliably handle the asar virtual
// filesystem. Instead electron-builder copies the extension source to
// `Resources/pi-okf-wiki/` via `extraResources`.
import { app } from "electron";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | undefined;

export function resolveOkfExtensionPath(): string {
  if (cached) return cached;
  if (app.isPackaged) {
    cached = join(process.resourcesPath, "pi-okf-wiki", "src", "index.ts");
    return cached;
  }
  const require = createRequire(import.meta.url);
  try {
    const pkgPath = require.resolve("pi-okf-wiki/package.json");
    cached = join(dirname(pkgPath), "src", "index.ts");
    return cached;
  } catch {
    // Fallback: assume a standard node_modules layout relative to the bundle.
    const here = dirname(fileURLToPath(import.meta.url));
    cached = join(here, "..", "..", "node_modules", "pi-okf-wiki", "src", "index.ts");
    return cached;
  }
}