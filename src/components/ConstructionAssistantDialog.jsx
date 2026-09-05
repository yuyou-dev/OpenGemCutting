import { IconChevronLeft, IconChevronRight, IconAlertTriangle } from "@tabler/icons-react";
import { displayIndex } from "../domain/faceting.js";
import { Modal } from "./Modal.jsx";

/** Read-only stage navigation. The parent owns the chosen stage and its geometry. */
export function ConstructionAssistantDialog({
  stages,
  currentStageIndex,
  onStageChange,
  phase = "after",
  onPhaseChange,
  renderStage,
  onClose,
}) {
  const stage = stages[currentStageIndex];
  const firstInvalidIndex = stages.findIndex((item) => item.construction && item.construction.status !== "valid");
  const labelFor = (item) => item.label ?? item.operation?.label ?? "施工工序";
  const stale = stage?.construction && stage.construction.status !== "valid";
  const primaryIndex = stage?.construction?.primaryIndex ?? stage?.facets[0]?.metadata?.primaryIndex ?? stage?.facets[0]?.baseIndex;
  const primary = stage?.facets.find((facet) => facet.index === primaryIndex) ?? stage?.facets[0];
  const savedConstruction = stage?.facets[0]?.metadata?.construction;
  const savedTargets = [savedConstruction?.target, savedConstruction?.secondTarget].filter(Boolean);
  const sourceLabel = (target) => target.sourceOperationIds.map((id) => id === "rough-cube" ? "毛坯" : stages.find((item) => item.id === id)?.label ?? "已删除工序").join(" × ");
  return (
    <Modal title="逐层试切助理" eyebrow="CONSTRUCTION REVIEW" className="construction-assistant-dialog" closeLabel="返回工作台" onClose={onClose}>
      <p className="construction-assistant-scope">按保存序列检查每道工序前后的真实实体。查看与切换阶段不会修改设计或当前 CUT。</p>
      {stage ? (
        <>
          <div className="construction-assistant-navigation">
            <button type="button" className="secondary-button" onClick={() => onStageChange(currentStageIndex - 1)} disabled={currentStageIndex === 0} aria-label="上一施工阶段"><IconChevronLeft size={16} stroke={1.7} /></button>
            <label><span>施工阶段</span><select aria-label="施工阶段" value={currentStageIndex} onChange={(event) => onStageChange(Number(event.target.value))}>
              {stages.map((item, index) => <option key={item.id ?? item.operation?.id ?? index} value={index}>{index + 1} / {stages.length} · {labelFor(item)}{item.preform ? " · 预形" : ""}{item.construction && item.construction.status !== "valid" ? " · Meet 失效" : ""}</option>)}
            </select></label>
            <button type="button" className="secondary-button" onClick={() => onStageChange(currentStageIndex + 1)} disabled={currentStageIndex === stages.length - 1} aria-label="下一施工阶段"><IconChevronRight size={16} stroke={1.7} /></button>
          </div>
          {firstInvalidIndex >= 0 ? <button type="button" className="construction-assistant-invalid-jump" onClick={() => onStageChange(firstInvalidIndex)}><IconAlertTriangle size={15} stroke={1.6} /><span>定位首个 Meet 失效 · 第 {firstInvalidIndex + 1} 步</span></button> : null}
          <div className="construction-assistant-stage-heading">
            <div><strong>{labelFor(stage)}</strong><small>第 {currentStageIndex + 1} / {stages.length} 步{stage.preform ? " · 预形工序" : ""}</small></div>
            <div className="construction-assistant-phase" role="group" aria-label="比较施工前后">
              <button type="button" aria-pressed={phase === "before"} onClick={() => onPhaseChange("before")}>切割前</button>
              <button type="button" aria-pressed={phase === "after"} onClick={() => onPhaseChange("after")}>切割后</button>
            </div>
          </div>
          <div className="construction-assistant-stage-content">
          <div className="construction-assistant-viewport" aria-label={`${labelFor(stage)} · ${phase === "before" ? "切割前" : "切割后"}`}>{renderStage(stage, phase)}</div>
          <div className="construction-assistant-stage-details">
          <dl className="construction-assistant-parameters">
            <div><dt>行业角</dt><dd>{Number(primary.industryAngleDeg).toFixed(2)}°</dd></div>
            <div><dt>切入深度</dt><dd>{Number(primary.depth).toFixed(3)}</dd></div>
            <div><dt>主分度</dt><dd>{String(displayIndex(primary.index)).padStart(2, "0")}</dd></div>
            <div className="construction-assistant-indices"><dt>完整分度</dt><dd>{stage.facets.map((facet) => String(displayIndex(facet.index)).padStart(2, "0")).join("-")}</dd></div>
          </dl>
          {savedTargets.length ? <div className="construction-assistant-sources" aria-label="Meet 构造来源">
            {savedTargets.map((target, index) => <div key={index}><b>{index === 0 ? "A" : "B"}</b><span><strong>{target.kind === "edge-point" ? `棱上比例点 · t ${Number(target.ratio).toFixed(3)}` : "实体顶点"}</strong><small>{sourceLabel(target)}</small></span></div>)}
          </div> : null}
          {stage.hidden ? <p className="construction-assistant-hidden">此工序当前已隐藏，切割前后实体保持一致。</p> : null}

          <p className={`construction-assistant-diagnostic${stale ? " is-stale" : ""}`} role="status">
            {stale ? stage.construction.message ?? "Meet 来源已失效；已保存的明确切面保持不变。"
              : stage.construction ? "Meet 来源与当前施工顺序一致。" : "此工序未保存 Meet 约束。"}
          </p>
          <p className="construction-assistant-footnote">发现失效后，返回工作台编辑对应工序；助理不会自动修复或连带修改后续切面。</p>
          </div>
          </div>
        </>
      ) : <p className="construction-assistant-empty">当前没有可查看的施工工序。</p>}
    </Modal>
  );
}
