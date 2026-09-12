import { t } from '../i18n/locale.js';
import { IconEye, IconTrash } from "@tabler/icons-react";

export function HistoryPanel({ entries, onInspect, onClear, canInteract = true, stockKind = "cube" }) {
  return (
    <section className="history-panel" aria-labelledby="history-title">
      <div className="ledger-heading">
        <h2 id="history-title">{t("历史记录")}</h2>
        <button type="button" className="row-icon-button" aria-label={stockKind === "mesh" ? t("清除切割并恢复初始晶体") : t("清除历史并恢复默认预形")} onClick={onClear} disabled={!canInteract}>
          <IconTrash size={18} stroke={1.7} />
        </button>
      </div>
      <ol className="history-list">
        {entries.length === 0 ? (
          <li className="history-empty">{stockKind === "mesh" ? t("导入初始晶体（尚无切割）") : t("初始化默认预形（边长 2.000）")}</li>
        ) : entries.slice().reverse().map((entry, reverseIndex) => (
          <li key={entry.id} className={reverseIndex === 0 ? "is-current" : ""}>
            <div>
              <time>{t(entry.time)}</time>
              <span>{t(entry.description)}</span>
            </div>
            <button type="button" className="row-icon-button" aria-label={t("查看 {0}", [entry.description])} onClick={() => onInspect(entry.id)} disabled={!canInteract}>
              <IconEye size={17} stroke={1.7} />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
