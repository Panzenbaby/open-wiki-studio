import { CircleArrowUp } from "lucide-react";
import { useT } from "../../i18n.ts";
import type { MigrationPlan } from "../../../shared/ipc-types.ts";
import { IconTile } from "./IconTile.tsx";

interface MigrationCardProps {
  plan: MigrationPlan;
  /** A migration rewrites the wiki on disk — refused while an ingest writes. */
  disabled: boolean;
  onUpgrade: () => void;
}

/** Offer to upgrade legacy OKF concepts; shown only while some exist. */
export function MigrationCard(props: MigrationCardProps): JSX.Element {
  const t = useT();
  return (
    <section className="dash-card ingest-card tone-warn" aria-labelledby="dashboard-migrate-title">
      <div className="ingest-head">
        <IconTile tone="warn"><CircleArrowUp size={26} strokeWidth={1.75} /></IconTile>
        <div className="ingest-head-text">
          <h2 id="dashboard-migrate-title">{t("migrate.bannerTitle", { version: props.plan.targetVersion })}</h2>
          <p className="dash-sub">{t("migrate.bannerSub", { n: props.plan.conceptIds.length })}</p>
        </div>
        <div className="ingest-actions">
          <button type="button" className="btn btn-lg btn-primary" disabled={props.disabled} onClick={props.onUpgrade}>
            {t("migrate.action")}
          </button>
        </div>
      </div>
    </section>
  );
}
