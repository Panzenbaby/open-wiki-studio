// Reusable modal: a full-screen backdrop that catches outside clicks and
// Escape, with a centred card. Focus moves into the card on open, Tab cycles
// within it, and the previously focused element gets focus back on close.
// No hardcoded strings — callers bring their own i18n titles.
//
// Rendered through a portal into <body>: the backdrop is position:fixed, and
// any ancestor with a transform (the mobile sidebar drawer) would otherwise
// become its containing block and clip the dialog into that ancestor.
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

interface ModalProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Action row (buttons). Rendered at the bottom of the card. */
  readonly footer?: ReactNode;
}

export function Modal({ title, onClose, children, footer }: ModalProps): JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null);

  // Close on Escape. Callers usually pass an inline `onClose`, so this effect
  // re-subscribes on every render — keep it free of focus side effects.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Focus management: runs once per mount so the initial focus is not reset
  // and the restore target is not overwritten by a re-render.
  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    function focusableElements(): readonly HTMLElement[] {
      const card = cardRef.current;
      if (!card) return [];
      return Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    }

    const initialTarget = focusableElements()[0] ?? cardRef.current;
    initialTarget?.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Tab") return;
      const card = cardRef.current;
      if (!card) return;

      const elements = focusableElements();
      if (elements.length === 0) {
        event.preventDefault();
        card.focus();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !card.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !card.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      // The confirmed action often unmounts the trigger (deleting a session
      // removes the row that held focus) — focusing a detached node silently
      // drops focus to <body>.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, []);

  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <h2 className="modal-title">{title}</h2>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
