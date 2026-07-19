// Tests for `attachNotifyForwarding` — the seam that overrides an extension
// UI `notify` on a freshly-bound session so extension notifications reach the
// renderer instead of being swallowed by the default no-op UI context.
//
// The pool *call* of this helper lives inside `createLiveChatSession`, which
// the pool tests override (their test seam IS the override), so this module
// tests the helper's own contract directly: it spreads the existing UI
// context, overrides only `notify`, re-installs it, and the overridden
// `notify` emits a `notify` AgentEvent tagged with the session path — while
// the rest of the UI context is preserved.
import { describe, it, expect } from "vitest";
import { attachNotifyForwarding } from "../src/main/agent.ts";
import type { AgentEvent } from "../src/shared/ipc-types.ts";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

type NotifyFn = (message: string, type?: "info" | "warning" | "error") => void;

/** Minimal UI context shape: a `notify` plus one other no-op method, so the
 *  test can assert the spread preserves methods other than `notify`. */
interface FakeUiContext {
  notify: NotifyFn;
  setStatus: (key: string, text: string | undefined) => void;
}

/** A fake `AgentSession.extensionRunner`: records the last context installed
 *  via `setUIContext` and returns the base context from `getUIContext`. */
function fakeSession(baseNotify: NotifyFn): {
  session: AgentSession;
  installed: () => FakeUiContext | null;
} {
  let current: FakeUiContext = {
    notify: baseNotify,
    setStatus: () => {},
  };
  let lastInstalled: FakeUiContext | null = null;
  const runner = {
    getUIContext: (): FakeUiContext => current,
    setUIContext: (ctx: FakeUiContext): void => {
      lastInstalled = ctx;
      current = ctx;
    },
  };
  // Cast through `unknown` (not `any`): a plain object isn't structurally
  // assignable to the `AgentSession` class, but the helper only touches
  // `extensionRunner`, matching the existing pool-test cast convention.
  const session = { extensionRunner: runner } as unknown as AgentSession;
  return { session, installed: () => lastInstalled };
}

describe("attachNotifyForwarding", () => {
  it("emits a notify AgentEvent tagged with the session path", () => {
    const emitted: AgentEvent[] = [];
    const { session } = fakeSession(() => {});
    attachNotifyForwarding(session, "/path/to/session.md", (e) => emitted.push(e));

    // The installed context is what the extension actually calls; reach in via
    // the runner to invoke notify the way an extension would.
    const installed = session.extensionRunner.getUIContext();
    installed.notify("No wiki/ folder yet.", "warning");

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual({
      type: "notify",
      message: "No wiki/ folder yet.",
      notifyType: "warning",
      sessionPath: "/path/to/session.md",
    });
  });

  it("defaults notifyType to info when the extension omits the type", () => {
    const emitted: AgentEvent[] = [];
    const { session } = fakeSession(() => {});
    attachNotifyForwarding(session, "", (e) => emitted.push(e));
    session.extensionRunner.getUIContext().notify("just so you know");
    expect(emitted[0]).toEqual({
      type: "notify",
      message: "just so you know",
      notifyType: undefined,
      sessionPath: "",
    });
    expect(emitted[0].notifyType ?? "info").toBe("info");
  });

  it("overrides notify but preserves the other UI context methods", () => {
    let statusCalls = 0;
    const baseNotify = (): void => {};
    let current: FakeUiContext = {
      notify: baseNotify,
      setStatus: () => {
        statusCalls++;
      },
    };
    const runner = {
      getUIContext: (): FakeUiContext => current,
      setUIContext: (ctx: FakeUiContext): void => {
        current = ctx;
      },
    };
    const session = { extensionRunner: runner } as unknown as AgentSession;

    attachNotifyForwarding(session, "/p", () => {});

    const installed = runner.getUIContext();
    // notify was replaced (no longer the original baseNotify reference).
    expect(installed.notify).not.toBe(baseNotify);
    // setStatus was preserved by the spread and still works.
    installed.setStatus("okf-query", "Querying…");
    expect(statusCalls).toBe(1);
  });

  it("never calls the original base notify (the override fully shadows it)", () => {
    let baseCalled = false;
    const { session } = fakeSession(() => {
      baseCalled = true;
    });
    attachNotifyForwarding(session, "/p", () => {});
    session.extensionRunner.getUIContext().notify("hi", "info");
    expect(baseCalled).toBe(false);
  });
});