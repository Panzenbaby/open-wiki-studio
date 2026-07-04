import { useT } from "../i18n.ts";
import { MarkdownView } from "./MarkdownView.tsx";

interface MessageProps {
  role: "user" | "assistant";
  text: string;
}

export function Message(props: MessageProps): JSX.Element {
  const t = useT();

  if (props.role === "user") {
    return (
      <div className="msg msg-user">
        <div className="avatar">{t("chat.roleUser").slice(0, 2)}</div>
        <div className="bubble">
          <div className="role">{t("chat.roleUser")}</div>
          <div className="content">{props.text}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="msg msg-agent">
      <div className="avatar">{t("app.avatar")}</div>
      <div className="bubble">
        <div className="role">{t("chat.roleAgent")}</div>
        <div className="content">
          <MarkdownView source={props.text} />
        </div>
      </div>
    </div>
  );
}