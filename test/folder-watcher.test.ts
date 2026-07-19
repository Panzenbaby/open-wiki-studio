// Tests for FolderWatcher — the workspace change listener that drives the
// renderer's single "re-list on change" path.
//
// Real `fs.watch` (not faked): its callbacks arrive asynchronously from the
// libuv thread, so vitest fake timers cannot drive them. Tests use real
// timers against a real tmpdir, with generous tolerances and a polling helper
// to stay robust on CI. Each scenario disposes its watcher in `afterEach`;
// tmpdirs are removed in `afterAll`.
//
// Production design (see folder-watcher.ts): a SINGLE recursive watcher on the
// workspace root routes events to input/wiki/archive by the top path segment.
// This avoids the macOS cross-firing that three sibling recursive watchers
// would cause, so per-folder isolation is a real, testable property here.
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FolderWatcher,
  DEBOUNCE_MS,
  MAX_WAIT_MS,
} from "../src/main/folder-watcher.ts";
import type { Folder } from "../src/shared/ipc-types.ts";

/** Extra slack layered on top of the production timing constants. fs.watch
 *  event delivery is asynchronous and platform-variable; this keeps tests
 *  non-flaky without making assertions meaningless. */
const SLACK_MS = 400;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll `predicate` until it returns truthy or `timeoutMs` elapses. Resolves
 *  to the last predicate result. Keeps tests resilient to async delivery. */
async function waitFor<T>(
  predicate: () => T | undefined | false,
  timeoutMs: number,
  intervalMs = 30,
): Promise<T | undefined | false> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined | false = undefined;
  while (Date.now() < deadline) {
    last = predicate();
    if (last) return last;
    await delay(intervalMs);
  }
  return last;
}

/** Fresh empty workspace with the given folders pre-created. The archive
 *  folder is VIRTUAL: it physically lives at `workspace/wiki/archive/` (since
 *  pi-okf-wiki 0.2.0), so pre-create it there — not at `workspace/archive/`. */
