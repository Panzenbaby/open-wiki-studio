// Generic yes/no confirmation on top of Modal, used instead of the native
// browser prompt so destructive actions get the app's own themed,
// keyboard-trapped dialog.
import { Modal } from "./Modal.tsx";

interface ConfirmModalProps {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  /** Disables both buttons while an async confirm is in flight. */
  readonly busy?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmModal(props: ConfirmModalProps): JSX.Element {
  return (
    <Modal
      title={props.title}
      onClose={props.onCancel}
      footer={
        <>
          <button className="btn btn-sm" onClick={props.onCancel} disabled={props.busy}>
            {props.cancelLabel}
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={props.onConfirm}
            disabled={props.busy}
          >
            {props.confirmLabel}
          </button>
        </>
      }
    >
      <p>{props.message}</p>
    </Modal>
  );
}
