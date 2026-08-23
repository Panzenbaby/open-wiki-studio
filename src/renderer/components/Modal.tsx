// Reusable modal: a full-screen backdrop that catches outside clicks and
// Escape, with a centred card. Mirrors the lightweight overlay pattern used
// by ContextMenu but for dialog-style content. No hardcoded strings — callers
// bring their own i18n titles.
import { useEffect, useRef, type ReactNode } from "react";

interface ModalProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Action row (buttons). Rendered at the bottom of the card. */
  readonly footer?: ReactNode;
}

export function Modal({ title, onClose, children, footer }: ModalProps): JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null);

  // Focus trap and Escape handling
  useEffect(() => {
    // 1. Remember the previously focused element to restore it on close.
    const previousFocus = document.activeElement as HTMLElement | null;

    // 2. Focus the first focusable element inside the modal on open.
    const focusableElements = cardRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusableElements && focusableElements.length > 0) {
      focusableElements[0].focus();
    } else {
      cardRef.current?.focus();
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      // Tab trapping
      if (event.key === "Tab" && cardRef.current) {
        const elements = cardRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (elements.length === 0) {
          event.preventDefault();
          return;
        }

        const first = elements[0];
        const last = elements[elements.length - 1];

        if (event.shiftKey) {
          if (document.activeElement === first) {
            last.focus();
            event.preventDefault();
          }
        } else {
          if (document.activeElement === last) {
            first.focus();
            event.preventDefault();
          }
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      // Restore focus
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={cardRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="modal-title">{title}</h2>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
