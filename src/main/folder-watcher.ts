// Watches the workspace for filesystem changes and notifies the renderer so
// views re-list without polling. This is the SINGLE source of truth for "a
// folder's contents changed": the renderer does not manually refresh after
// its own writes — drag-and-drop, the Add-button, and ingest all write to
// disk and are observed here.
//
// Design: ONE recursive `fs.watch` on the workspace root, with events routed
// to `input/`/`wiki/` by parsing the top path segment of the reported
// filename. A single root watcher is used (rather than one recursive
// watcher per folder) because on macOS Node's recursive FSEvents watcher
// cross-fires across sibling watched directories — two sibling recursive
// watchers would both fire for a write to either of them. Watching the root
// once avoids that, reports consistent root-relative filenames, and naturally
// observes folders created after construction (e.g. `wiki/archive/` on first
// ingest) without a reconcile timer. Events under other root entries
// (`sessions/`, config files) are filtered out.
//
// Reliability hardening (fs.watch is best-effort and platform-inconsistent):
//  - Self-recreate on error: a watcher that errors (or whose root is
//    temporarily unwatchable) is re-attached with exponential backoff (capped),
//    up to a max attempt count, so the workspace doesn't silently go deaf
//    forever AND a permanently-broken root doesn't spin + warn indefinitely.
//  - Bounded debounce: events are coalesced per folder, but a sustained burst
//    (large copy) cannot starve the listener — a max-wait cap forces a flush
//    even if events keep arriving.
//
// Notes:
//  - `fs.watch({ recursive: true })` is supported on macOS and Windows
//    natively; on Linux it requires Node 22+ / kernel 5.12+ (the app's engine
//    floor is Node 22.19). On platforms without recursive watching, `fs.watch`
//    falls back to top-level-only — depth is reduced but routing still works
//    for direct children.
//  - The watcher is disposable so `activateWorkspace` can tear it down before
//    creating a new one for a switched workspace.
import { watch, type FSWatcher } from "node:fs";
import type { Folder } from "../shared/ipc-types.ts";

/** Folders whose changes are forwarded to the renderer. Events under any
 *  other root entry (sessions/, config files, …) are ignored. The OKF archive
 *  lives under `wiki/archive/` and is covered by the `wiki` folder — it has
 *  no entry of its own. */
const WATCHED_FOLDERS: readonly Folder[] = ["input", "wiki"];
const WATCHED_SET: ReadonlySet<string> = new Set(WATCHED_FOLDERS);

/** Coalesce window. File managers emit add+rename+delete bursts; a short
 *  window avoids spamming the renderer with re-lists. Exported for tests so
 *  they wait on the real production window rather than duplicated magic
 *  numbers. */
export const DEBOUNCE_MS = 250;
/** Hard cap on coalescing: even a sustained burst (large recursive copy)
 *  flushes after this long, so the listener can't be starved indefinitely. */
export const MAX_WAIT_MS = 1000;
/** Backoff before re-attaching the root watcher after it errored. The first
 *  retry waits this long; subsequent retries back off exponentially (see
 *  MAX_RECREATE_BACKOFF_MS). Exported for tests. */
export const RECREATE_BACKOFF_MS = 1000;
/** Upper bound for the re-attach backoff. Once the exponential delay exceeds
 *  this, retries wait this long until the attempt cap is hit. */
const MAX_RECREATE_BACKOFF_MS = 30_000;
/** Maximum number of re-attach attempts before giving up. A permanently
 *  unwatchable root would otherwise spin + warn forever; once exhausted, the
 *  watcher stops retrying (in-app refresh paths still keep the UI usable). */
const MAX_RECREATE_ATTEMPTS = 10;

export interface FolderChangeListener {
  (folder: Folder): void;
}

interface PendingFlush {
  /** Short coalesce timer — reset on every event. */
  debounce: ReturnType<typeof globalThis.setTimeout>;
  /** Max-wait timer — armed on the first event of a burst, never reset. */
  maxWait: ReturnType<typeof globalThis.setTimeout>;
}

/**
 * Watches the workspace root recursively and calls `listener(folder)` whenever
 * `input/` or `wiki/` (including its `archive/` subtree) changes on disk. This
 * is the renderer's only signal to re-list a folder — there are no parallel
 * manual refresh paths. Reliability hardening (self-recreate, bounded
 * debounce) is described in the file header.
 */
export class FolderWatcher {
  private readonly workspace: string;
  private readonly listener: FolderChangeListener;
  private watcher: FSWatcher | null = null;
  private readonly pending = new Map<Folder, PendingFlush>();
  /** Backoff timer for re-attaching after an error — tracked so `dispose`
   *  can cancel it. */
  private recreateTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  /** Re-attach attempt counter for exponential backoff. Reset to 0 on a
   *  successful attach so a later, independent error starts fresh. */
  private recreateAttempt = 0;
  private disposed = false;

  constructor(workspace: string, listener: FolderChangeListener) {
    this.workspace = workspace;
    this.listener = listener;
    void this.tryAttach();
  }

