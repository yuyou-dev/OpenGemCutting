import { t } from '../i18n/locale.js';
import { useId, useRef } from "react";
import { IconX } from "@tabler/icons-react";
import { useDialogFocus } from "./useDialogFocus.js";

export function Modal({ title, children, confirmLabel, onConfirm, onClose, destructive = false, closeLabel, eyebrow, className = "" }) {
  const panelRef = useRef(null);
  const titleId = useId();
  useDialogFocus(panelRef, onClose);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={panelRef}
        tabIndex={-1}
        className={`modal-panel standard-modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-heading">
          <div>{eyebrow ? <small>{t(eyebrow)}</small> : null}<h2 id={titleId}>{t(title)}</h2></div>
          <button type="button" className="modal-close" aria-label={t("关闭{0}", [title])} onClick={onClose}><IconX size={17} stroke={1.6} /></button>
        </header>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">
          <button type="button" className="secondary-button modal-button" onClick={onClose}>{t(closeLabel ?? (onConfirm ? t("取消") : t("知道了")))}</button>
          {onConfirm ? (
            <button
              type="button"
              className={destructive ? "primary-action modal-button is-destructive" : "primary-action modal-button"}
              onClick={onConfirm}
            >
              {t(confirmLabel)}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
