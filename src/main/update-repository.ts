// UpdateRepository: wraps the `electron-updater` SDK so the rest of the app
// never touches it directly (Repository pattern per AGENTS.md). The external
// SDK models (`UpdateInfo` / `ProgressInfo` DTOs) stay private to this module;
// only `AppModel`s (`UpdateInfo`, `UpdateEvent`) leave it. Every method returns
// a `Result<T>` — exceptions are caught and converted.
//
// Testability seam: the electron-updater `autoUpdater` is injected as a
// narrowed, structural `UpdateEngine` interface. Tests pass a typed fake; the
// production factory `createUpdateRepository()` wires the real singleton (only
// when the app is packaged — in dev the repository is created `enabled: false`
// with a no-op engine, so update checks never run against the dev build).
import { app } from "electron";
import { ok, err, errorMessage } from "../shared/result.ts";
import { mainT } from "./i18n.ts";
import type {
  Result,
  UpdateEvent,
  UpdateInfo,
} from "../shared/ipc-types.ts";

// ─── electron-updater DTOs (private — never exported) ────────────────
/** Structural subset of electron-updater's `UpdateInfo` (the SDK model). */
interface UpdateInfoDto {
  readonly version: string;
  readonly releaseName?: string | null;
  readonly releaseNotes?: string | Array<{ readonly version: string; readonly note: string | null }> | null;
}
/** Structural subset of electron-updater's `ProgressInfo`. */
interface ProgressInfoDto {
  readonly percent: number;
  readonly transferred: number;
  readonly total: number;
  readonly bytesPerSecond: number;
}

// ─── Injectable engine seam ───────────────────────────────────────────
/**
 * Narrowed, structural view of `electron-updater`'s `AppUpdater` — only the
 * surface this repository uses. The real `autoUpdater` satisfies this shape;
 * tests provide a minimal fake. `on(...)`/`removeAllListeners(...)` return
 * `unknown` because we never chain on them.
 */
