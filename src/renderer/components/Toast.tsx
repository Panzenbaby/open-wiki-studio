import { useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { toastAtom, type ToastKind } from "../store.ts";

/**
 * Fixed-position toast. Reads `toastAtom`; auto-dismisses after a timeout.
 * The `kind` controls the status dot colour (info=success green, warning=warn
 * orange, error=danger red).
 */
// `kind` → CSS modifier class. A new kind lands as an `undefined` entry here,
// which TS flags at the call site (indexed access on a closed record) rather
// than silently rendering an unstyled toast.
const TOAST_KIND_CLASS: Record<ToastKind, string> = {
  info: "",
  warning: " warn",
  error: " err",
};

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
    <div
      className={`toast${TOAST_KIND_CLASS[toast.kind]}${visible ? " show" : ""}`}
      role="alert"
    >
      <span className="t-dot" />
      <span>{toast.message}</span>
    </div>
  );
}