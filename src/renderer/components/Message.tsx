import { useSetAtom } from "jotai";
import { Copy } from "lucide-react";
import { useT } from "../i18n.ts";
import { toastAtom } from "../store.ts";
import { MarkdownView } from "./MarkdownView.tsx";

interface MessageProps {
  role: "user" | "assistant";
  text: string;
  isComplete: boolean;
}

export function Message(props: MessageProps): JSX.Element {
  const t = useT();
  const setToast = useSetAtom(toastAtom);

  async function copyMessage(): Promise<void> {
    try {
      await navigator.clipboard.writeText(props.text);
      setToast({ message: t("chat.copySuccess"), kind: "info" });
    } catch {
      setToast({ message: t("chat.copyFailed"), kind: "error" });
    }
  }

  function copyButton(): JSX.Element | null {
    if (!props.isComplete) return null;
    const label = t("chat.copyMessage");
    return (
      <button
        type="button"
        className="btn btn-sm btn-ghost msg-copy"
        aria-label={label}
        title={label}
        onClick={() => void copyMessage()}
      >
        <Copy size={14} aria-hidden="true" />
      </button>
    );
  }

  if (props.role === "user") {
    return (
      <div className="msg msg-user">
        <div className="avatar">{t("chat.roleUser").slice(0, 2)}</div>
        <div className="bubble">
          <div className="msg-heading">
            <div className="role">{t("chat.roleUser")}</div>
            {copyButton()}
          </div>
          <div className="content">{props.text}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="msg msg-agent">
      <div className="avatar">{t("app.avatar")}</div>
      <div className="bubble">
        <div className="msg-heading">
          <div className="role">{t("chat.roleAgent")}</div>
          {copyButton()}
        </div>
        <div className="content">
          <MarkdownView source={props.text} />
        </div>
      </div>
    </div>
  );
}
