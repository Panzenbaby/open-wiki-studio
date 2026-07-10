import { useEffect, useRef, useState, type ReactNode } from "react";

export interface ContextMenuItem {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly onClick: () => void;
  /** Disable the item (shown greyed, not clickable). */
  readonly disabled?: boolean;
}

export interface ContextMenuPosition {
  readonly x: number;
  readonly y: number;
}

interface ContextMenuProps {
  readonly position: ContextMenuPosition;
  readonly items: readonly ContextMenuItem[];
  readonly onClose: () => void;
}

/**
 * Lightweight custom right-click menu. Renders a full-screen transparent
 * backdrop to catch outside clicks/Escape, plus a positioned menu near the
 * cursor, clamped to the viewport.
 */
export function ContextMenu(props: ContextMenuProps): JSX.Element | null {
  const { position, items, onClose } = props;
  const menuRef = useRef<HTMLDivElement>(null);
  const [clamped, setClamped] = useState<{ left: number; top: number }>({
    left: position.x,
    top: position.y,
  });

  // Clamp into the viewport once mounted (so we know the menu size).
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 4;
    const left = Math.min(
      position.x,
      Math.max(pad, window.innerWidth - rect.width - pad),
    );
    const top = Math.min(
      position.y,
      Math.max(pad, window.innerHeight - rect.height - pad),
    );
    setClamped({ left, top });
  }, [position.x, position.y]);

  // Close on Escape.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="ctx-backdrop"
      onClick={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
      role="presentation"
    >
      <div
        ref={menuRef}
        className="ctx-menu"
        style={{ left: clamped.left, top: clamped.top }}
        role="menu"
        onClick={(event) => event.stopPropagation()}
      >
        {items.map((item, index) => (
          <button
            key={index}
            type="button"
            role="menuitem"
            className="ctx-item"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onClick();
              onClose();
            }}
          >
            {item.icon ? <span className="ctx-icon">{item.icon}</span> : null}
            <span className="ctx-label">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}