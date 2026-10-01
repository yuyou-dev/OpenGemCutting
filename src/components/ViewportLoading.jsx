import { t } from "../i18n/locale.js";
import "./viewport-loading.css";

/**
 * Covers a 3D view until its renderer has drawn: the canvas would otherwise
 * sit blank while a renderer chunk downloads. It also takes the pointer, so a
 * drag cannot start on a view that is not ready. With `failed` it reports a
 * failed load instead; `detail` carries the module's own reason, untranslated.
 */
export function ViewportLoading({ message = "正在准备三维视图…", failed = false, detail = "", onRetry }) {
  return (
    <div className={`viewport-loading${failed ? " is-failed" : ""}`} role={failed ? "alert" : "status"} aria-live="polite">
      <img src={`${import.meta.env.BASE_URL}brand/logo-header.webp`} alt="" />
      {failed ? null : <span className="viewport-loading__bar" aria-hidden="true"><span /></span>}
      <p>{t(message)}</p>
      {failed && detail ? <p className="viewport-loading__detail">{detail}</p> : null}
      {failed && onRetry ? <button type="button" onClick={onRetry}>{t("重试")}</button> : null}
    </div>
  );
}
