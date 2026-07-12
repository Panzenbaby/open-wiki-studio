// Reusable modal: a full-screen backdrop that catches outside clicks and
// Escape, with a centred card. Mirrors the lightweight overlay pattern used
// by ContextMenu but for dialog-style content. Keeps focus inside the card
// while open. No hardcoded strings — callers bring their own i18n titles.
import { useEffect, type ReactNode } from "react";

interface ModalProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Action row (buttons). Rendered at the bottom of the card. */
  readonly footer?: ReactNode;
}

export function Modal({ title, onClose, children, footer }: ModalProps): JSX.Element {
  // Close on Escape.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="modal-title">{title}</h2>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
