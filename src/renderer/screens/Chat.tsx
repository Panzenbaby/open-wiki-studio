import { useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { AlertTriangle, HelpCircle, RefreshCw, Send, Square } from "lucide-react";
import { api } from "../ipc.ts";
import { useT } from "../i18n.ts";
import { chatErrorAtom, chatStreamingAtom, currentSessionAtom, messagesAtom } from "../store.ts";
import { stripQueryCommand } from "../../shared/text.ts";
import type { Result } from "../../shared/ipc-types.ts";
import { Message } from "../components/Message.tsx";

export function Chat(): JSX.Element {
  const t = useT();
  const messages = useAtomValue(messagesAtom);
  const [streaming, setStreaming] = useAtom(chatStreamingAtom);
  const [chatError, setChatError] = useAtom(chatErrorAtom);
  const current = useAtomValue(currentSessionAtom);
  const setMessages = useSetAtom(messagesAtom);
  const [input, setInput] = useState("");
  // Send/retry debounce for the brief window before `agent_start` flips
  // `chatStreamingAtom` (we no longer set streaming optimistically, so a
  // command that starts no turn cannot leave the composer stuck).
  const [pending, setPending] = useState(false);
  const firstUser = messages.find((m) => m.role === "user")?.text;
  const title = (firstUser ? stripQueryCommand(firstUser) : "") || current?.name || t("chat.titleFallback");
  const streamRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef<boolean>(true);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  function autosizeInput(): void {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => {
    autosizeInput();
  }, [input]);

  function handleScroll(): void {
    const el = streamRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedRef.current = distanceFromBottom < 32;
  }

  useEffect(() => {
    const el = streamRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  // Shared turn runner: evaluates the Result of `ask`/`retryChat` and surfaces
  // synchronous failures as the chat error banner. `chatStreamingAtom` is
  // NOT touched here — it is driven solely by the `agent_start`/`agent_end`
  // events handled in App.tsx, so a command that starts no turn does not leave
  // the composer stuck.
  async function runTurn(action: Promise<Result<void>>): Promise<void> {
    try {
      const result = await action;
      if (!result.success) setChatError(result.error.message);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error));
    }
  }

  async function send(): Promise<void> {
    const question = input.trim();
    if (!question || pending) return;
    setInput("");
    setChatError(null);
    setPending(true);
    setMessages((prev) => [...prev, { role: "user", text: question }]);
    try {
      await runTurn(api.ask(question));
    } finally {
      setPending(false);
    }
  }

  async function stop(): Promise<void> {
    if (!streaming) return;
    try {
      const result = await api.abortChat();
      if (!result.success) {
        setChatError(result.error.message);
      } else {
      // abortChat() resolves only after the agent is idle. agent_end does NOT
      // fire for an abort of an already-idle session, so clear the streaming
      // flag here to avoid a stuck Stop button.
        setStreaming(false);
      }
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error));
    }
  }

  async function retry(): Promise<void> {
    if (streaming || pending) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    setChatError(null);
    setPending(true);
    // Remove the last assistant message unconditionally (empty OR partial) so
    // the new turn streams a fresh assistant bubble. The failed assistant
    // stays on the append-only disk path but is dropped by `extractMessages`,
    // and the duplicate user entry from re-prompting is collapsed there too —
    // so the history stays clean after a restart without destructive session
    // mutation.
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant") return prev.slice(0, -1);
      return prev;
    });
    try {
      await runTurn(api.retryChat(lastUser.text));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="chat">
      <div className="chat-head">
        <div>
          <div className="h-title">{title.length > 60 ? `${title.slice(0, 60)}${t("app.ellipsis")}` : title}</div>
          <div className="h-sub">{t("chat.command")}</div>
        </div>
      </div>
      <div className="chat-stream" ref={streamRef} onScroll={handleScroll}>
        <div className="thread">
          {messages.length === 0 && (
            <div className="empty">
              <div className="glyph"><HelpCircle size={28} /></div>
              <div className="e-title">{t("chat.emptyTitle")}</div>
              <div className="e-sub">{t("chat.emptySub")}</div>
            </div>
          )}
          {messages.map((message, index) => (
            <Message key={index} role={message.role} text={message.text} />
          ))}
          {streaming && !chatError && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="msg msg-agent">
              <div className="avatar">{t("app.avatar")}</div>
              <div className="bubble">
                <div className="content working"><span className="dots"><span /><span /><span /></span></div>
              </div>
            </div>
          )}
          {chatError && (
            <div className="msg msg-agent msg-error">
              <div className="avatar error-avatar"><AlertTriangle size={14} /></div>
              <div className="bubble">
                <div className="content error-bubble">
                  <p>{t("chat.errorPrefix")}: {chatError}</p>
                  <button className="btn btn-sm btn-ghost" onClick={retry} disabled={streaming}>
                    <RefreshCw size={14} />
                    <span>{t("chat.retry")}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="composer">
        <div className="box">
          <div className="field-wrap">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={t("chat.placeholder")}
              rows={1}
            />
            {streaming ? (
              <button
                className="send"
                disabled={false}
                aria-label={t("chat.stop")}
                title={t("chat.stop")}
                onClick={() => void stop()}
              >
                <Square size={16} />
              </button>
            ) : (
              <button className="send" disabled={!input.trim() || pending} onClick={() => void send()}>
                <Send size={16} />
              </button>
            )}
          </div>
          <div className="composer-hint">
            <span>{t("chat.hintSend")}</span>
            <span>{t("chat.hintAuto")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}