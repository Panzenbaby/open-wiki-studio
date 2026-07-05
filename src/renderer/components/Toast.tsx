import { useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { toastAtom } from "../store.ts";

/**
 * Fixed-position toast. Reads `toastAtom`; auto-dismisses after a timeout.
 * The `kind` controls the status dot colour (info=success green, error=danger).
 */
export function Toast(): JSX.Element | null {
  const toast = useAtomValue(toastAtom);
  const setToast = useSetAtom(toastAtom);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const hide = window.setTimeout(() => {
      setVisible(false);
      // Allow the fade-out transition to play before clearing the atom.
      window.setTimeout(() => setToast(null), 250);
    }, 4000);
    return () => window.clearTimeout(hide);
  }, [toast, setToast]);

  if (!toast) return null;
  return (
    <div className={`toast${toast.kind === "error" ? " err" : ""}${visible ? " show" : ""}`} role="alert">
      <span className="t-dot" />
      <span>{toast.message}</span>
    </div>
  );
}