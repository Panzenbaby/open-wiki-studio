// Populate `node_modules/pi-okf-wiki/node_modules/` with the extension's
// runtime dependencies so electron-builder's `extraResources` can ship them
// next to the extension source.
//
// Why a staging copy: the extension is installed as a dependency of the app,
// so npm hoists its deps to the app's top-level `node_modules/` and leaves
// `node_modules/pi-okf-wiki/node_modules/` empty. Running `npm install`
// in-place sees the hoisted deps as satisfied and does nothing. Staging the
// extension to an isolated temp dir (no parent node_modules) forces a real
// nested install, which we then copy back.
//
// Run before `electron-builder` (wired into the `package:*` scripts).

import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const extDir = join(appRoot, "node_modules", "pi-okf-wiki");
const extPkg = join(extDir, "package.json");

const pkg = JSON.parse(readFileSync(extPkg, "utf8"));
const deps = pkg.dependencies ?? {};
if (Object.keys(deps).length === 0) {
  console.warn("[sync-ext-deps] pi-okf-wiki declares no runtime dependencies; nothing to do.");
  process.exit(0);
}

// 1. Stage the extension (sources + package.json) to an isolated temp dir.
//    The extension ships its sources under `src/` (see pi-okf-wiki
//    package.json `files`), so copy the whole `src/` tree verbatim — this
//    stays correct as new files are added without a per-file list to drift.
const stage = await mkdtemp(join(tmpdir(), "okf-ext-stage-"));
await cp(join(extDir, "src"), join(stage, "src"), { recursive: true });
await cp(join(extDir, "LICENSE"), join(stage, "LICENSE")).catch(() => undefined);
await writeFile(join(stage, "package.json"), JSON.stringify({ ...pkg, devDependencies: {}, peerDependencies: {} }, null, 2));

// 2. Install runtime deps nested in the staging dir.
execSync("npm install --omit=dev --no-package-lock --ignore-scripts", {
  cwd: stage,
  stdio: "inherit",
});

// 3. Copy the staged node_modules back into the app's extension checkout.
const target = join(extDir, "node_modules");
await rm(target, { recursive: true, force: true });
await cp(join(stage, "node_modules"), target, { recursive: true });
await rm(stage, { recursive: true, force: true });

console.log("[sync-ext-deps] populated", target);