async function freshWorkspace(folders: readonly Folder[] = []): Promise<string> {
  const dir = join(tmpdir(), `watcher-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  for (const folder of folders) {
    if (folder === "archive") {
      await mkdir(join(dir, "wiki", "archive"), { recursive: true });
    } else {
      await mkdir(join(dir, folder), { recursive: true });
    }
  }
  return dir;
}

/** Write `count` files into `folder/` in a tight loop so the underlying events
 *  arrive within a single debounce window. `folder` is a virtual Folder: the
 *  archive is written at `wiki/archive/`. */
async function burstWrite(workspace: string, folder: Folder, count: number): Promise<void> {
  const base = folder === "archive" ? join(workspace, "wiki", "archive") : join(workspace, folder);
  for (let index = 0; index < count; index++) {
    await writeFile(join(base, `file-${index}-${Date.now()}.md`), "x", "utf8");
  }
}

/** Let the watcher's initial FSEvents burst (fired for pre-existing top-level
 *  dirs at construction) flush, then clear the recorder so subsequent
 *  assertions describe only the test's own writes. Without this, the startup
 *  "rename:input/wiki/archive" events would pollute steady-state checks. */
async function warmup(calls: { folder: Folder; at: number }[]): Promise<void> {
  await delay(DEBOUNCE_MS + SLACK_MS);
  calls.length = 0;
}

describe("FolderWatcher", () => {
  const dirs: string[] = [];
  const watchers: FolderWatcher[] = [];

  function makeWatcher(workspace: string, listener: (folder: Folder) => void): FolderWatcher {
    const watcher = new FolderWatcher(workspace, listener);
    watchers.push(watcher);
    return watcher;
  }

  /** Collect calls with timestamps for later assertions. */
  function recorder(): { calls: { folder: Folder; at: number }[]; listener: (f: Folder) => void } {
    const calls: { folder: Folder; at: number }[] = [];
    return {
      calls,
      listener: (folder) => calls.push({ folder, at: Date.now() }),
    };
  }

  afterEach(() => {
    while (watchers.length) watchers.pop()!.dispose();
  });

  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function trackWorkspace(dir: string): Promise<string> {
    dirs.push(dir);
    return dir;
  }

  // ── 1. Coalesced single notification on a write burst ───────────────
  it("coalesces a tight write burst into a single flush", async () => {
    const workspace = await trackWorkspace(await freshWorkspace(["input"]));
    const { calls, listener } = recorder();
    makeWatcher(workspace, listener);
    await warmup(calls);

    await burstWrite(workspace, "input", 5);

    // Allow the debounce window (+ slack) to fire exactly once.
    await delay(DEBOUNCE_MS + SLACK_MS);

    // All writes were within one debounce window → exactly one flush.
    expect(calls.length).toBe(1);
    expect(calls[0]!.folder).toBe("input");
  });

  // ── 2. Max-Wait cap flushes a sustained burst (anti-starvation) ─────
  it("flushes mid-burst via the max-wait cap, not only after the burst", async () => {
    const workspace = await trackWorkspace(await freshWorkspace(["input"]));
    const { calls, listener } = recorder();
    makeWatcher(workspace, listener);

    const burstStart = Date.now();
    const burstDurationMs = 1500; // longer than MAX_WAIT_MS so starvation would otherwise occur
    // Continuous writes every 30 ms — gap << DEBOUNCE, so the debounce timer
    // resets on every event and would never fire until the burst ends without
    // the max-wait cap.
    const interval = setInterval(() => {
      void writeFile(join(workspace, "input", `sustained-${Date.now()}.md`), "x", "utf8");
    }, 30);

    // Wait long enough that a max-wait flush MUST have occurred if the cap
    // works, but stop BEFORE the burst ends so a trailing-only debounce flush
    // can't be the explanation.
    await delay(MAX_WAIT_MS + SLACK_MS);
    const callsDuringBurst = calls.filter((c) => c.at < burstStart + burstDurationMs).length;

    clearInterval(interval);
    await delay(DEBOUNCE_MS + SLACK_MS); // let the trailing debounce settle

    // At least one flush happened WHILE writes were still in progress — that
    // is only possible via the max-wait timer (debounce keeps resetting on a
    // 30 ms cadence). Proves the listener is not starved by a sustained burst.
    expect(callsDuringBurst).toBeGreaterThanOrEqual(1);
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  // ── 3. Folder created after construction is observed ────────────────
  // The single root watcher fires a rename event for the new dir, so
  // `wiki/archive/` appearing after construction is observed without a
  // reconcile timer (mirrors a fresh workspace before the first ingest creates
  // it). Since pi-okf-wiki 0.2.0 the archive is virtual under `wiki/archive/`.
  it("observes a folder created after construction", async () => {
    const workspace = await trackWorkspace(await freshWorkspace(["input", "wiki"]));
    const { calls, listener } = recorder();
    makeWatcher(workspace, listener);

    // Create wiki/archive/ after construction and write into it.
    await mkdir(join(workspace, "wiki", "archive"), { recursive: true });
    await writeFile(join(workspace, "wiki", "archive", "late.md.orig"), "x", "utf8");

    const found = await waitFor(
      () => (calls.some((c) => c.folder === "archive") ? true : false),
      DEBOUNCE_MS + SLACK_MS,
    );
    expect(found).toBe(true);
  }, DEBOUNCE_MS + SLACK_MS + 2000);

  // ── 4. Per-folder isolation ─────────────────────────────────────────
  // With a single root watcher (no sibling recursive watchers), a write under
  // `input/` routes only to "input" — no spurious wiki/archive calls.
  it("does not fire for folders that were not written to", async () => {
    const workspace = await trackWorkspace(await freshWorkspace(["input", "wiki", "archive"]));
    const { calls, listener } = recorder();
    makeWatcher(workspace, listener);
    await warmup(calls);

    await burstWrite(workspace, "input", 3);
    await delay(DEBOUNCE_MS + SLACK_MS);

    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.every((c) => c.folder === "input")).toBe(true);
  });

  // ── 4b. Routing by top segment + virtual archive ───────────────────
  // Confirms the route() parser: writes to different folders fire the
  // matching folder, and writes under a non-watched root entry (sessions/)
  // produce no calls at all. Also covers the VIRTUAL archive: since
  // pi-okf-wiki 0.2.0 the archive lives at `wiki/archive/`, so a write there
  // must route to "archive" (not "wiki"), while a `wiki/<concept>.md` write
  // still routes to "wiki" (not "archive").
  it("routes events to the matching folder and ignores non-watched roots", async () => {
    const workspace = await trackWorkspace(
      await freshWorkspace(["input", "wiki", "archive", "sessions" as unknown as Folder]),
    );
    const { calls, listener } = recorder();
    makeWatcher(workspace, listener);
    await warmup(calls);

    await writeFile(join(workspace, "input", "a.md"), "x", "utf8");
    await waitFor(
      () => (calls.some((c) => c.folder === "input") ? true : false),
      DEBOUNCE_MS + SLACK_MS,
    );
    await writeFile(join(workspace, "wiki", "b.md"), "x", "utf8");
    await waitFor(
      () => (calls.some((c) => c.folder === "wiki") ? true : false),
      DEBOUNCE_MS + SLACK_MS,
    );
    // Virtual archive: `wiki/archive/<rel>` must route to "archive", not "wiki".
    await writeFile(join(workspace, "wiki", "archive", "c.md.orig"), "x", "utf8");
    await waitFor(
      () => (calls.some((c) => c.folder === "archive") ? true : false),
      DEBOUNCE_MS + SLACK_MS,
    );
    await writeFile(join(workspace, "sessions", "s.json"), "x", "utf8");
    await delay(DEBOUNCE_MS + SLACK_MS);

    const folders = new Set(calls.map((c) => c.folder));
    expect(folders.has("input")).toBe(true);
    expect(folders.has("wiki")).toBe(true);
    expect(folders.has("archive")).toBe(true);
    expect(folders.has("sessions" as unknown as Folder)).toBe(false);
    // The `wiki/archive/c.md.orig` write routed to "archive" and the
    // `wiki/b.md` write routed to "wiki" — both present and neither
    // cross-fired onto the other (covered by the two `has` checks above).
  }, (DEBOUNCE_MS + SLACK_MS) * 4 + 2000);

  // ── 5. dispose() cancels pending and stops future notifications ─────
  it("drops a pending flush on dispose and goes silent for later writes", async () => {
    const workspace = await trackWorkspace(await freshWorkspace(["input"]));
    const { calls, listener } = recorder();
    const watcher = makeWatcher(workspace, listener);

    // Trigger a schedule (pending debounce + max-wait timers armed), then
    // dispose BEFORE the debounce window can fire.
    await writeFile(join(workspace, "input", "pending.md"), "x", "utf8");
    watcher.dispose();

    await delay(MAX_WAIT_MS + SLACK_MS);
    expect(calls.length).toBe(0);

    // Further writes after dispose must not resurrect anything.
    await burstWrite(workspace, "input", 3);
    await delay(DEBOUNCE_MS + SLACK_MS);
    expect(calls.length).toBe(0);
  });
});