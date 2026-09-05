import { useState } from "react";
import { IconRefresh, IconTrash } from "@tabler/icons-react";
import { Modal } from "./Modal.jsx";

export function RecoveryDialog({ records, unreadableCount, error, onClose, onRestore, onRefresh, onRemove, discardingDraft, startup }) {
  const [selectedId, setSelectedId] = useState(records[0]?.id);
  const [deletingId, setDeletingId] = useState(null);
  const selected = records.find((record) => record.id === selectedId) ?? records[0];
  const deleting = records.find((record) => record.id === deletingId);
  const close = () => deleting ? setDeletingId(null) : onClose();
  return (
    <Modal
      title="恢复本地设计" eyebrow="LOCAL RECOVERY" className="recovery-dialog"
      confirmLabel={deleting ? "确认删除备份" : "恢复所选设计"}
      destructive={Boolean(deleting)}
      onConfirm={deleting ? () => { onRemove(deleting.id); setDeletingId(null); } : selected ? () => onRestore(selected) : undefined}
      onClose={close}
      closeLabel={deleting ? "保留备份" : startup ? "开始新设计" : "返回工作台"}
    >
      <p>选择一份备份继续编辑。恢复会建立当前页面的独立副本，此次载入可一步撤销。</p>
      <dl className="recovery-boundary">
        <div><dt>恢复内容</dt><dd>已提交文档与光学材质</dd></div>
        <div><dt>不含内容</dt><dd>未保存 CUT / 群组预览、相机、视图参数与旧撤销历史</dd></div>
      </dl>
      {discardingDraft && selected ? <p className="recovery-warning">恢复将放弃当前未保存预览，已提交文档可通过撤销找回。</p> : null}
      {error ? <p className="recovery-warning" role="alert">{error}</p> : null}
      {unreadableCount > 0 ? <p className="recovery-warning" role="alert">有 {unreadableCount} 份备份无法读取，原记录已保留。</p> : null}
      <div className="recovery-list-heading">
        <span>本地备份 · {records.length} 份 <small>最近更新优先</small></span>
        <button type="button" className="recovery-tool" onClick={onRefresh} disabled={Boolean(deleting)}><IconRefresh size={14} />刷新列表</button>
      </div>
      <div className="recovery-list" role="group" aria-label="按更新时间排列的本地备份">
        {records.map((record) => (
          <label key={record.id} className={`recovery-record${selected?.id === record.id ? " is-selected" : ""}`}>
            <input type="radio" name="local-recovery" checked={selected?.id === record.id} disabled={Boolean(deleting)} onChange={() => setSelectedId(record.id)} />
            <span><strong>{record.document.name}</strong><small>{new Date(record.savedAt).toLocaleString("zh-CN")} · {new Set(record.document.facets.map((facet) => facet.patternId)).size} 层</small></span>
          </label>
        ))}
        {records.length === 0 ? <div className="recovery-empty"><strong>暂无本地备份</strong><p>提交切割、修改材质或载入设计后会自动备份。</p></div> : null}
      </div>
      {deleting ? (
        <div className="recovery-delete-note" role="alert"><strong>删除「{deleting.document.name}」？</strong><p>仅删除这份本地备份，当前工作台文档不受影响。删除后无法从此列表找回。</p></div>
      ) : selected ? <div className="recovery-tools"><button type="button" className="recovery-tool recovery-delete" onClick={() => setDeletingId(selected.id)}><IconTrash size={14} />删除所选备份</button></div> : null}
      <p className="recovery-scope">各标签页独立备份，互不覆盖。备份仅属于当前浏览器与站点地址；长期保存请导出 JSON。</p>
    </Modal>
  );
}