export interface UpdateEngine {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: "update-available", listener: (info: UpdateInfoDto) => void): unknown;
  on(event: "update-downloaded", listener: (info: UpdateInfoDto) => void): unknown;
  on(event: "download-progress", listener: (info: ProgressInfoDto) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  removeAllListeners(event: string): unknown;
  checkForUpdates(): Promise<{ readonly updateInfo: UpdateInfoDto } | null>;
  downloadUpdate(): Promise<void>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

// ─── Conversion (DTO → AppModel) ──────────────────────────────────────
/** Builds the public GitHub Release URL for a given version. Injected so the
 *  repository stays free of hard-coded owner/repo strings and stays testable. */
export type ReleaseNotesUrlBuilder = (version: string) => string;

function toUpdateInfo(dto: UpdateInfoDto, buildUrl: ReleaseNotesUrlBuilder): UpdateInfo {
  return { version: dto.version, releaseNotesUrl: buildUrl(dto.version) };
}

function roundPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

// ─── No-op engine (dev mode) ──────────────────────────────────────────
const NOOP_ENGINE: UpdateEngine = {
  autoDownload: false,
  autoInstallOnAppQuit: true,
  on: () => undefined,
  removeAllListeners: () => undefined,
  checkForUpdates: () => Promise.resolve(null),
  downloadUpdate: () => Promise.resolve(),
  quitAndInstall: () => undefined,
};

// ─── Repository ───────────────────────────────────────────────────────
export interface UpdateRepositoryDeps {
  readonly engine: UpdateEngine;
  readonly releaseNotesUrl: ReleaseNotesUrlBuilder;
  /** When false (dev build), every method short-circuits and no events fire. */
  readonly enabled: boolean;
}

type Phase = "idle" | "checking" | "downloading";

/**
 * Phases gate which SDK `error` events are surfaced: errors during the
 * *download* phase are forwarded to the UI (so the user can retry); errors
 * during the *checking* phase are swallowed (silent start-check per the
 * update UX spec — no icon, no toast on transient network failures).
 */
export class UpdateRepository {
  private readonly deps: UpdateRepositoryDeps;
  private listener: ((event: UpdateEvent) => void) | null = null;
  private phase: Phase = "idle";

  constructor(deps: UpdateRepositoryDeps) {
    this.deps = deps;
    const engine = deps.engine;
    engine.autoDownload = false; // user confirms before download
    engine.autoInstallOnAppQuit = true; // "on next launch" path
    engine.on("update-available", (dto) => this.emit({ type: "available", info: toUpdateInfo(dto, deps.releaseNotesUrl) }));
    engine.on("download-progress", (dto) => this.emit({ type: "progress", percent: roundPercent(dto.percent) }));
    engine.on("update-downloaded", (dto) => {
      this.phase = "idle";
      this.emit({ type: "downloaded", info: toUpdateInfo(dto, deps.releaseNotesUrl) });
    });
    engine.on("error", (error) => {
      if (this.phase === "downloading") {
        this.phase = "idle";
        this.emit({ type: "error", message: errorMessage(error) });
      } else {
        // Checking-phase errors are transient — swallow silently per UX spec.
        console.warn("[open-wiki-studio] update check error (swallowed):", errorMessage(error));
      }
    });
  }

  private emit(event: UpdateEvent): void {
    if (this.deps.enabled) this.listener?.(event);
  }

  /** Subscribe to the update event stream. Replaces any prior listener. */
  setListener(listener: ((event: UpdateEvent) => void) | null): void {
    this.listener = listener;
  }

  /** Check for an update. Resolves with `null` when up-to-date. Start-check
   *  failures are returned as `err` (the caller ignores them silently). */
  async checkForUpdates(): Promise<Result<UpdateInfo | null>> {
    if (!this.deps.enabled) return ok(null);
    this.phase = "checking";
    try {
      const result = await this.deps.engine.checkForUpdates();
      if (result && result.updateInfo) {
        return ok(toUpdateInfo(result.updateInfo, this.deps.releaseNotesUrl));
      }
      return ok(null);
    } catch (error) {
      return err<UpdateInfo | null>(mainT("update.checkFailed"), { cause: errorMessage(error) });
    } finally {
      if (this.phase === "checking") this.phase = "idle";
    }
  }

  /** Start downloading the update. Progress/completion arrive as events. */
  async downloadUpdate(): Promise<Result<void>> {
    if (!this.deps.enabled) return ok(undefined);
    this.phase = "downloading";
    try {
      await this.deps.engine.downloadUpdate();
      return ok(undefined);
    } catch (error) {
      this.phase = "idle";
      return err<void>(mainT("update.downloadFailed"), { cause: errorMessage(error) });
    }
  }

  /** Quit the app immediately and install the already-downloaded update. */
  async installUpdateNow(): Promise<Result<void>> {
    if (!this.deps.enabled) return ok(undefined);
    try {
      this.deps.engine.quitAndInstall(false, true);
      return ok(undefined);
    } catch (error) {
      return err<void>(mainT("update.installFailed"), { cause: errorMessage(error) });
    }
  }

  /** Remove all SDK listeners and clear the UI listener. */
  dispose(): void {
    this.deps.engine.removeAllListeners("update-available");
    this.deps.engine.removeAllListeners("download-progress");
    this.deps.engine.removeAllListeners("update-downloaded");
    this.deps.engine.removeAllListeners("error");
    this.listener = null;
  }
}

// ─── Production factory ───────────────────────────────────────────────
// Owner/repo come from `build.publish` in package.json (single source of
// truth) so the release-notes URL can never drift from the actual publish
// target. The JSON is bundled into the main process at build time.
import packageJson from "../../package.json";

interface PublishMeta {
  readonly owner?: string;
  readonly repo?: string;
}
const PUBLISH_CONFIG: PublishMeta | undefined = (
  packageJson as { build?: { publish?: PublishMeta } }
).build?.publish;

function buildReleaseNotesUrl(version: string): string {
  const owner = PUBLISH_CONFIG?.owner;
  const repo = PUBLISH_CONFIG?.repo;
  return `https://github.com/${owner}/${repo}/releases/tag/v${version}`;
}

/**
 * Creates the `UpdateRepository` for the running app. In dev (`!app.isPackaged`)
 * the repository is disabled with a no-op engine, so no update checks run.
 * In a packaged build the real `electron-updater` autoUpdater is loaded lazily
 * (keeps the dev bundle clean and avoids initialising the updater outside a
 * signed, packaged app where it would throw).
 */
export async function createUpdateRepository(): Promise<UpdateRepository> {
  if (!app.isPackaged) {
    return new UpdateRepository({
      engine: NOOP_ENGINE,
      releaseNotesUrl: buildReleaseNotesUrl,
      enabled: false,
    });
  }
  const { autoUpdater } = await import("electron-updater");
  const engine = autoUpdater as unknown as UpdateEngine;
  return new UpdateRepository({ engine, releaseNotesUrl: buildReleaseNotesUrl, enabled: true });
}
