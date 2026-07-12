// Tests for UpdateRepository — the electron-updater wrapper. The external SDK
// is the seam: a typed `FakeEngine` stands in for `autoUpdater`, so these
// exercise the event→UpdateEvent translation, the DTO→AppModel conversion,
// phase-gated error surfacing, and the dev-mode (`enabled: false`) short-circuit
// without touching electron-updater or the network.
import { describe, expect, it, vi } from "vitest";
import { UpdateRepository, type UpdateEngine } from "../src/main/update-repository.ts";
import type { UpdateEvent } from "../src/shared/ipc-types.ts";

// ─── Minimal typed fake engine ────────────────────────────────────────
// Structurally compatible with `UpdateEngine`; records calls so assertions
// can inspect behaviour. Listeners are kept per-event for deterministic firing.
type ProgressListener = (info: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => void;
type InfoListener = (info: { version: string; releaseName?: string | null; releaseNotes?: unknown }) => void;
type ErrorListener = (error: Error) => void;

interface FakeEngine extends UpdateEngine {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkResult: { updateInfo: { version: string } } | null;
  downloadRejects: Error | null;
  emitAvailable(info: { version: string }): void;
  emitProgress(percent: number): void;
  emitDownloaded(info: { version: string }): void;
  emitError(error: Error): void;
  checkForUpdatesCalls: number;
  downloadCalls: number;
  quitCalls: number;
}

function makeFakeEngine(checkResult: FakeEngine["checkResult"]): FakeEngine {
  const listeners: Record<string, InfoListener | ProgressListener | ErrorListener | undefined> = {};
  return {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    checkResult,
    downloadRejects: null,
    checkForUpdatesCalls: 0,
    downloadCalls: 0,
    quitCalls: 0,
    on(event, listener) {
      listeners[event] = listener as never;
      return undefined;
    },
    removeAllListeners(event) {
      delete listeners[event];
      return undefined;
    },
    async checkForUpdates() {
      this.checkForUpdatesCalls += 1;
      return this.checkResult;
    },
    async downloadUpdate() {
      this.downloadCalls += 1;
      if (this.downloadRejects) throw this.downloadRejects;
    },
    quitAndInstall() {
      this.quitCalls += 1;
    },
    emitAvailable(info) {
      (listeners["update-available"] as InfoListener | undefined)?.(info);
    },
    emitProgress(percent) {
      (listeners["download-progress"] as ProgressListener | undefined)?.({
        percent,
        transferred: 0,
        total: 0,
        bytesPerSecond: 0,
      });
    },
    emitDownloaded(info) {
      (listeners["update-downloaded"] as InfoListener | undefined)?.(info);
    },
    emitError(error) {
      (listeners["error"] as ErrorListener | undefined)?.(error);
    },
  };
}

const buildUrl = (version: string) => `https://example.test/releases/v${version}`;

function makeRepo(engine: FakeEngine, enabled = true): UpdateRepository {
  return new UpdateRepository({ engine, releaseNotesUrl: buildUrl, enabled });
}

describe("UpdateRepository", () => {
  it("disables autoDownload and enables install-on-quit on the engine", () => {
    const engine = makeFakeEngine(null);
    makeRepo(engine);
    expect(engine.autoDownload).toBe(false);
    expect(engine.autoInstallOnAppQuit).toBe(true);
  });

  it("checkForUpdates resolves with the AppModel when an update is available", async () => {
    const engine = makeFakeEngine({ updateInfo: { version: "1.2.3" } });
    const repo = makeRepo(engine);
    const result = await repo.checkForUpdates();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        version: "1.2.3",
        releaseNotesUrl: "https://example.test/releases/v1.2.3",
      });
    }
  });

  it("checkForUpdates resolves with null when up-to-date", async () => {
    const engine = makeFakeEngine(null);
    const repo = makeRepo(engine);
    const result = await repo.checkForUpdates();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeNull();
  });

  it("forwards update-available / progress / downloaded as typed UpdateEvents", () => {
    const engine = makeFakeEngine(null);
    const repo = makeRepo(engine);
    const events: UpdateEvent[] = [];
    repo.setListener((e) => events.push(e));

    engine.emitAvailable({ version: "2.0.0" });
    engine.emitProgress(42.6);
    engine.emitDownloaded({ version: "2.0.0" });

    expect(events).toEqual([
      { type: "available", info: { version: "2.0.0", releaseNotesUrl: "https://example.test/releases/v2.0.0" } },
      { type: "progress", percent: 43 }, // rounded + clamped
      { type: "downloaded", info: { version: "2.0.0", releaseNotesUrl: "https://example.test/releases/v2.0.0" } },
    ]);
  });

  it("clamps and rounds progress percent", () => {
    const engine = makeFakeEngine(null);
    const repo = makeRepo(engine);
    const events: UpdateEvent[] = [];
    repo.setListener((e) => events.push(e));
    engine.emitProgress(150);
    engine.emitProgress(-5);
    expect(events.map((e) => (e.type === "progress" ? e.percent : null))).toEqual([100, 0]);
  });

  it("surfaces errors during the download phase and reverts to idle", async () => {
    const engine = makeFakeEngine(null);
    const repo = makeRepo(engine);
    const events: UpdateEvent[] = [];
    repo.setListener((e) => events.push(e));

    await repo.downloadUpdate();
    engine.emitError(new Error("network down"));

    expect(events).toContainEqual({ type: "error", message: "network down" });
  });

  it("swallows errors during the checking phase (silent start-check)", async () => {
    const engine = makeFakeEngine(null);
    const repo = makeRepo(engine);
    const events: UpdateEvent[] = [];
    repo.setListener((e) => events.push(e));

    await repo.checkForUpdates();
    engine.emitError(new Error("transient"));
    expect(events).toEqual([]);
  });

  it("checkForUpdates converts a thrown error into a Result.err", async () => {
    const engine = makeFakeEngine(null);
    engine.checkForUpdates = () => Promise.reject(new Error("boom"));
    const repo = makeRepo(engine);
    const result = await repo.checkForUpdates();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toBeTruthy();
  });

  it("downloadUpdate converts a thrown error into a Result.err", async () => {
    const engine = makeFakeEngine(null);
    engine.downloadRejects = new Error("disk full");
    const repo = makeRepo(engine);
    const result = await repo.downloadUpdate();
    expect(result.success).toBe(false);
  });

  it("installUpdateNow calls quitAndInstall on the engine", async () => {
    const engine = makeFakeEngine(null);
    const repo = makeRepo(engine);
    await repo.installUpdateNow();
    expect(engine.quitCalls).toBe(1);
  });

  it("disabled (dev) repository never touches the engine or emits events", async () => {
    const engine = makeFakeEngine({ updateInfo: { version: "9.9.9" } });
    const repo = makeRepo(engine, false);
    const events: UpdateEvent[] = [];
    repo.setListener((e) => events.push(e));

    const checked = await repo.checkForUpdates();
    const downloaded = await repo.downloadUpdate();
    engine.emitAvailable({ version: "9.9.9" });

    expect(checked.success && checked.data).toBeNull();
    expect(downloaded.success).toBe(true);
    expect(engine.checkForUpdatesCalls).toBe(0);
    expect(engine.downloadCalls).toBe(0);
    expect(events).toEqual([]);
  });

  it("dispose removes SDK listeners and clears the UI listener", () => {
    const engine = makeFakeEngine(null);
    const repo = makeRepo(engine);
    const listener = vi.fn();
    repo.setListener(listener);
    repo.dispose();
    // After dispose, emitting must not call the listener.
    engine.emitAvailable({ version: "1.0.0" });
    expect(listener).not.toHaveBeenCalled();
  });
});