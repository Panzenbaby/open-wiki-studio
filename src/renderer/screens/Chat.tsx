import { useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { AlertTriangle, HelpCircle, RefreshCw, Send } from "lucide-react";
import { api } from "../ipc.ts";
import { useT } from "../i18n.ts";
import { chatErrorAtom, chatStreamingAtom, currentSessionAtom, messagesAtom } from "../store.ts";
import { stripQueryCommand } from "../../shared/text.ts";
import { Message } from "../components/Message.tsx";

export function Chat(): JSX.Element {
  const t = useT();
  const messages = useAtomValue(messagesAtom);
  const [streaming, setStreaming] = useAtom(chatStreamingAtom);
  const [chatError, setChatError] = useAtom(chatErrorAtom);
  const current = useAtomValue(currentSessionAtom);
  const setMessages = useSetAtom(messagesAtom);
  const [input, setInput] = useState("");
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

  async function send(): Promise<void> {
    const question = input.trim();
    if (!question || streaming) return;
    setInput("");
    setChatError(null);
    setStreaming(true);
    setMessages((prev) => [...prev, { role: "user", text: question }]);
    try {
      const result = await api.ask(question);
      if (!result.success) {
        setStreaming(false);
        setChatError(result.error.message);
      }
    } catch (error) {
      setStreaming(false);
      setChatError(error instanceof Error ? error.message : String(error));
    }
  }

  function retry(): void {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    setChatError(null);
    setStreaming(true);
    // Remove any empty/incomplete assistant message from the previous attempt
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant" && last.text.trim() === "") {
        return prev.slice(0, -1);
      }
      return prev;
    });
    void (async () => {
      try {
        const result = await api.ask(lastUser.text);
        if (!result.success) {
          setStreaming(false);
          setChatError(result.error.message);
        }
      } catch (error) {
        setStreaming(false);
        setChatError(error instanceof Error ? error.message : String(error));
      }
    })();
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
                  <p>{chatError}</p>
                  <button className="btn btn-sm btn-ghost" onClick={retry}>
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
            <button className="send" disabled={!input.trim() || streaming} onClick={() => void send()}><Send size={16} /></button>
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