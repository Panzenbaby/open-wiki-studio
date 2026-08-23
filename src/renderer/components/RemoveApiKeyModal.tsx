// Confirmation for deleting the stored provider API key. Unlike concept
// removal there is no trash to recover from — the key is gone from this
// device and has to be re-entered from a password manager or reissued.
import { Trash2 } from "lucide-react";
import { useT } from "../i18n.ts";
import { Modal } from "./Modal.tsx";

interface RemoveApiKeyModalProps {
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function RemoveApiKeyModal(props: RemoveApiKeyModalProps): JSX.Element {
  const t = useT();

  return (
    <Modal
      title={t("removeKey.title")}
      onClose={props.onCancel}
      footer={
        <>
          <button className="btn btn-sm" onClick={props.onCancel} disabled={props.busy}>
            {t("removeKey.cancel")}
          </button>
          <button
            className="btn btn-sm btn-danger"
            onClick={props.onConfirm}
            disabled={props.busy}
          >
            <Trash2 size={14} /> {t("removeKey.confirm")}
          </button>
        </>
      }
    >
      <p>{t("removeKey.body")}</p>
      <p className="muted">{t("removeKey.notRevoked")}</p>
    </Modal>
  );
}
