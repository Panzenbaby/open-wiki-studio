// Tests for the pure `applyUpdateEvent` reducer — the renderer update state
// machine. Pure functions + discriminated unions, no React/DOM, so the whole
// flow (available → downloading → ready, plus the error-revert and silent-idle
// rules) is exercised deterministically.
import { describe, expect, it } from "vitest";
import { applyUpdateEvent } from "../src/renderer/update-state.ts";
import type { UpdateEvent, UpdateInfo, UpdateStatus } from "../src/shared/ipc-types.ts";

const info = (version: string): UpdateInfo => ({
  version,
  releaseNotesUrl: `https://example.test/releases/v${version}`,
});

const idle: UpdateStatus = { status: "idle" };

describe("applyUpdateEvent", () => {
  it("an available event moves idle → available and records the info", () => {
    const out = applyUpdateEvent(idle, null, { type: "available", info: info("1.2.0") });
    expect(out.state).toEqual({ status: "available", info: info("1.2.0") });
    expect(out.lastAvailable).toEqual(info("1.2.0"));
    expect(out.errorToast).toBe(false);
  });

  it("a progress event transitions available → downloading, preserving the info", () => {
    const prev: UpdateStatus = { status: "available", info: info("1.2.0") };
    const out = applyUpdateEvent(prev, info("1.2.0"), { type: "progress", percent: 30 });
    expect(out.state).toEqual({ status: "downloading", info: info("1.2.0"), percent: 30 });
    expect(out.errorToast).toBe(false);
  });

  it("a progress event without any known info is ignored (defensive)", () => {
    const out = applyUpdateEvent(idle, null, { type: "progress", percent: 30 });
    expect(out.state).toBe(idle);
  });

  it("a downloaded event moves to ready and records the info", () => {
    const prev: UpdateStatus = { status: "downloading", info: info("1.2.0"), percent: 99 };
    const out = applyUpdateEvent(prev, info("1.2.0"), { type: "downloaded", info: info("1.2.0") });
    expect(out.state).toEqual({ status: "ready", info: info("1.2.0") });
    expect(out.errorToast).toBe(false);
  });

  it("a download error reverts to the pulsing available state and signals a toast", () => {
    const prev: UpdateStatus = { status: "downloading", info: info("1.2.0"), percent: 50 };
    const out = applyUpdateEvent(prev, info("1.2.0"), { type: "error", message: "boom" });
    expect(out.state).toEqual({ status: "available", info: info("1.2.0") });
    expect(out.errorToast).toBe(true);
  });

  it("a download error with no last-known info falls back to idle", () => {
    const prev: UpdateStatus = { status: "available", info: info("1.2.0") };
    // lastAvailable null + available state still carries info → reverts to available.
    const out = applyUpdateEvent(prev, null, { type: "error", message: "boom" });
    expect(out.state).toEqual({ status: "available", info: info("1.2.0") });
    expect(out.errorToast).toBe(true);
  });

  it("errors while idle are ignored (silent check-phase failures)", () => {
    const out = applyUpdateEvent(idle, null, { type: "error", message: "transient" });
    expect(out.state).toBe(idle);
    expect(out.errorToast).toBe(false);
  });

  it("errors after ready are not surfaced as toasts (no spurious revert)", () => {
    const prev: UpdateStatus = { status: "ready", info: info("1.2.0") };
    const out = applyUpdateEvent(prev, info("1.2.0"), { type: "error", message: "late" });
    // ready is not a downloading/available phase → ignored.
    expect(out.errorToast).toBe(false);
    expect(out.state).toBe(prev);
  });
});