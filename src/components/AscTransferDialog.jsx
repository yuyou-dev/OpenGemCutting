import { t } from '../i18n/locale.js';
import { useEffect, useId, useRef } from "react";

const STATUS_COPY = {
  ready: ["可无损转换", "is-ready"],
  warning: ["可转换 · 请检查警告", "is-warning"],
  error: ["不可转换", "is-error"],
};

const SEVERITY_LABELS = {
  error: "错误",
  warning: "警告",
  info: "信息",
};

function formatRatio(value) {
  return Number.isFinite(value) ? value.toFixed(3) : "—";
}

export function AscTransferDialog({ mode, fileName, result, onClose, onConfirm, onReselect, discardingDraft = false }) {
  const panelRef = useRef(null);
  const safeButtonRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  const isImport = mode === "import";
  const blocked = result.status === "error";
  const [statusLabel, statusClass] = STATUS_COPY[result.status] ?? STATUS_COPY.error;
  const summary = result.summary ?? {};

  useEffect(() => {
    const previousFocus = document.activeElement;
    safeButtonRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...panelRef.current.querySelectorAll("button:not(:disabled)")];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus?.();
    };
  }, [onClose]);

  const confirmLabel = isImport
    ? result.status === "warning" ? "仍然导入为新项目" : "导入为新项目"
    : result.status === "warning" ? "仍然导出 ASC" : "导出 ASC";

  return (
    <div className="modal-backdrop asc-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        ref={panelRef}
        className="modal-panel asc-transfer-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header className="asc-transfer-heading">
          <div>
            <span className="asc-eyebrow">GEMCAD ASC · {isImport ? "IMPORT" : "EXPORT"}</span>
            <h2 id={titleId}>{isImport ? t("导入 GemCad ASC") : t("导出 GemCad ASC")}</h2>
          </div>
          <span className={`asc-status ${statusClass}`} role={blocked ? "alert" : "status"}>{t(statusLabel)}</span>
        </header>

        <div className="asc-transfer-body">
          <p id={descriptionId} className="asc-file-name" title={t(fileName)}>{t(fileName)}</p>
          <div className="asc-summary-grid" aria-label={t("ASC 兼容摘要")}>
            <span><small>INDEX GEAR</small><strong>{t(summary.sourceGear ?? summary.targetGear ?? "—")} → {t(summary.targetGear ?? "—")}</strong></span>
            <span><small>TIERS / FACETS</small><strong>{t(summary.tierCount ?? "—")} / {t(summary.facetCount ?? "—")}</strong></span>
            <span><small>REFRACTIVE INDEX</small><strong>{t(summary.refractiveIndex ?? "—")}</strong></span>
            <span><small>LENGTH / WIDTH</small><strong>{t(formatRatio(summary.dimensions?.lengthToWidth))}</strong></span>
          </div>

          {isImport && Number.isFinite(summary.scale) ? (
            <div className="asc-compatibility-row">
              <span>{t("平面比例")}</span>
              <strong>{(summary.scale * 100).toFixed(3)}%</strong>
              <small>{t("统一归一化到边长 2.000 毛坯；角度与长宽/高度比例保持")}</small>
            </div>
          ) : null}

          <div className="asc-scope-note">
            <strong>{isImport ? t("确认后的影响") : t("本次导出范围")}</strong>
            <p>{isImport
              ? discardingDraft
                ? t("导入为独立项目，原项目保留；切换前会确认如何处理未保存预览。")
                : t("导入为独立项目，原项目及其底胚保持不变。")
              : t("按当前分度盘写出已提交文档的最终有效平面与折射率；小数分度保留，不取整。未保存预览、被覆盖面及底胚不进入 ASC；启用凹切时不能导出 ASC。JSON 保留完整项目。")}</p>
          </div>

          <div className="asc-diagnostics" aria-label={t("兼容诊断")}>
            <div className="asc-diagnostics-title"><strong>{t("兼容诊断")}</strong><span>{result.diagnostics.length}</span></div>
            {result.diagnostics.length ? (
              <ul>
                {result.diagnostics.map((item, index) => (
                  <li className={`is-${item.severity}`} key={`${item.code}-${item.line ?? 0}-${index}`}>
                    <span>{t(SEVERITY_LABELS[item.severity] ?? t("信息"))}</span>
                    <div><strong>{t(item.code)}{t(item.line ? ` · L${item.line}` : "")}</strong><p>{t(item.message)}</p></div>
                  </li>
                ))}
              </ul>
            ) : <p className="asc-diagnostics-empty">{t("未发现兼容问题。")}</p>}
          </div>
        </div>

        <div className="modal-actions asc-transfer-actions">
          <button ref={safeButtonRef} type="button" className="secondary-button modal-button" onClick={onClose}>{t("取消")}</button>
          {isImport ? <button type="button" className="secondary-button modal-button" onClick={onReselect}>{t("重新选择")}</button> : null}
          <button type="button" className="primary-action modal-button" onClick={onConfirm} disabled={blocked}>{t(confirmLabel)}</button>
        </div>
      </section>
    </div>
  );
}
