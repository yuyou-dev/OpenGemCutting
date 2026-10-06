import { useLayoutEffect, useRef } from "react";
import { IconCheck, IconLayoutGrid, IconLock, IconPlus } from "@tabler/icons-react";
import { t } from "../i18n/locale.js";
import { ToolSketch } from "./ToolSketch.jsx";
import { NormalCutIcon } from "./ToolLibrary.jsx";
import "./operation-panel.css";

const REGIONS = [["crown", "冠部", "C"], ["girdle", "腰部", "G"], ["pavilion", "亭部", "P"]];

/** One fixed command area; only parameters scroll. All actions use CUT capabilities. */
export function OperationPanel({
  mode, region, canChangeRegion = false, onRegionChange, title, subtitle,
  tool = null, toolHood = null, libraryOpen = false, onOpenLibrary, libraryButtonRef, lockNote = "",
  showNew = false, onNew, canCancel = false, onCancel, canCommit = false, commitDisabledReason = "", onCommit,
  effectiveCount = 0, generatedCount = 0, dirty = false, validationMessage = "", warningMessage = "",
  groupError = "", canApplyGroup = false, onApplyGroup, groupExitLabel = "取消变换", children,
}) {
  const bodyRef = useRef(null);
  const creating = mode === "create", editing = mode === "edit", grouping = mode === "group";
  const session = creating || editing;
  useLayoutEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [tool?.id, mode]);
  const commitBlocked = !canCommit || Boolean(commitDisabledReason) || generatedCount === 0;
  const message = validationMessage || warningMessage;
  return (
    <aside className={`operation-panel is-${mode}${tool ? " has-tool" : ""}`} aria-label={t("操作栏：部位、刀具、参数与保存")}>
      <header className="operation-head">
        <div className="operation-title">
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </div>
        <div className="operation-regions" role="radiogroup" aria-label={t("切割部位")}>
          {REGIONS.map(([id, label, letter]) => (
            <button
              type="button" role="radio" key={id}
              className={region === id ? `is-active region-${id}` : ""}
              aria-checked={region === id}
              disabled={!canChangeRegion}
              onClick={() => onRegionChange?.(id)}
              title={!canChangeRegion ? t("整体变换中不能切换部位") : editing ? t("切换到{0}会放弃当前编辑，并以{0}新建一刀", [t(label)]) : t("在{0}切割", [t(label)])}
            ><b>{letter}</b>{t(label)}</button>
          ))}
        </div>
      </header>

      <section className="operation-command" aria-label={t("切割操作")}>
        <div className="operation-actions">
          {session ? (
            <button type="button" className="operation-commit" onClick={onCommit} disabled={commitBlocked} title={commitDisabledReason ? t(commitDisabledReason) : undefined}>
              <IconCheck size={17} stroke={2} aria-hidden="true" />{t(creating ? "加入序列" : "保存")}
            </button>
          ) : grouping ? (
            <button type="button" className="operation-commit is-group" onClick={onApplyGroup} disabled={Boolean(groupError) || !canApplyGroup}>{t("应用整体变换")}</button>
          ) : (
            <button type="button" className="operation-new" onClick={onNew} disabled={!showNew}>
              <IconPlus size={18} stroke={2.2} aria-hidden="true" /><strong>{t("新增切割")}</strong>
            </button>
          )}
          {session || grouping ? (
            <button type="button" className="operation-cancel" onClick={onCancel} disabled={!canCancel} title={`${t(grouping ? groupExitLabel : creating ? "取消新增并移除待加入的图层" : "放弃修改并退出编辑")} · Esc`}>
              {t(grouping ? groupExitLabel : creating ? "取消" : "放弃")}
            </button>
          ) : null}
          {!grouping ? (
            <button type="button" ref={libraryButtonRef} className="operation-library-button" data-library-toggle=""
              aria-expanded={libraryOpen} aria-haspopup="dialog" onClick={onOpenLibrary}
              title={session ? t("打开刀具库选择普通切或复合刀具") : t("浏览刀具库；新增切割后才能选刀")}>
              <IconLayoutGrid size={14} stroke={1.7} aria-hidden="true" />{t("刀具库")}
            </button>
          ) : null}
        </div>
        {session ? (
          <>
            <div className="operation-tool">
              <span className="operation-tool-thumb" aria-hidden="true">
                {tool ? <ToolSketch hood={toolHood} size={26} outline={false} title={t(tool.label)} /> : <NormalCutIcon size={26} />}
              </span>
              <strong>{t(tool?.label ?? "普通切")}</strong>
              {tool?.experimental ? <em>{t("实验")}</em> : null}
              {!creating && dirty ? <span className="operation-dirty">{t("未保存")}</span> : null}
            </div>
            <p className={`operation-status${validationMessage ? " is-error" : warningMessage ? " is-warning" : ""}`} role={validationMessage ? "alert" : "status"}>
              <span className="operation-count">{t("有效 {0} / 生成 {1} 面", [effectiveCount, generatedCount])}</span>
              {message ? <span className="operation-message">{t(message)}</span> : null}
            </p>
          </>
        ) : null}
        {lockNote ? <p className="operation-tool-lock" role="note"><IconLock size={13} stroke={1.7} aria-hidden="true" />{t(lockNote)}</p> : null}
        {grouping && groupError ? <p className="operation-status is-error" role="alert"><span className="operation-message">{t(groupError)}</span></p> : null}
      </section>
      <div className="operation-body" ref={bodyRef}>{children}</div>
    </aside>
  );
}