  /** Attach (or re-attach) the single recursive root watcher. No-op if
   *  already attached or disposed. Resolves on completion; never rejects. */
  private async tryAttach(): Promise<void> {
    if (this.disposed || this.watcher) return;
    let watcher: FSWatcher;
    try {
      watcher = watch(this.workspace, { recursive: true }, (eventType, filename) =>
        this.route(eventType, filename),
      );
    } catch {
      // Root doesn't exist or watching is unavailable. Without a watcher we
      // can't observe changes — the explicit refresh paths (addInputFiles,
      // ingest) still keep the UI usable for in-app writes. Retry with
      // exponential backoff in case the workspace appears momentarily later;
      // scheduleRecreate gives up after MAX_RECREATE_ATTEMPTS.
      this.scheduleRecreate();
      return;
    }
    if (this.disposed || this.watcher) {
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
      return;
    }
    // Self-recreate on error: a dead watcher would otherwise silence the
    // workspace forever. Surface once for diagnosability, then re-attach
    // (with escalating backoff via scheduleRecreate).
    watcher.on("error", (reason) => {
      if (this.disposed || this.watcher !== watcher) return;
      console.warn(
        `[open-wiki-studio] workspace folder watcher errored; re-attaching`,
        reason,
      );
      this.watcher = null;
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
      this.scheduleRecreate();
    });
    this.watcher = watcher;
    // A fresh, live watcher — reset the backoff sequence so a future error
    // starts from the short initial delay again.
    this.recreateAttempt = 0;
  }

  /** Schedule a re-attach with exponential backoff (RECREATE_BACKOFF_MS * 2^n,
   *  capped at MAX_RECREATE_BACKOFF_MS). After MAX_RECREATE_ATTEMPTS retries
   *  the watcher gives up — a permanently unwatchable root would otherwise
   *  spin + warn forever. The attempt counter resets on a successful attach. */
  private scheduleRecreate(): void {
    if (this.disposed || this.recreateTimer) return;
    if (this.recreateAttempt >= MAX_RECREATE_ATTEMPTS) {
      console.warn(
        `[open-wiki-studio] workspace folder watcher gave up after ${MAX_RECREATE_ATTEMPTS} re-attach attempts; filesystem changes will not be observed until the workspace is reactivated.`,
      );
      return;
    }
    const base = RECREATE_BACKOFF_MS * 2 ** this.recreateAttempt;
    const delayMs = Math.min(base, MAX_RECREATE_BACKOFF_MS);
    this.recreateAttempt += 1;
    this.recreateTimer = globalThis.setTimeout(() => {
      this.recreateTimer = null;
      if (!this.disposed) void this.tryAttach();
    }, delayMs);
  }

  /** Determine which watched folder an event belongs to and schedule a flush.
   *  Events with no parseable filename, or under a non-watched root entry, are
   *  ignored.
   *
   *  The OKF archive lives at `wiki/archive/` (since pi-okf-wiki 0.2.0). An
   *  event whose path begins with `wiki/archive/` is routed to `"wiki"` via
   *  the top-segment rule below — the archive is browsed as part of the wiki
   *  folder, so a write there must bump the wiki version (and refresh the
   *  wiki browser, which shows the `archive/` subdirectory). */
  private route(_eventType: string, filename: string | Buffer | null): void {
    if (this.disposed || filename == null) return;
    // `filename` is relative to the watched root. Buffer paths (Windows) →
    // decode as utf8; segment on either separator for cross-platform safety.
    const rel =
      typeof filename === "string" ? filename : filename.toString("utf8");
    const segments = rel.split(/[\\/]/);
    const top = segments[0];
    if (top && WATCHED_SET.has(top)) this.schedule(top as Folder);
  }

  /** Coalesce a burst of events for `folder` into a single listener call,
   *  with a max-wait cap so a sustained burst can't starve the listener. */
  private schedule(folder: Folder): void {
    if (this.disposed) return;
    const existing = this.pending.get(folder);
    if (existing) {
      // Reset the short coalesce timer; keep the max-wait timer untouched so
      // the cap is measured from the burst's start, not the latest event.
      globalThis.clearTimeout(existing.debounce);
      existing.debounce = globalThis.setTimeout(() => this.flush(folder), DEBOUNCE_MS);
      return;
    }
    // First event of a new burst: arm both timers. The debounce timer resets
    // on subsequent events; the max-wait timer does not, bounding the burst.
    const debounce = globalThis.setTimeout(() => this.flush(folder), DEBOUNCE_MS);
    const maxWait = globalThis.setTimeout(() => this.flush(folder), MAX_WAIT_MS);
    this.pending.set(folder, { debounce, maxWait });
  }

  /** Fire the listener for `folder` and clear its pending timers. */
  private flush(folder: Folder): void {
    const entry = this.pending.get(folder);
    if (entry) {
      globalThis.clearTimeout(entry.debounce);
      globalThis.clearTimeout(entry.maxWait);
      this.pending.delete(folder);
    }
    if (!this.disposed) this.listener(folder);
  }

  /** Stop the watcher and clear all timers (debounce, max-wait, recreate
   *  backoff). Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.recreateTimer) globalThis.clearTimeout(this.recreateTimer);
    this.recreateTimer = null;
    for (const entry of this.pending.values()) {
      globalThis.clearTimeout(entry.debounce);
      globalThis.clearTimeout(entry.maxWait);
    }
    this.pending.clear();
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        /* already closed — ignore */
      }
      this.watcher = null;
    }
  }
}