import { useAtomValue } from "jotai";
import { Play } from "lucide-react";
import { useT } from "../i18n.ts";
import { countsAtom, ingestStateAtom } from "../store.ts";

interface IngestBarProps {
  onRun: () => void;
  onView?: () => void;
}

export function IngestBar(props: IngestBarProps): JSX.Element | null {
  const t = useT();
  const counts = useAtomValue(countsAtom);
  const state = useAtomValue(ingestStateAtom);

  if (state === "running") {
    return (
      <div className="ingest-bar">
        <span className="pulse" />
        <div className="ib-text">
          <div className="ib-title">{t("ingestbar.running")}</div>
          <div className="ib-sub">{t("ingestbar.runningSub")}</div>
        </div>
        {props.onView && (
          <button className="btn btn-sm" onClick={props.onView}>{t("ingestbar.view")}</button>
        )}
      </div>
    );
  }

  if (counts.input > 0) {
    return (
      <div className="ingest-bar">
        <div className="ib-text">
          <div className="ib-title">{t("ingestbar.pending", { n: counts.input })}</div>
          <div className="ib-sub">{t("ingestbar.pendingSub")}</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={props.onRun}><Play size={14} /> {t("ingestbar.run")}</button>
      </div>
    );
  }

  return null;
}