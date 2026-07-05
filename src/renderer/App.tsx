import { useEffect, useRef } from "react";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { api } from "./ipc.ts";
import {
  chatErrorAtom,
  chatStreamingAtom,
  chatTurnEndedAtom,
  ingestStateAtom,
  ingestStreamAtom,
  ingestSummaryAtom,
  ingestErrorAtom,
  messagesAtom,
  platformAtom,
  recentWorkspacesAtom,
  screenAtom,
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

  // Chat event stream -> messages.
  useEffect(() => {
    return api.onAgentEvent((event) => {
      if (event.type === "agent_start") {
        setChatError(null);
        setChatStreaming(true);
      } else if (event.type === "text_delta") {
        setChatError(null);
        setMessages((prev) => updateLastAssistant(prev, event.delta));
      } else if (event.type === "agent_end") {
        setChatStreaming(false);
        bumpTurnEnded((n) => n + 1);
        // Read the latest messages from the store directly instead of
        // calling setChatError inside a setMessages updater (a side effect
        // during render). The store always reflects the current value.
        const messages = store.get(messagesAtom);
        const last = messages[messages.length - 1];
        if (!last || last.role !== "assistant" || last.text.trim() === "") {
          setChatError(tRef.current("chat.errorNoResponse"));
        }
      } else if (event.type === "error") {
        setChatStreaming(false);
        setChatError(event.message);
      }
    });
  }, [setChatStreaming, setChatError, setMessages, bumpTurnEnded, store]);

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
        setIngestState("done");
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