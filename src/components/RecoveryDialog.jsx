import { t, getLocale } from '../i18n/locale.js';
import { useState } from "react";
import { IconRefresh, IconTrash } from "@tabler/icons-react";
import { Modal } from "./Modal.jsx";

export function RecoveryDialog({ records, unreadableCount, error, onClose, onRestore, onRefresh, onRemove, discardingDraft }) {
  const [selectedId, setSelectedId] = useState(records[0]?.id);
  const [deletingId, setDeletingId] = useState(null);
  const selected = records.find((record) => record.id === selectedId) ?? records[0];
  const deleting = records.find((record) => record.id === deletingId);
  const close = () => deleting ? setDeletingId(null) : onClose();
  return (
    <Modal
      title={t("恢复本地设计")} eyebrow="LOCAL RECOVERY" className="recovery-dialog"
      confirmLabel={deleting ? "确认删除备份" : "恢复所选设计"}
      destructive={Boolean(deleting)}
      onConfirm={deleting ? () => { onRemove(deleting.id); setDeletingId(null); } : selected ? () => onRestore(selected) : undefined}
      onClose={close}
      closeLabel={deleting ? "保留备份" : "返回工作台"}
    >
      <p>{t("这里保留升级前的旧版备份。恢复会替换当前项目的设计并自动保存，此次载入可一步撤销，原备份不变。")}</p>
      <dl className="recovery-boundary">
        <div><dt>{t("恢复内容")}</dt><dd>{t("已提交文档与光学材质")}</dd></div>
        <div><dt>{t("不含内容")}</dt><dd>{t("未保存 CUT / 群组预览、相机、视图参数与旧撤销历史")}</dd></div>
      </dl>
      {discardingDraft && selected ? <p className="recovery-warning">{t("恢复将放弃当前未保存预览，已提交文档可通过撤销找回。")}</p> : null}
      {error ? <p className="recovery-warning" role="alert">{t(error)}</p> : null}
      {unreadableCount > 0 ? <p className="recovery-warning" role="alert">{t("有")} {t(unreadableCount)} {t("份备份无法读取，原记录已保留。")}</p> : null}
      <div className="recovery-list-heading">
        <span>{t("旧版备份 ·")} {records.length} {t("份")} <small>{t("最近保存优先")}</small></span>
        <button type="button" className="recovery-tool" onClick={onRefresh} disabled={Boolean(deleting)}><IconRefresh size={14} />{t("刷新列表")}</button>
      </div>
      <div className="recovery-list" role="group" aria-label={t("按更新时间排列的本地备份")}>
        {records.map((record) => (
          <label key={record.id} className={`recovery-record${selected?.id === record.id ? " is-selected" : ""}`}>
            <input type="radio" name="local-recovery" checked={selected?.id === record.id} disabled={Boolean(deleting)} onChange={() => setSelectedId(record.id)} />
            <span><strong>{record.document.name}</strong><small>{t(new Date(record.savedAt).toLocaleString(getLocale()))} · {t(new Set(record.document.facets.map((facet) => facet.patternId)).size)} {t("层")}</small></span>
          </label>
        ))}
        {records.length === 0 ? <div className="recovery-empty"><strong>{t("暂无旧版备份")}</strong><p>{t("新设计自动保存到当前项目，请从主页打开项目继续。")}</p></div> : null}
      </div>
      {deleting ? (
        <div className="recovery-delete-note" role="alert"><strong>{t("删除「")}{deleting.document.name}」？</strong><p>{t("仅删除这份本地备份，当前工作台文档不受影响。删除后无法从此列表找回。")}</p></div>
      ) : selected ? <div className="recovery-tools"><button type="button" className="recovery-tool recovery-delete" onClick={() => setDeletingId(selected.id)}><IconTrash size={14} />{t("删除所选备份")}</button></div> : null}
      <p className="recovery-scope">{t("当前版本不再新增或更新旧版备份。项目与备份仅属于当前浏览器与站点地址；长期保存请导出 JSON。")}</p>
    </Modal>
  );
}
