// Vitest global setup: mock the Electron modules that production code imports
// at module load time. The ConceptStore itself only needs `mainT` (for the
// "concept.untyped" fallback label) and `node:fs`; this mock keeps those working
// without a running Electron process.
import { vi } from "vitest";

// `app.getLocale()` is called by src/main/i18n.ts to pick en/de. Default to
// "en"; individual tests can override via the locale.
const electron = {
  app: {
    getLocale: () => "en",
    getPath: () => "/tmp",
  },
  shell: {
    openPath: () => "",
    showItemInFolder: () => {},
  },
  dialog: {},
  BrowserWindow: {},
  ipcMain: { handle: () => {}, removeHandler: () => {} },
};

vi.mock("electron", () => ({ default: electron, ...electron }));