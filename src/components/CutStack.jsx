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
function InlineEditor({ operation, values, onEdit, onCommit, depthEditable = true }) {
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
        <span>角度°</span>
        <input
          type="number"
          min="0"
          max="90"
          step="0.01"
          value={angle}
          ref={angleRef}
          disabled={operation.locked || operation.region === "girdle"}
          onChange={(event) => {
            setAngle(event.target.value);
            emit("angle", event.target.value);
          }}
          onKeyDown={keyDown}
          aria-label="行业角"
        />
      </label>
      <label>
        <span>深度</span>
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
          aria-label="切入深度"
        />
      </label>
      <small>回车保存</small>
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
  floating = false,
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
    <section className={`cut-stack${floating ? " is-floating" : ""}${collapsed ? " is-collapsed" : ""}`} aria-labelledby="cut-stack-title">
      <div className="cut-stack-heading">
        <div>
          <span id="cut-stack-title">解析序列 CUT STACK</span>
          <small>{filteredOperations.length} / {operations.length} 个预切割动作</small>
        </div>
        <div className="cut-stack-heading-actions">
          {onToggle ? (
            <button
              type="button"
              onClick={onToggle}
              disabled={!canMutateStack && !collapsed}
              aria-label={collapsed ? "展开解析序列" : "折叠解析序列"}
              aria-expanded={!collapsed}
              title={!canMutateStack && !collapsed ? "请先保存或取消当前操作" : collapsed ? "展开解析序列" : "折叠解析序列"}
            >
              {collapsed ? <IconChevronDown size={16} stroke={1.8} /> : <IconChevronUp size={16} stroke={1.8} />}
            </button>
          ) : null}
        </div>
      </div>

      {!collapsed ? (
        <div className="cut-stack-region-tabs" role="tablist" aria-label="按部位筛选并新建切割动作">
          {REGION_TABS.map(([id, label, shortLabel]) => (
            <button
              type="button"
              role="tab"
              key={id}
              className={activeRegion === id ? `is-active region-${id}` : ""}
              aria-selected={activeRegion === id}
              onClick={() => onRegionChange?.(id)}
              disabled={!canChangeRegion}
              title={`查看${label}图层；切换后以${label}参数新建动作`}
            >
              <span>{shortLabel}</span>{label}
            </button>
          ))}
        </div>
      ) : null}

      {!collapsed && activeRegion !== "girdle" && (groupEditRegion === activeRegion || canStartGroup) ? (
        <div className={`cut-stack-group${groupEditRegion === activeRegion ? " is-active is-transform" : ""}`}>
          {groupEditRegion === activeRegion ? (
            <>
              <div className="cut-stack-group-copy">
                <strong>{activeRegion === "crown" ? "冠部与台面" : "亭部"} · 整体变换</strong>
                <small>三轴联动预览</small>
              </div>
              <div className="cut-stack-group-values">
                <label className="is-translate">
                  <span><i />升降 ΔZ</span>
                  <span className="cut-stack-group-unit">
                    <input
                      type="number"
                      step="0.01"
                      value={groupDeltaZ}
                      onChange={(event) => onGroupDeltaChange?.(event.target.value)}
                      aria-label={`${activeRegion === "crown" ? "冠部" : "亭部"}整体垂直位移`}
                    />
                  </span>
                  <small>{Number(groupDeltaZ) >= 0 ? "+" : ""}{Number(groupDeltaZ).toFixed(3)}</small>
                </label>
                <label className="is-scale">
                  <span><i />比例 H</span>
                  <span className="cut-stack-group-unit">
                    <input
                      type="number"
                      min="2"
                      step="1"
                      value={Number((groupScale * 100).toFixed(3))}
                      onChange={(event) => onGroupScaleChange?.(Number(event.target.value) / 100)}
                      aria-label={`${activeRegion === "crown" ? "冠部" : "亭部"}高度比例百分比`}
                    />
                    <b>%</b>
                  </span>
                  <small>{groupBaseHeight.toFixed(3)} → {(groupBaseHeight * groupScale).toFixed(3)}</small>
                </label>
                <label className="is-rotate">
                  <span><i />旋转 R</span>
                  <span className="cut-stack-group-unit">
                    <input
                      type="number"
                      min="-48"
                      max="48"
                      step="1"
                      value={groupRotationTeeth}
                      onChange={(event) => onGroupRotationChange?.(event.target.value)}
                      aria-label={`${activeRegion === "crown" ? "冠部" : "亭部"}96 分度旋转齿数`}
                    />
                    <b>T</b>
                  </span>
                  <small>{(groupRotationTeeth * 3.75).toFixed(2)}°</small>
                </label>
              </div>
              {groupError ? <small className="cut-stack-group-error">{groupError}</small> : null}
              <div className="cut-stack-group-actions">
                <button type="button" onClick={onCancelGroupEdit}>{groupExitLabel}</button>
                <button
                  type="button"
                  className="is-primary"
                  onClick={onApplyGroupEdit}
                  disabled={Boolean(groupError) || !canApplyGroupEdit}
                >
                  应用整体变换
                </button>
              </div>
            </>
          ) : (
            <div className="cut-stack-group-tools" role="group" aria-label={`${activeRegion === "crown" ? "冠部与台面" : "亭部"}批量调整`}>
              <button type="button" className="cut-stack-group-trigger is-transform" onClick={() => onStartGroupEdit?.(activeRegion)}>
                <IconTransform size={14} stroke={1.7} />
                <span><strong>整体变换</strong><small>升降 · 比例 · 96 分度旋转</small></span>
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
                    title={operation.locked ? "固定结构层，始终位于序列首位" : "拖拽调整布尔顺序"}
                    aria-hidden="true"
                  >
                    <IconGripVertical size={13} stroke={1.6} />
                  </span>
                  <span className={`cut-stack-chip region-${operation.locked ? "table" : operation.region}`} aria-hidden="true">
                    {chipLetter(operation)}
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
                          aria-label={`重命名 ${operation.label}`}
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
                          title={operation.locked ? operation.label : "点击名称改名；点击下方参数编辑切割"}
                          aria-label={`重命名 ${operation.label}`}
                        >
                          <strong>{operation.label}{selected ? <em>EDIT</em> : null}</strong>
                        </button>
                      )}
                      <button type="button" className="cut-stack-parameters" onClick={() => onSelect(operation.id)} disabled={!canSelectLayers} aria-label={`编辑 ${operation.label}`}>
                        <small>{operation.industryAngleDeg.toFixed(2)}° · D {operation.depth.toFixed(3)}{operation.status === "参与解析" ? "" : ` · ${operation.status}`}</small>
                      </button>
                    </div>
                    <button type="button" className="cut-stack-count" onClick={() => onSelect(operation.id)} disabled={!canSelectLayers} title={`有效 ${operation.effectiveCount} / 生成 ${operation.recordedCount} 面`} aria-label={`编辑 ${operation.label}，有效 ${operation.effectiveCount} 面`}>
                      {operation.effectiveCount === operation.recordedCount
                        ? `${operation.recordedCount}F`
                        : `${operation.effectiveCount}/${operation.recordedCount}F`}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="cut-stack-icon"
                    onClick={() => onToggleVisibility(operation.id)}
                    aria-label={operation.locked ? `${operation.label} 固定参与序列` : operation.visible ? `隐藏 ${operation.label}` : `显示 ${operation.label}`}
                    title={operation.locked ? "固定结构层" : operation.visible ? "从解析结果中隐藏" : "恢复到解析结果"}
                    disabled={operation.locked || !canMutateStack}
                  >
                    {operation.visible ? <IconEye size={15} stroke={1.7} /> : <IconEyeOff size={15} stroke={1.7} />}
                  </button>
                  <button
                    type="button"
                    className="cut-stack-icon is-remove"
                    onClick={() => onRemove(operation.id)}
                    aria-label={operation.locked ? `${operation.label} 不可删除` : `移除 ${operation.label}`}
                    title={operation.locked ? "固定结构层" : "移除预切割动作（可撤销）"}
                    disabled={operation.locked || !canMutateStack}
                  >
                    <IconTrash size={14} stroke={1.7} />
                  </button>
                </div>
                {selected ? (
                  <InlineEditor
                    operation={operation}
                    values={inlineValues ?? { angle: operation.industryAngleDeg, depth: operation.depth }}
                    onEdit={onInlineEdit}
                    onCommit={onInlineCommit}
                    depthEditable={depthEditable}
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
            <strong>新建{REGION_TABS.find(([id]) => id === activeRegion)?.[1]}切割图层</strong>
            <small>创建一组新的预切割面</small>
          </span>
        </button>
      ) : !collapsed && canCancelSession ? (
        <div className={`cut-stack-session-row is-${sessionMode}`} role="status">
          <span className="cut-stack-session-copy">
            <strong>
              {sessionMode === "edit"
                ? `编辑${sessionDirty ? " · 未保存" : ""}`
                : `新建${REGION_TABS.find(([id]) => id === activeRegion)?.[1]}`}
            </strong>
            <small>有效 {sessionEffectiveCount} / 生成 {sessionFaceCount} 面</small>
          </span>
          <span className="cut-stack-session-actions">
            <button
              type="button"
              className="cut-stack-session-cancel"
              onClick={onCancelSession}
              title={`${sessionMode === "edit" ? "放弃修改并退出编辑" : "取消新建"} · Esc`}
            >
              {sessionMode === "edit" ? "放弃" : "取消"}
            </button>
            <button
              type="button"
              className="cut-stack-session-commit"
              onClick={onCommitSession}
              disabled={!canCommitSession || Boolean(commitDisabledReason) || sessionFaceCount === 0}
              title={commitDisabledReason || undefined}
            >
              {sessionMode === "edit" ? "保存" : `加入序列 · ${sessionEffectiveCount} 面`}
            </button>
          </span>
        </div>
      ) : null}
    </section>
  );
}
