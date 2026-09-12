import { t } from '../i18n/locale.js';
import { useEffect, useRef, useState } from "react";
import {
  IconChevronDown,
  IconChevronUp,
  IconEye,
  IconEyeOff,
  IconGripVertical,
  IconPlus,
  IconTransform,
  IconTrash,
} from "@tabler/icons-react";

const REGION_CHIP = { crown: "C", girdle: "G", pavilion: "P", table: "T" };
const REGION_TABS = [
  ["crown", "冠部", "C"],
  ["girdle", "腰部", "G"],
  ["pavilion", "亭部", "P"],
];

function chipLetter(operation) {
  if (operation.locked) return "T";
  return REGION_CHIP[operation.region] ?? "?";
}

/** Inline quick-edit for the selected layer: angle + depth, live preview, explicit Enter commits. */
function InlineEditor({ operation, values, onEdit, onCommit, depthEditable = true, angleEditable = true }) {
  const [angle, setAngle] = useState(String(values.angle));
  const [depth, setDepth] = useState(String(values.depth));
  const angleRef = useRef(null);
  const depthRef = useRef(null);
  useEffect(() => {
    // Sync from outside (layer switch, slider moves) without clobbering typing.
    if (document.activeElement !== angleRef.current) setAngle(Number(values.angle).toFixed(2));
    if (document.activeElement !== depthRef.current) setDepth(Number(values.depth).toFixed(3));
  }, [operation.id, values.angle, values.depth]);

  const emit = (field, raw) => {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return;
    onEdit?.(field, numeric);
  };

  const keyDown = (event) => {
    if (event.key === "Enter") onCommit?.();
    event.stopPropagation();
  };

  return (
    <div className="cut-stack-inline" onClick={(event) => event.stopPropagation()}>
      <label>
        <span>{t("角度°")}</span>
        <input
          type="number"
          min="0"
          max="90"
          step="0.01"
          value={angle}
          ref={angleRef}
          disabled={operation.locked || operation.region === "girdle" || !angleEditable}
          onChange={(event) => {
            setAngle(event.target.value);
            emit("angle", event.target.value);
          }}
          onKeyDown={keyDown}
          aria-label={t("行业角")}
        />
      </label>
      <label>
        <span>{t("深度")}</span>
        <input
          type="number"
          min="0"
          step="0.005"
          value={depth}
          ref={depthRef}
          disabled={!depthEditable}
          onChange={(event) => {
            setDepth(event.target.value);
            emit("depth", event.target.value);
          }}
          onKeyDown={keyDown}
          aria-label={t("切入深度")}
        />
      </label>
      <small>{t("回车保存")}</small>
    </div>
  );
}

