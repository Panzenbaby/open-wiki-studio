import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    // pi-okf-wiki ships TypeScript sources (it is loaded by Pi, which
    // transpiles them). The main process imports its removal logic directly,
    // so it must be bundled and transpiled here rather than externalized —
    // Node could not `import` a `.ts` file at runtime.
    plugins: [externalizeDepsPlugin({ exclude: ["pi-okf-wiki"] })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/main/index.ts") },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
        // Sandboxed preload scripts run without an ESM context, so the bundle
        // must be CommonJS. `"type": "module"` in package.json makes plain
        // `.js` ESM here — hence the explicit `.cjs` extension.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: "src/renderer",
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/renderer/index.html") },
      },
    },
  },
});