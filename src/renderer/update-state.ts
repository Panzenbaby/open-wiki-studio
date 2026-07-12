// Pure reducer that maps an incoming `UpdateEvent` onto the `UpdateStatus`
// state machine. Extracted from the React component so the update flow is
// unit-testable without a DOM: the badge component delegates to this and
// only owns the Jotai wiring + dialogs.
//
// Error-on-download semantics (per UX spec): a download error reverts the
// badge to the pulsing "available" state using the last known update info,
// and signals `errorToast: true` so the component can surface a toast.
// Errors that arrive while idle (e.g. a check-phase error that leaked
// through) are ignored — start-check failures must stay silent.
import type { UpdateEvent, UpdateInfo, UpdateStatus } from "../shared/ipc-types.ts";

export interface UpdateReducerOutput {
  /** New badge state to write to `updateStateAtom`. */
  readonly state: UpdateStatus;
  /** New last-known available info (for reverting after a download error). */
  readonly lastAvailable: UpdateInfo | null;
  /** Whether the component should show the download-failed toast. */
  readonly errorToast: boolean;
  /** Raw reason text (from the SDK error event) when `errorToast` is true,
   *  so the toast can surface the actual cause (e.g. signature mismatch)
   *  instead of a generic message. `null` when no error is being surfaced. */
  readonly errorMessage: string | null;
}

export function applyUpdateEvent(
  prev: UpdateStatus,
  prevLastAvailable: UpdateInfo | null,
  event: UpdateEvent,
): UpdateReducerOutput {
  switch (event.type) {
    case "available":
      return { state: { status: "available", info: event.info }, lastAvailable: event.info, errorToast: false, errorMessage: null };

    case "progress": {
      const info = prevLastAvailable ?? infoOf(prev);
      if (!info) return { state: prev, lastAvailable: prevLastAvailable, errorToast: false, errorMessage: null };
      return { state: { status: "downloading", info, percent: event.percent }, lastAvailable: prevLastAvailable, errorToast: false, errorMessage: null };
    }

    case "downloaded":
      return { state: { status: "ready", info: event.info }, lastAvailable: event.info, errorToast: false, errorMessage: null };

    case "error": {
      // Only surface errors that occur during the download flow; silent
      // otherwise (check-phase failures are swallowed in the repository).
      const wasDownloading = prev.status === "downloading" || prev.status === "available";
      if (!wasDownloading) return { state: prev, lastAvailable: prevLastAvailable, errorToast: false, errorMessage: null };
      const info = prevLastAvailable ?? infoOf(prev);
      return {
        state: info ? { status: "available", info } : { status: "idle" },
        lastAvailable: info,
        errorToast: info !== null,
        errorMessage: info !== null ? event.message : null,
      };
    }
  }
}

/** Extracts the `UpdateInfo` carried by a non-idle state, if any. */
function infoOf(state: UpdateStatus): UpdateInfo | null {
  switch (state.status) {
    case "available":
    case "downloading":
    case "ready":
      return state.info;
    case "idle":
      return null;
  }
}
