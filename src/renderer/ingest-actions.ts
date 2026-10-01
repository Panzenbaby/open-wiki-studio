// Starting a /wiki-update run from the renderer. Shared by the dashboard (which
// shows progress in place) and the ingest bar / ingest view (which switch to the
// ingest log first).
import { useCallback } from "react";
import { useSetAtom } from "jotai";
import { api } from "./ipc.ts";
import {
  ingestErrorAtom,
  ingestStateAtom,
  ingestStreamAtom,
  ingestSummaryAtom,
  viewAtom,
} from "./store.ts";

export interface IngestActions {
  /** Start a run and stay on the current view. */
  startIngest: () => Promise<void>;
  /** Switch to the ingest log, then start a run. */
  runIngest: () => Promise<void>;
}

export function useIngestActions(): IngestActions {
  const setView = useSetAtom(viewAtom);
  const setIngestError = useSetAtom(ingestErrorAtom);
  const setIngestState = useSetAtom(ingestStateAtom);
  const setIngestStream = useSetAtom(ingestStreamAtom);
  const setIngestSummary = useSetAtom(ingestSummaryAtom);

  // Resets the ingest state machine so the previous run's state does not
  // linger, and surfaces IPC-level errors (turn-level errors arrive via the
  // ingest event stream, see agent-events.ts).
  const startIngest = useCallback(async (): Promise<void> => {
    setIngestSummary(null);
    setIngestStream("");
    setIngestError(null);
    setIngestState("running");
    const result = await api.ingest();
    if (!result.success) {
      setIngestState("idle");
      setIngestError(result.error.message);
    }
  }, [setIngestError, setIngestState, setIngestStream, setIngestSummary]);

  const runIngest = useCallback(async (): Promise<void> => {
    setView("ingest");
    await startIngest();
  }, [setView, startIngest]);

  return { startIngest, runIngest };
}
