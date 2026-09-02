import { IconEye, IconTrash } from "@tabler/icons-react";

export function HistoryPanel({ entries, onInspect, onClear, canInteract = true }) {
  return (
    <section className="history-panel" aria-labelledby="history-title">
      <div className="ledger-heading">
        <h2 id="history-title">历史记录</h2>
        <button type="button" className="row-icon-button" aria-label="清除历史并恢复立方体" onClick={onClear} disabled={!canInteract}>
          <IconTrash size={18} stroke={1.7} />
        </button>
      </div>
      <ol className="history-list">
        {entries.length === 0 ? (
          <li className="history-empty">初始化立方体（边长 2.000）</li>
        ) : entries.slice().reverse().map((entry, reverseIndex) => (
          <li key={entry.id} className={reverseIndex === 0 ? "is-current" : ""}>
            <div>
              <time>{entry.time}</time>
              <span>{entry.description}</span>
            </div>
            <button type="button" className="row-icon-button" aria-label={`查看 ${entry.description}`} onClick={() => onInspect(entry.id)} disabled={!canInteract}>
              <IconEye size={17} stroke={1.7} />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
