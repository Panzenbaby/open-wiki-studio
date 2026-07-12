// Update badge in the app bar + the two update dialogs. Subscribes to the
// `UpdateEvent` stream from the main process, runs it through the pure
// `applyUpdateEvent` reducer, and reflects the resulting `UpdateStatus` as:
//   idle         → nothing
//   available    → pulsing red icon (click → "update available" dialog)
//   downloading  → circular progress ring (percent)
//   ready        → static badge (click → "restart now / next launch" dialog;
//                  the dialog also auto-opens the moment the download finishes)
import { useEffect, useState } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { ArrowDownCircle } from "lucide-react";
import { api } from "../ipc.ts";
import { useT } from "../i18n.ts";
import { applyUpdateEvent } from "../update-state.ts";
import {
  updateStateAtom,
  lastAvailableInfoAtom,
  currentVersionAtom,
  toastAtom,
} from "../store.ts";
import type { UpdateEvent, UpdateInfo } from "../../shared/ipc-types.ts";
import { Modal } from "./Modal.tsx";

type Dialog = "available" | "ready" | null;

export function UpdateBadge(): JSX.Element | null {
  const t = useT();
  const state = useAtomValue(updateStateAtom);
  const setToast = useSetAtom(toastAtom);
  const currentVersion = useAtomValue(currentVersionAtom);
  const store = useStore();
  const [dialog, setDialog] = useState<Dialog>(null);

  // Subscribe to the update event stream for the lifetime of the app bar.
  // Read fresh state per event from the store — a closure over `state` would
  // freeze the initial `idle` value (deps can't include state without
  // re-subscribing on every change and dropping in-flight events). The store
  // is a stable Jotai instance, so the subscription stays registered once
  // while always reducing against the latest state.
  useEffect(() => {
    return api.onUpdateEvent((event: UpdateEvent) => {
      const prev = store.get(updateStateAtom);
      const prevLastAvailable = store.get(lastAvailableInfoAtom);
      const out = applyUpdateEvent(prev, prevLastAvailable, event);
      store.set(updateStateAtom, out.state);
      store.set(lastAvailableInfoAtom, out.lastAvailable);
      if (out.errorToast) {
        setToast({ message: t("update.downloadFailed"), kind: "error" });
      }
    });
  }, [store, setToast, t]);

  // Auto-open the "ready" dialog the moment the download completes.
  useEffect(() => {
    if (state.status === "ready" && dialog === null) {
      setDialog("ready");
    }
  }, [state.status, dialog]);

  if (state.status === "idle") return null;

  if (state.status === "downloading") {
    return <ProgressRing percent={state.percent} label={t("update.tooltipDownloading")} />;
  }

  const isReady = state.status === "ready";
  const tooltip = isReady ? t("update.tooltipReady") : t("update.tooltipAvailable");
  const info: UpdateInfo = state.info;

  return (
    <>
      <button
        className={`iconbtn update-badge${isReady ? " ready" : " available"}`}
        onClick={() => setDialog(isReady ? "ready" : "available")}
        title={tooltip}
        aria-label={tooltip}
      >
        <ArrowDownCircle size={16} />
      </button>

      {dialog === "available" && (
        <Modal
          title={t("update.availableTitle")}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setDialog(null)}>
                {t("update.later")}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  void api.downloadUpdate();
                  setDialog(null);
                }}
              >
                {t("update.install")}
              </button>
            </>
          }
        >
          <p>{t("update.availableDesc", { version: info.version, current: currentVersion })}</p>
          <p className="fg2" style={{ marginTop: "var(--space-3)" }}>{t("update.availableHint")}</p>
        </Modal>
      )}

      {dialog === "ready" && (
        <Modal
          title={t("update.readyTitle")}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setDialog(null)}>
                {t("update.nextLaunch")}
              </button>
              <button className="btn btn-primary" onClick={() => void api.installUpdateNow()}>
                {t("update.restartNow")}
              </button>
            </>
          }
        >
          <p>{t("update.readyDesc", { version: info.version })}</p>
          <p className="fg2" style={{ marginTop: "var(--space-3)" }}>{t("update.readyHint")}</p>
        </Modal>
      )}
    </>
  );
}

// Circular progress ring shown in place of the badge while downloading.
function ProgressRing({ percent, label }: { percent: number; label: string }): JSX.Element {
  const size = 18;
  const stroke = 2;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * (percent / 100);
  return (
    <span
      className="update-ring"
      role="status"
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
    </span>
  );
}
