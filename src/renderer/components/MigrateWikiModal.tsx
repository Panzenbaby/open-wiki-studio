// Confirmation for the OKF v0.1 → v0.2 migration. The rewrite is
// deterministic (no agent) but it touches concept files in place, so the
// dialog names every concept it will change before anything is written.
import { ArrowUpCircle } from "lucide-react";
import { useT } from "../i18n.ts";
import { Modal } from "./Modal.tsx";
import type { MigrationPlan } from "../../shared/ipc-types.ts";

interface MigrateWikiModalProps {
  readonly plan: MigrationPlan;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function MigrateWikiModal(props: MigrateWikiModalProps): JSX.Element {
  const t = useT();
  const { plan } = props;

  return (
    <Modal
      title={t("migrate.title", { version: plan.targetVersion })}
      onClose={props.onCancel}
      footer={
        <>
          <button className="btn btn-sm" onClick={props.onCancel} disabled={props.busy}>
            {t("migrate.cancel")}
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={props.onConfirm}
            disabled={props.busy}
          >
            <ArrowUpCircle size={14} /> {t("migrate.confirm")}
          </button>
        </>
      }
    >
      <p>{t("migrate.intro", { n: plan.conceptIds.length, version: plan.targetVersion })}</p>
      <p className="muted">{t("migrate.changes")}</p>

      <div className="folder-head">
        <span>{t("migrate.concepts")}</span>
        <span className="count">{plan.conceptIds.length}</span>
      </div>
      <ul className="mono">
        {plan.conceptIds.map((conceptId) => (
          <li key={conceptId}>{conceptId}</li>
        ))}
      </ul>

      {plan.upToDate > 0 && <p className="muted">{t("migrate.upToDate", { n: plan.upToDate })}</p>}
    </Modal>
  );
}
