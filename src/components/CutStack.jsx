import { t } from '../i18n/locale.js';
import { useEffect, useRef, useState } from "react";
import {
  IconEye,
  IconEyeOff,
  IconGripVertical,
  IconPencil,
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

const GRID_SYMMETRY_NAMES = { 1: "一次", 2: "二次", 3: "三次", 4: "四次", 6: "六次" };
const GRID_LATTICE_NAMES = { square: "方格", hex: "蜂窝", tri: "三角" };
/** Badge text of a grid layer, e.g. 网格 四次方格 6×6 · 第 2 行. */
function gridTitle(grid) {
  const size = grid.lattice === "square" ? `${grid.columns}×${grid.symmetry === 4 ? grid.columns : grid.rows}` : t("{0} 圈", [grid.rings]);
  return `${t("网格")} ${t(GRID_SYMMETRY_NAMES[grid.symmetry])}${t(GRID_LATTICE_NAMES[grid.lattice])} ${size}${grid.scope === "row" ? ` · ${t("第 {0} 行", [grid.row + 1])}` : ""}`;
}

/** The three group-transform values (ΔZ, height scale, rotation); shared by the stack and the operation panel. */
export function GroupTransformFields({ region, indexTeeth = 96, deltaZ = 0, scale = 1, rotationTeeth = 0, baseHeight = 0, onDeltaChange, onScaleChange, onRotationChange }) {
  return (
    <div className="cut-stack-group-values">
      <label className="is-translate">
        <span><i />{t("升降 ΔZ")}</span>
        <span className="cut-stack-group-unit">
          <input
            type="number"
            step="0.01"
            value={deltaZ}
            onChange={(event) => onDeltaChange?.(event.target.value)}
            aria-label={t("{0}整体垂直位移", [region === "crown" ? t("冠部") : t("亭部")])}
          />
        </span>
        <small>{Number(deltaZ) >= 0 ? "+" : ""}{Number(deltaZ).toFixed(3)}</small>
      </label>
      <label className="is-scale">
        <span><i />{t("比例 H")}</span>
        <span className="cut-stack-group-unit">
          <input
            type="number"
            min="2"
            step="1"
            value={Number((scale * 100).toFixed(3))}
            onChange={(event) => onScaleChange?.(Number(event.target.value) / 100)}
            aria-label={t("{0}高度比例百分比", [region === "crown" ? t("冠部") : t("亭部")])}
          />
          <b>%</b>
        </span>
        <small>{baseHeight.toFixed(3)} → {(baseHeight * scale).toFixed(3)}</small>
      </label>
      <label className="is-rotate">
        <span><i />{t("旋转 R")}</span>
        <span className="cut-stack-group-unit">
          <input
            type="number"
            min={-indexTeeth / 2}
            max={indexTeeth / 2}
            step="any"
            value={rotationTeeth}
            onChange={(event) => onRotationChange?.(event.target.value)}
            aria-label={t("{0}{1} 分度旋转齿数", [region === "crown" ? t("冠部") : t("亭部"), indexTeeth])}
          />
          <b>T</b>
        </span>
        <small>{(rotationTeeth * 360 / indexTeeth).toFixed(2)}°</small>
      </label>
    </div>
  );
}

/** Short tool tag of a layer row, e.g. 复合·明亮式, 环切 L3×3, 网格 6×6. */
function layerTag(operation, diagnostic) {
  if (diagnostic && diagnostic.status !== "valid") return { text: t("Meet 失效"), kind: "is-stale", title: t(diagnostic.message ?? "") };
  if (operation.lockedLevels) return { text: t("{0} 组·需打散", [operation.depthLevels]), kind: "is-stale", title: t("此层含 {0} 组角度与深度，已不再对应任何刀具参数；请打散后逐层编辑。", [operation.depthLevels]) };
  if (operation.composite) return { text: t("复合·{0}", [t(operation.toolLabel)]), kind: "is-tool", title: t("复合刀具：{0}，{1} 组角度与深度，{2}", [t(operation.toolLabel), operation.depthLevels, operation.composite.snap === "exact" ? t("精确小数分度") : t("整齿")]) };
  if (operation.ring?.kind === "arc") return { text: t("弧切 L{0}×{1}", [operation.ring.symmetry, operation.ring.subdivisions]), kind: "is-tool", title: t("弧切：对称数 {0}，每弧分段 {1}，凸度 {2}，{3} 级深度", [operation.ring.symmetry, operation.ring.subdivisions, operation.ring.bulge, operation.depthLevels]) };
  if (operation.ring) return { text: t("环切 L{0}×{1}", [operation.ring.symmetry, operation.ring.subdivisions]), kind: "is-tool", title: t("环切：对称数 {0}，每边细分 {1}，间距 {2}°", [operation.ring.symmetry, operation.ring.subdivisions, operation.ring.spacingDeg]) };
  if (operation.grid) {
    const grid = operation.grid.grid;
    const size = grid.lattice === "square" ? `${grid.columns}×${grid.symmetry === 4 ? grid.columns : grid.rows}` : t("{0} 圈", [grid.rings]);
    return { text: `${t("网格")} ${size}`, kind: "is-tool", title: gridTitle(grid) };
  }
  if (diagnostic) return { text: "Meet", kind: "", title: t(diagnostic.message ?? "") };
  if (operation.preform) return { text: t("预形"), kind: "is-preform", title: "" };
  return null;
}

function layerParameters(operation) {
  const placement = operation.grid ? `${t("边缘")} ${operation.grid.edgeAngle.toFixed(2)}° · ${t("顶点")} D ${operation.grid.depth.toFixed(3)}`
    : operation.composite ? `${operation.composite.angle.toFixed(2)}° · ${t("顶点")} D ${operation.composite.depth.toFixed(3)}`
      : `${operation.industryAngleDeg.toFixed(2)}° · D ${operation.depth.toFixed(3)}`;
  return `${placement} · ${t("{0} 齿", [operation.indexTeeth ?? 96])}`;
}

const faceCount = (effective, recorded) => (effective === recorded ? `${recorded}F` : `${effective}/${recorded}F`);

export function CutStack({
  operations, selectedId, hoveredId, onSelect, onHover,
  canSelectLayers = true, canMutateStack = true, canChangeRegion = true, canStartGroup = true,
  onToggleVisibility, onRemove, onDissolveRing, onDissolveGrid, onDissolveLevels, onRename, onReorder,
  diagnosticsById = {}, activeRegion, onRegionChange, groupEditRegion, onStartGroupEdit, pendingRow = null, sessionMode = "idle",
}) {
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const cancelRenameRef = useRef(false);
  const clickTimer = useRef(0);
  const [dragIndex, setDragIndex] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);
  const listRef = useRef(null);
  const filtered = operations.filter((operation) => operation.region === activeRegion);
  useEffect(() => () => window.clearTimeout(clickTimer.current), []);
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector(".layer-row.is-selected, .layer-row.is-pending");
    if (!list || !row) return;
    const listBox = list.getBoundingClientRect(), rowBox = row.getBoundingClientRect();
    if (rowBox.top < listBox.top) list.scrollTop -= listBox.top - rowBox.top;
    else if (rowBox.bottom > listBox.bottom) list.scrollTop += rowBox.bottom - listBox.bottom;
  }, [selectedId, pendingRow?.label, activeRegion, sessionMode]);

  const startRename = (operation) => {
    window.clearTimeout(clickTimer.current);
    if (!canMutateStack || operation.locked) return;
    setRenamingId(operation.id);
    setRenameValue(operation.label);
  };
  const commitRename = (operation) => {
    const next = renameValue.trim();
    setRenamingId(null);
    if (!cancelRenameRef.current && next && next !== operation.label) onRename?.(operation.id, next);
    cancelRenameRef.current = false;
  };
  // A click on the name waits one double-click interval, so a double-click renames instead of opening the layer.
  const selectFromClick = (event, operation) => {
    if (!canSelectLayers) return;
    if (event.detail > 1) return;
    window.clearTimeout(clickTimer.current);
    const onName = event.target instanceof Element && event.target.closest(".layer-row-name");
    if (onName && canMutateStack && !operation.locked) clickTimer.current = window.setTimeout(() => onSelect(operation.id), 240);
    else onSelect(operation.id);
  };
  const drop = (targetIndex) => {
    if (dragIndex !== null && dragIndex !== targetIndex) onReorder?.(dragIndex, targetIndex);
    setDragIndex(null);
    setDropIndex(null);
  };
  const groupRegionLabel = activeRegion === "crown" ? t("冠部与台面") : t("亭部");
  const groupActive = Boolean(groupEditRegion);

  return (
    <section className="cut-stack layer-panel-stack" aria-labelledby="layer-panel-title">
      <div className="layer-panel-heading">
        <span id="layer-panel-title">{t("图层")} <i>CUT STACK</i></span>
        <small>{t("{0} / {1} 层", [filtered.length, operations.length])}</small>
      </div>
      <div className="layer-panel-filter">
        <div className="layer-panel-regions" role="tablist" aria-label={t("按部位筛选图层")}>
          {REGION_TABS.map(([id, label, short]) => (
            <button
              type="button" role="tab" key={id}
              className={activeRegion === id ? `is-active region-${id}` : ""}
              aria-selected={activeRegion === id}
              disabled={!canChangeRegion}
              onClick={() => onRegionChange?.(id)}
              title={t("查看{0}图层；切换后以{1}参数新建动作", [t(label), t(label)])}
            ><b>{short}</b>{t(label)}</button>
          ))}
        </div>
        <button
          type="button"
          className={`layer-panel-group${groupActive ? " is-active" : ""}`}
          onClick={() => onStartGroupEdit?.(activeRegion)}
          disabled={groupActive || !canStartGroup || activeRegion === "girdle"}
          aria-pressed={groupActive}
          title={activeRegion === "girdle" ? t("腰部没有整体变换") : groupActive ? t("整体变换进行中，在左侧操作栏应用或取消") : canStartGroup ? t("{0}整体变换：升降 · 比例 · 分度旋转", [groupRegionLabel]) : t("请先保存或取消当前操作")}
        >
          <IconTransform size={13} stroke={1.7} aria-hidden="true" />{t(groupActive ? "变换中" : "整体变换")}
        </button>
      </div>

      <div className="layer-panel-list" ref={listRef} role="list">
        {filtered.length === 0 && !pendingRow ? (
          <p className="layer-panel-empty">{t("{0}还没有图层。点左侧上方的“新增切割”开始一刀。", [t(REGION_TABS.find(([id]) => id === activeRegion)?.[1] ?? "")])}</p>
        ) : null}
        {filtered.map((operation) => {
          const index = operations.findIndex((item) => item.id === operation.id);
          const selected = selectedId === operation.id;
          const diagnostic = diagnosticsById[operation.id];
          const stale = diagnostic && diagnostic.status !== "valid";
          const tag = layerTag(operation, diagnostic);
          const grouped = groupEditRegion && operation.region === groupEditRegion;
          const dissolve = operation.ring ? () => onDissolveRing?.(operation.id)
            : operation.grid ? () => onDissolveGrid?.(operation.id)
              : operation.composite || operation.lockedLevels ? () => onDissolveLevels?.(operation.id) : null;
          const classes = [
            "layer-row",
            selected ? "is-selected" : "",
            grouped ? "is-grouped" : "",
            hoveredId === operation.id ? "is-hovered" : "",
            operation.visible ? "" : "is-hidden",
            canSelectLayers ? "is-selectable" : "",
            canMutateStack && !operation.locked ? "has-actions" : "",
            dragIndex === index ? "is-dragging" : "",
            dropIndex === index && dragIndex !== null && dragIndex !== index ? "is-drop-target" : "",
          ].filter(Boolean).join(" ");
          return (
            <div
              className={classes} key={operation.id} role="listitem"
              onMouseEnter={() => onHover?.(operation.id)}
              onMouseLeave={() => onHover?.(null)}
              onDragOver={(event) => { event.preventDefault(); if (dropIndex !== index) setDropIndex(index); }}
              onDrop={(event) => { event.preventDefault(); drop(index); }}
            >
              <div className="layer-row-main">
                <span
                  className="layer-row-grip"
                  draggable={!operation.locked && canMutateStack}
                  onDragStart={(event) => { setDragIndex(index); event.dataTransfer.effectAllowed = "move"; }}
                  onDragEnd={() => { setDragIndex(null); setDropIndex(null); }}
                  title={operation.locked ? t("固定结构层，始终位于序列首位") : t("拖拽调整布尔顺序")}
                  aria-hidden="true"
                ><IconGripVertical size={12} stroke={1.6} /></span>
                {renamingId === operation.id ? (
                  <span className="layer-row-renaming">
                    <span className={`cut-stack-chip region-${operation.locked ? "table" : operation.region}`} aria-hidden="true">{chipLetter(operation)}</span>
                    <input
                      className="cut-stack-rename" value={renameValue} autoFocus
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onBlur={() => commitRename(operation)}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
                        if (event.key === "Escape") { event.preventDefault(); cancelRenameRef.current = true; event.currentTarget.blur(); }
                      }}
                      aria-label={t("重命名 {0}", [operation.label])}
                    />
                  </span>
                ) : (
                  <button
                    type="button" className="layer-row-select"
                    onClick={(event) => selectFromClick(event, operation)}
                    onDoubleClick={(event) => { if (event.target instanceof Element && event.target.closest(".layer-row-name")) startRename(operation); }}
                    disabled={!canSelectLayers && !selected}
                    aria-current={selected ? "true" : undefined}
                    aria-label={selected ? t("正在编辑 {0}", [operation.label]) : t("编辑 {0}，有效 {1} 面", [operation.label, operation.effectiveCount])}
                    title={selected ? t("正在左侧操作栏编辑 {0}", [operation.label]) : canSelectLayers ? t("{0} · 单击编辑，双击名称改名", [operation.label]) : t("请先保存或取消当前操作")}
                  >
                    <span className={`cut-stack-chip region-${operation.locked ? "table" : operation.region}`} aria-hidden="true">{chipLetter(operation)}</span>
                    <span className="layer-row-name">{operation.label}</span>
                    {tag ? <span className={`layer-row-tag ${tag.kind}`} title={tag.title || undefined}>{tag.text}</span> : <span />}
                    <span className="layer-row-count" title={t("有效 {0} / 生成 {1} 面", [operation.effectiveCount, operation.recordedCount])}>{faceCount(operation.effectiveCount, operation.recordedCount)}</span>
                    <span className="layer-row-pencil" aria-hidden="true"><IconPencil size={13} stroke={1.7} /></span>
                  </button>
                )}
                {canMutateStack && !operation.locked && renamingId !== operation.id ? (
                  <span className="layer-row-actions">
                    {dissolve ? <button type="button" className="layer-row-dissolve" onClick={dissolve} aria-label={t("打散 {0}", [operation.label])} title={t("拆为普通层，切面保留（可撤销）")}>{t("打散")}</button> : null}
                    <button type="button" className="layer-row-icon is-remove" onClick={() => onRemove(operation.id)} aria-label={t("移除 {0}", [operation.label])} title={t("移除预切割动作（可撤销）")}>
                      <IconTrash size={13} stroke={1.7} />
                    </button>
                  </span>
                ) : null}
                <button
                  type="button" className="layer-row-icon"
                  onClick={() => onToggleVisibility(operation.id)}
                  aria-label={operation.locked ? t("{0} 固定参与序列", [operation.label]) : operation.visible ? t("隐藏 {0}", [operation.label]) : t("显示 {0}", [operation.label])}
                  title={operation.locked ? t("固定结构层") : operation.visible ? t("从解析结果中隐藏") : t("恢复到解析结果")}
                  disabled={operation.locked || !canMutateStack}
                >
                  {operation.visible ? <IconEye size={14} stroke={1.7} /> : <IconEyeOff size={14} stroke={1.7} />}
                </button>
              </div>
              {selected ? (
                <div className="layer-row-detail">
                  <span>{layerParameters(operation)}{operation.status === "参与解析" ? "" : ` · ${t(operation.status)}`}</span>
                  {operation.preform && tag?.kind !== "is-preform" ? <em className="layer-row-tag is-preform">{t("预形")}</em> : null}
                  {diagnostic && !stale && tag?.text !== "Meet" ? <em className="layer-row-tag">Meet</em> : null}
                  {stale ? <p role="status">{t(diagnostic.message ?? "施工来源失效；保留已保存切面，请重新编辑修复。")}</p> : null}
                </div>
              ) : null}
            </div>
          );
        })}
        {pendingRow ? (
          <div className="layer-row is-pending" role="listitem" aria-label={t("正在新建 {0}", [pendingRow.label])}>
            <div className="layer-row-main">
              <span className="layer-row-grip" aria-hidden="true" />
              <span className="layer-row-select is-static">
                <span className={`cut-stack-chip region-${activeRegion}`} aria-hidden="true">{REGION_CHIP[activeRegion] ?? "?"}</span>
                <span className="layer-row-name">{pendingRow.label}</span>
                {pendingRow.tag ? <span className="layer-row-tag is-tool">{pendingRow.tag}</span> : <span />}
                <span className="layer-row-count">{pendingRow.count}</span>
                <span className="cut-stack-pending-badge">{t("待加入")}</span>
              </span>
            </div>
            <div className="layer-row-detail"><span>{pendingRow.detail}</span></div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
