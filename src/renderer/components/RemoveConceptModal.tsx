// Confirmation for removing a concept (or a whole directory of concepts)
// from the wiki. Removal is reversible in principle — files move to
// wiki/trash/ rather than being deleted — but it rewrites links in other
// concepts, so the dialog names every affected concept before it happens.
import { Trash2 } from "lucide-react";
import { useT } from "../i18n.ts";
import { Modal } from "./Modal.tsx";
import type { RemovalPlan } from "../../shared/ipc-types.ts";

interface RemoveConceptModalProps {
  readonly plan: RemovalPlan;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function RemoveConceptModal(props: RemoveConceptModalProps): JSX.Element {
  const t = useT();
  const { plan } = props;

  return (
    <Modal
      title={t("remove.title")}
      onClose={props.onCancel}
      footer={
        <>
          <button className="btn btn-sm" onClick={props.onCancel} disabled={props.busy}>
            {t("remove.cancel")}
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={props.onConfirm}
            disabled={props.busy}
          >
            <Trash2 size={14} /> {t("remove.confirm")}
          </button>
        </>
      }
    >
      <p>{t("remove.intro", { n: plan.conceptIds.length })}</p>

      <div className="folder-head">
        <span>{t("remove.concepts")}</span>
        <span className="count">{plan.conceptIds.length}</span>
      </div>
      <ul className="mono">
        {plan.conceptIds.map((conceptId) => (
          <li key={conceptId}>{conceptId}</li>
        ))}
      </ul>

      {plan.directories.length > 0 && (
        <>
          <p>{t("remove.directories")}</p>
          <ul className="mono">
            {plan.directories.map((directory) => (
              <li key={directory}>{directory}/</li>
            ))}
          </ul>
        </>
      )}

      {plan.incomingLinks.length === 0 ? (
        <p className="muted">{t("remove.noIncoming")}</p>
      ) : (
        <>
          <p>{t("remove.incoming", { n: new Set(plan.incomingLinks.map((l) => l.fromConceptId)).size })}</p>
          <ul className="mono">
            {plan.incomingLinks.map((link) => (
              <li key={`${link.fromConceptId}->${link.toConceptId}`}>
                {link.fromConceptId} → {link.toConceptId}
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
