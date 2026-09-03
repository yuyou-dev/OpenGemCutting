export function Modal({ title, children, confirmLabel, onConfirm, onClose, destructive = false }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2>{title}</h2>
        {children}
        <div className="modal-actions">
          <button type="button" className="secondary-button modal-button" onClick={onClose}>取消</button>
          {onConfirm ? (
            <button
              type="button"
              className={destructive ? "primary-action modal-button is-destructive" : "primary-action modal-button"}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          ) : (
            <button type="button" className="primary-action modal-button" onClick={onClose}>知道了</button>
          )}
        </div>
      </section>
    </div>
  );
}