export function CutStack({
  operations,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
  onNew,
  showNew = true,
  canSelectLayers = true,
  canMutateStack = true,
  canChangeRegion = true,
  canStartGroup = true,
  onToggleVisibility,
  onRemove,
  onRename,
  onReorder,
  inlineValues,
  onInlineEdit,
  onInlineCommit,
  depthEditable = true,
  angleEditable = true,
  diagnosticsById = {},
  activeRegion,
  onRegionChange,
  groupEditRegion,
  groupDeltaZ = 0,
  groupScale = 1,
  groupRotationTeeth = 0,
  groupBaseHeight = 0,
  groupError,
  canApplyGroupEdit = false,
  groupExitLabel = "取消变换",
  onStartGroupEdit,
  onGroupDeltaChange,
  onGroupScaleChange,
  onGroupRotationChange,
  onApplyGroupEdit,
  onCancelGroupEdit,
  canCancelSession = false,
  sessionMode = "idle",
  sessionFaceCount = 0,
  sessionEffectiveCount = 0,
  sessionDirty = false,
  canCommitSession = false,
  commitDisabledReason = "",
  onCommitSession,
  onCancelSession,
  collapsed = false,
  onToggle,
}) {
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const cancelRenameRef = useRef(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);
  const filteredOperations = operations.filter((operation) => operation.region === activeRegion);

  const commitRename = (operation) => {
    const next = renameValue.trim();
    setRenamingId(null);
    if (!cancelRenameRef.current && next && next !== operation.label) onRename?.(operation.id, next);
    cancelRenameRef.current = false;
  };

  const handleDrop = (targetIndex) => {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      setDropIndex(null);
      return;
    }
    onReorder?.(dragIndex, targetIndex);
    setDragIndex(null);
    setDropIndex(null);
  };

  return (
    <section className={`cut-stack${collapsed ? " is-collapsed" : ""}`} aria-labelledby="cut-stack-title">
      <div className="cut-stack-heading">
        <div>
          <span id="cut-stack-title">{t("解析序列 CUT STACK")}</span>
          <small>{filteredOperations.length} / {operations.length} {t("个预切割动作")}</small>
        </div>
        <div className="cut-stack-heading-actions">
          {onToggle ? (
            <button
              type="button"
              onClick={onToggle}
              disabled={!canMutateStack && !collapsed}
              aria-label={collapsed ? t("展开解析序列") : t("折叠解析序列")}
              aria-expanded={!collapsed}
              title={!canMutateStack && !collapsed ? t("请先保存或取消当前操作") : collapsed ? t("展开解析序列") : t("折叠解析序列")}
            >
              {collapsed ? <IconChevronDown size={16} stroke={1.8} /> : <IconChevronUp size={16} stroke={1.8} />}
            </button>
          ) : null}
        </div>
      </div>

      {!collapsed ? (
        <div className="cut-stack-region-tabs" role="tablist" aria-label={t("按部位筛选并新建切割动作")}>
          {REGION_TABS.map(([id, label, shortLabel]) => (
            <button
              type="button"
              role="tab"
              key={id}
              className={activeRegion === id ? `is-active region-${id}` : ""}
              aria-selected={activeRegion === id}
              onClick={() => onRegionChange?.(id)}
              disabled={!canChangeRegion}
              title={t("查看{0}图层；切换后以{1}参数新建动作", [t(label), t(label)])}
            >
              <span>{t(shortLabel)}</span>{t(label)}
            </button>
          ))}
        </div>
      ) : null}

      {!collapsed && activeRegion !== "girdle" && (groupEditRegion === activeRegion || canStartGroup) ? (
        <div className={`cut-stack-group${groupEditRegion === activeRegion ? " is-active is-transform" : ""}`}>
          {groupEditRegion === activeRegion ? (
            <>
              <div className="cut-stack-group-copy">
                <strong>{activeRegion === "crown" ? t("冠部与台面") : t("亭部")} {t("· 整体变换")}</strong>
                <small>{t("三轴联动预览")}</small>
              </div>
              <div className="cut-stack-group-values">
                <label className="is-translate">
                  <span><i />{t("升降 ΔZ")}</span>
                  <span className="cut-stack-group-unit">
                    <input
                      type="number"
                      step="0.01"
                      value={groupDeltaZ}
                      onChange={(event) => onGroupDeltaChange?.(event.target.value)}
                      aria-label={t("{0}整体垂直位移", [activeRegion === "crown" ? t("冠部") : t("亭部")])}
                    />
                  </span>
                  <small>{Number(groupDeltaZ) >= 0 ? "+" : ""}{Number(groupDeltaZ).toFixed(3)}</small>
                </label>
                <label className="is-scale">
                  <span><i />{t("比例 H")}</span>
                  <span className="cut-stack-group-unit">
                    <input
                      type="number"
                      min="2"
                      step="1"
                      value={Number((groupScale * 100).toFixed(3))}
                      onChange={(event) => onGroupScaleChange?.(Number(event.target.value) / 100)}
                      aria-label={t("{0}高度比例百分比", [activeRegion === "crown" ? t("冠部") : t("亭部")])}
                    />
                    <b>%</b>
                  </span>
                  <small>{groupBaseHeight.toFixed(3)} → {(groupBaseHeight * groupScale).toFixed(3)}</small>
                </label>
                <label className="is-rotate">
                  <span><i />{t("旋转 R")}</span>
                  <span className="cut-stack-group-unit">
                    <input
                      type="number"
                      min="-48"
                      max="48"
                      step="1"
                      value={groupRotationTeeth}
                      onChange={(event) => onGroupRotationChange?.(event.target.value)}
                      aria-label={t("{0}96 分度旋转齿数", [activeRegion === "crown" ? t("冠部") : t("亭部")])}
                    />
                    <b>T</b>
                  </span>
                  <small>{(groupRotationTeeth * 3.75).toFixed(2)}°</small>
                </label>
              </div>
              {groupError ? <small className="cut-stack-group-error">{t(groupError)}</small> : null}
              <div className="cut-stack-group-actions">
                <button type="button" onClick={onCancelGroupEdit}>{t(groupExitLabel)}</button>
                <button
                  type="button"
                  className="is-primary"
                  onClick={onApplyGroupEdit}
                  disabled={Boolean(groupError) || !canApplyGroupEdit}
                > {t("应用整体变换")} </button>
              </div>
            </>
          ) : (
            <div className="cut-stack-group-tools" role="group" aria-label={t("{0}批量调整", [activeRegion === "crown" ? t("冠部与台面") : t("亭部")])}>
              <button type="button" className="cut-stack-group-trigger is-transform" onClick={() => onStartGroupEdit?.(activeRegion)}>
                <IconTransform size={14} stroke={1.7} />
                <span><strong>{t("整体变换")}</strong><small>{t("升降 · 比例 · 96 分度旋转")}</small></span>
              </button>
            </div>
          )}
        </div>
      ) : null}

      {!collapsed && filteredOperations.length ? (
        <div className="cut-stack-list">
          {filteredOperations.map((operation) => {
            const index = operations.findIndex((item) => item.id === operation.id);
            const selected = selectedId === operation.id;
            const diagnostic = diagnosticsById[operation.id];
            const stale = diagnostic && diagnostic.status !== "valid";
            const groupSelected = groupEditRegion === "crown"
              ? operation.region === "crown"
              : groupEditRegion === operation.region;
            const hovered = hoveredId === operation.id;
            const classes = [
              "cut-stack-row",
              selected ? "is-selected" : "",
              groupSelected ? "is-group-selected" : "",
              groupSelected ? "is-group-transform" : "",
              hovered ? "is-hovered" : "",
              dragIndex === index ? "is-dragging" : "",
              dropIndex === index && dragIndex !== null && dragIndex !== index ? "is-drop-target" : "",
            ].filter(Boolean).join(" ");
            return (
              <div
                className={classes}
                key={operation.id}
                onMouseEnter={() => onHover?.(operation.id)}
                onMouseLeave={() => onHover?.(null)}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (dropIndex !== index) setDropIndex(index);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  handleDrop(index);
                }}
              >
                <div className="cut-stack-row-main">
                  <span
                    className="cut-stack-grip"
                    draggable={!operation.locked && canMutateStack}
                    onDragStart={(event) => {
                      setDragIndex(index);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setDropIndex(null);
                    }}
                    title={operation.locked ? t("固定结构层，始终位于序列首位") : t("拖拽调整布尔顺序")}
                    aria-hidden="true"
                  >
                    <IconGripVertical size={13} stroke={1.6} />
                  </span>
                  <span className={`cut-stack-chip region-${operation.locked ? "table" : operation.region}`} aria-hidden="true">
                    {t(chipLetter(operation))}
                  </span>
                  <div className="cut-stack-select">
                    <div className="cut-stack-copy">
                      {renamingId === operation.id ? (
                        <input
                          className="cut-stack-rename"
                          value={renameValue}
                          autoFocus
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onBlur={() => commitRename(operation)}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
                            if (event.key === "Escape") {
                              event.preventDefault();
                              cancelRenameRef.current = true;
                              event.currentTarget.blur();
                            }
                          }}
                          aria-label={t("重命名 {0}", [operation.label])}
                        />
                      ) : (
                        <button
                          type="button"
                          className="cut-stack-name"
                          disabled={!canMutateStack || operation.locked}
                          onClick={() => {
                            setRenamingId(operation.id);
                            setRenameValue(operation.label);
                          }}
                          title={operation.locked ? operation.label : t("{0} · 点击名称改名；点击“编辑”调整切割", [operation.label])}
                          aria-label={t("重命名 {0}", [operation.label])}
                        >
                          <strong>{operation.label}{selected ? <em>EDIT</em> : null}</strong>
                        </button>
                      )}
                      {operation.preform || diagnostic ? (
                        <span className="cut-stack-construction-tags">
                          {operation.preform ? <span className="cut-stack-preform-tag">{t("预形")}</span> : null}
                          {diagnostic ? <span className={`cut-stack-meet-tag${stale ? " is-stale" : ""}`} title={t(diagnostic.message)}>{stale ? t("Meet 失效") : "Meet"}</span> : null}
                        </span>
                      ) : null}
                      <button type="button" className="cut-stack-parameters" onClick={() => onSelect(operation.id)} disabled={!canSelectLayers} aria-label={t("编辑 {0}", [operation.label])}>
                        <small>{operation.industryAngleDeg.toFixed(2)}° · D {operation.depth.toFixed(3)}{operation.status === "参与解析" ? "" : ` · ${t(operation.status)}`}</small>
                      </button>
                    </div>
                    <div className="cut-stack-edit-actions">
                      <button type="button" className="cut-stack-count" onClick={() => onSelect(operation.id)} disabled={!canSelectLayers} title={t("有效 {0} / 生成 {1} 面", [operation.effectiveCount, operation.recordedCount])} aria-label={t("编辑 {0}，有效 {1} 面", [operation.label, operation.effectiveCount])}>
                        {t(operation.effectiveCount === operation.recordedCount
                          ? `${operation.recordedCount}F`
                          : `${operation.effectiveCount}/${operation.recordedCount}F`)}
                      </button>
                      <button
                        type="button"
                        className="cut-stack-edit-button"
                        onClick={() => onSelect(operation.id)}
                        disabled={!canSelectLayers}
                        aria-label={t("编辑切割 {0}", [operation.label])}
                        title={selected ? t("正在编辑此图层；在下方保存或放弃修改") : canSelectLayers ? t("编辑 {0} 的切割参数", [operation.label]) : t("请先保存或取消当前操作")}
                      >
                        {selected ? t("编辑中") : t("编辑")}
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="cut-stack-icon"
                    onClick={() => onToggleVisibility(operation.id)}
                    aria-label={operation.locked ? t("{0} 固定参与序列", [operation.label]) : operation.visible ? t("隐藏 {0}", [operation.label]) : t("显示 {0}", [operation.label])}
                    title={operation.locked ? t("固定结构层") : operation.visible ? t("从解析结果中隐藏") : t("恢复到解析结果")}
                    disabled={operation.locked || !canMutateStack}
                  >
                    {operation.visible ? <IconEye size={15} stroke={1.7} /> : <IconEyeOff size={15} stroke={1.7} />}
                  </button>
                  <button
                    type="button"
                    className="cut-stack-icon is-remove"
                    onClick={() => onRemove(operation.id)}
                    aria-label={operation.locked ? t("{0} 不可删除", [operation.label]) : t("移除 {0}", [operation.label])}
                    title={operation.locked ? t("固定结构层") : t("移除预切割动作（可撤销）")}
                    disabled={operation.locked || !canMutateStack}
                  >
                    <IconTrash size={14} stroke={1.7} />
                  </button>
                </div>
                {stale ? <p className="cut-stack-meet-diagnostic" role="status">{t(diagnostic.message ?? t("施工来源失效；保留已保存切面，请重新编辑修复。"))}</p> : null}
                {selected ? (
                  <InlineEditor
                    operation={operation}
                    values={inlineValues ?? { angle: operation.industryAngleDeg, depth: operation.depth }}
                    onEdit={onInlineEdit}
                    onCommit={onInlineCommit}
                    depthEditable={depthEditable}
                    angleEditable={angleEditable}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {!collapsed && showNew ? (
        <button type="button" className="cut-stack-new-row" onClick={onNew}>
          <span className="cut-stack-add-icon" aria-hidden="true">
            <IconPlus size={14} stroke={2.1} />
          </span>
          <span className="cut-stack-add-copy">
            <strong>{t("新建{0}切割图层", [t(REGION_TABS.find(([id]) => id === activeRegion)?.[1])])}</strong>
            <small>{t("创建一组新的预切割面")}</small>
          </span>
        </button>
      ) : !collapsed && canCancelSession ? (
        <div className={`cut-stack-session-row is-${sessionMode}`} role="status">
          <span className="cut-stack-session-copy">
            <strong>
              {sessionMode === "edit"
                ? t("编辑{0}", [sessionDirty ? t(" · 未保存") : ""])
                : t("新建{0}", [t(REGION_TABS.find(([id]) => id === activeRegion)?.[1])])}
            </strong>
            <small>{t("有效")} {t(sessionEffectiveCount)} {t("/ 生成")} {t(sessionFaceCount)} {t("面")}</small>
          </span>
          <span className="cut-stack-session-actions">
            <button
              type="button"
              className="cut-stack-session-cancel"
              onClick={onCancelSession}
              title={`${sessionMode === "edit" ? t("放弃修改并退出编辑") : t("取消新建")} · Esc`}
            >
              {sessionMode === "edit" ? t("放弃") : t("取消")}
            </button>
            <button
              type="button"
              className="cut-stack-session-commit"
              onClick={onCommitSession}
              disabled={!canCommitSession || Boolean(commitDisabledReason) || sessionFaceCount === 0}
              title={t(commitDisabledReason || undefined)}
            >
              {sessionMode === "edit" ? t("保存") : t("加入序列 · {0} 面", [sessionEffectiveCount])}
            </button>
          </span>
        </div>
      ) : null}
    </section>
  );
}
