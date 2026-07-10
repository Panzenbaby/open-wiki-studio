import { useEffect, useRef } from "react";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { api } from "./ipc.ts";
import {
  chatErrorAtom,
  chatStreamingAtom,
  chatTurnEndedAtom,
  currentSessionAtom,
  ingestStateAtom,
  ingestStreamAtom,
  ingestSummaryAtom,
  ingestErrorAtom,
  messagesAtom,
  platformAtom,
  recentWorkspacesAtom,
  screenAtom,
  streamingSessionsAtom,
  type ChatMessage,
} from "./store.ts";
import { useT, localeAtom } from "./i18n.ts";
import { WorkspacePicker } from "./screens/WorkspacePicker.tsx";
import { FirstRun } from "./screens/FirstRun.tsx";
import { AppShell } from "./components/AppShell.tsx";
import { Toast } from "./components/Toast.tsx";

export function App(): JSX.Element {
  const t = useT();
  const locale = useAtomValue(localeAtom);
  const tRef = useRef(t);
  tRef.current = t;

  const [screen, setScreen] = useAtom(screenAtom);
  const setRecent = useSetAtom(recentWorkspacesAtom);
  const setPlatform = useSetAtom(platformAtom);
  const setMessages = useSetAtom(messagesAtom);
  const setChatStreaming = useSetAtom(chatStreamingAtom);
  const setChatError = useSetAtom(chatErrorAtom);
  const setIngestState = useSetAtom(ingestStateAtom);
  const setIngestStream = useSetAtom(ingestStreamAtom);
  const setIngestSummary = useSetAtom(ingestSummaryAtom);
  const setIngestError = useSetAtom(ingestErrorAtom);
  const bumpTurnEnded = useSetAtom(chatTurnEndedAtom);
  const setStreamingSessions = useSetAtom(streamingSessionsAtom);
  const store = useStore();

  // Set the document title to the localized app name.
  useEffect(() => {
    document.title = t("app.name");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  // Bootstrap: list recent workspaces + detect platform; start at the picker.

  useEffect(() => {
    void (async () => {
      const recent = await api.listRecentWorkspaces();
      if (recent.success) setRecent(recent.data);
      const self = await api.getAppSelf();
      if (self.success) setPlatform(self.data.platform);
      setScreen("picker");
    })();
  }, [setRecent, setScreen, setPlatform]);

  // Route chat events by sessionPath: only the current session updates
  // messagesAtom/chatStreamingAtom; background sessions update streamingSessionsAtom.
  useEffect(() => {
    return api.onAgentEvent((event) => {
      const currentPath = store.get(currentSessionAtom)?.path;
      if (event.type === "agent_start") {
        const isCurrent = event.sessionPath === currentPath;
        setStreamingSessions((prev) =>
          prev.has(event.sessionPath) ? prev : new Set(prev).add(event.sessionPath),
        );
        if (isCurrent) {
          setChatError(null);
          setChatStreaming(true);
        }
      } else if (event.type === "text_delta") {
        if (event.sessionPath === currentPath) {
          setChatError(null);
          setMessages((prev) => updateLastAssistant(prev, event.delta));
        }
      } else if (event.type === "agent_end") {
        const isCurrent = event.sessionPath === currentPath;
        setStreamingSessions((prev) => {
          if (!prev.has(event.sessionPath)) return prev;
          const next = new Set(prev);
          next.delete(event.sessionPath);
          return next;
        });
        // Keep session list fresh so sidebar names + streaming dots stay current.
        bumpTurnEnded((n) => n + 1);
        if (isCurrent) {
          setChatStreaming(false);
          if (event.lastError) {
            // The turn failed (stopReason "error") — show the real error
            // immediately instead of the generic "no response" banner.
            setChatError(event.lastError);
          } else if (!event.aborted) {
            // A deliberately aborted turn (Stop button) must not surface a red
            // "no response" error banner — the user chose to stop. Only flag a
            // missing response for non-aborted turns that produced nothing.
            const messages = store.get(messagesAtom);
            const last = messages[messages.length - 1];
            if (!last || last.role !== "assistant" || last.text.trim() === "") {
              setChatError(tRef.current("chat.errorNoResponse"));
            }
          }
        }
      } else if (event.type === "error") {
        const isCurrent = event.sessionPath === currentPath;
        setStreamingSessions((prev) => {
          if (!prev.has(event.sessionPath)) return prev;
          const next = new Set(prev);
          next.delete(event.sessionPath);
          return next;
        });
        if (isCurrent) {
          setChatStreaming(false);
          setChatError(event.message);
        }
      }
    });
  }, [setChatStreaming, setChatError, setMessages, bumpTurnEnded, setStreamingSessions, store]);

  // Ingest event stream + summary.
  useEffect(() => {
    const offIngest = api.onIngestEvent((event) => {
      if (event.type === "agent_start") {
        setIngestError(null);
        setIngestState("running");
        setIngestStream("");
      } else if (event.type === "text_delta") {
        setIngestStream((prev) => prev + event.delta);
      } else if (event.type === "agent_end") {
        if (event.lastError) {
          // Turn failed (stopReason "error") — surface the real error and
          // reset to idle instead of showing a misleading "done". This is
          // the redundant path to the IPC return value from repo.ingest();
          // both carry the same failure so the user never sees a silent
          // "done" when the provider was unreachable/misconfigured.
          setIngestState("idle");
          setIngestError(event.lastError);
        } else {
          setIngestState("done");
        }
      } else if (event.type === "error") {
        setIngestState("idle");
        setIngestError(event.message);
      }
    });
    const offSummary = api.onIngestSummary((summary) => {
      setIngestSummary(summary);
      // The summary is sent by the main process only after the ingest fully
      // completes (including any agent turn). It is the reliable completion
      // signal for conformant-only runs, which trigger NO agent_start/agent_end
      // events — without this, those runs would stay stuck on "running".
      setIngestState("done");
    });
    return () => {
      offIngest();
      offSummary();
    };
  }, [setIngestState, setIngestStream, setIngestSummary, setIngestError]);

  if (screen === "loading") {
    return (
      <div className="shell" style={{ placeItems: "center", display: "grid", color: "var(--muted)" }}>
        {t("app.loading")}
      </div>
    );
  }
  if (screen === "picker" || screen === "first-run") {
    return (
      <>
        <div className="shell">{screen === "picker" ? <WorkspacePicker /> : <FirstRun />}</div>
        <Toast />
      </>
    );
  }
  return (
    <>
      <AppShell />
      <Toast />
    </>
  );
}

function updateLastAssistant(messages: readonly ChatMessage[], delta: string): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") {
    return [...messages, { role: "assistant", text: delta }];
  }
  return [...messages.slice(0, -1), { role: "assistant", text: last.text + delta }];
}