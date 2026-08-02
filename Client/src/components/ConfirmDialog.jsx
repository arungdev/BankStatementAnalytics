import { Modal } from "@common/client";

// A window.confirm() replacement that fits the app's own modal styling.
// `message` may contain "\n\n"-separated paragraphs (as native confirm() text did).
export default function ConfirmDialog({
  open,
  title = "Are you sure?",
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onCancel}
      dismissible={!busy}
      title={title}
      width={440}
      footer={
        <>
          <button className="btn small" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button className={`btn small ${danger ? "danger" : "primary"}`} onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      {String(message || "").split("\n\n").map((para, i) => (
        <p key={i} className="confirm-dialog-text">{para}</p>
      ))}
    </Modal>
  );
}
