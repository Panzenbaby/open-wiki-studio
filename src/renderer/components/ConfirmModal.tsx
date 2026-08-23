import { type ReactNode } from "react";
import { Modal } from "./Modal.tsx";

interface ConfirmModalProps {
  readonly title: string;
  readonly description?: ReactNode;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly icon?: ReactNode;
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
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            {props.icon}
            {props.confirmLabel}
          </button>
        </>
      }
    >
      {props.description && <p>{props.description}</p>}
    </Modal>
  );
}
