import { t } from '../i18n/locale.js';
import { IconTrash } from "@tabler/icons-react";

export function HistoryPanel({ entries, onInspect, onClear, canInteract = true }) {
  return (
    <section className="history-panel" aria-labelledby="history-title">
      <div className="ledger-heading">
        <h2 id="history-title">{t("历史记录")}</h2>
        <button type="button" className="row-icon-button" aria-label={t("重置平切参数（可撤销）")} title={t("重置平切参数（可撤销）")} onClick={onClear} disabled={!canInteract}>
          <IconTrash size={18} stroke={1.7} />
        </button>
      </div>
      <ol className="history-list">
        {entries.length === 0 ? (
          <li className="history-empty">{t("当前会话尚无已提交操作")}</li>
        ) : entries.slice().reverse().map((entry, reverseIndex) => (
          <li key={entry.id} className={reverseIndex === 0 ? "is-current" : ""}>
            <div>
              <time>{t(entry.time)}</time>
              <span>{t(entry.description)}</span>
            </div>
            <button type="button" className="row-icon-button" aria-label={t("恢复至 {0}", [entry.description])} title={t("回到此步骤；可重做后续操作") } onClick={() => onInspect(entry.id)} disabled={!canInteract}>
              <span>{t("恢复")}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
