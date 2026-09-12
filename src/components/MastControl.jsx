import { t } from '../i18n/locale.js';
export function MastControl({
  region,
  industryAngle,
  signedBeta,
  depth,
  depthMax,
  onAngleChange,
  onDepthChange,
  disabled = false,
  angleLocked = false,
  depthEditable = true,
  construction = null,
  nextJumpCandidate = null,
  canUseMeetJump = false,
  canJumpPrevious = false,
  canJumpNext = false,
  canPickMeetTarget = false,
  canLockMeet = false,
  canCancelConstructionTool = false,
  onJump,
  onStartMeetPick,
  onCancelConstructionTool,
  onLockMeet,
  onClearMeet,
  canLockSecondMeet = false,
  canRemoveMeetA = false,
  canRemoveMeetB = false,
  canClearMeet = false,
  canEditEdgeRatio = false,
  onLockSecondMeet,
  onRemoveMeet,
  onEdgeRatioChange,
  onFinishEdgeEdit,
}) {
  const disabledAngle = disabled || region === "girdle" || angleLocked;
  const disabledDepth = disabled || !depthEditable;
  const candidate = construction?.candidate;
  const meet = construction?.meet;
  const secondTarget = meet?.secondTarget;
  const candidateSlot = meet ? "B" : "A";
  const edgeCandidate = candidate?.edge || candidate?.target?.kind === "edge-point";
  const edgeRatio = candidate?.ratio ?? candidate?.target?.ratio ?? 0.5;
  const candidateLabel = candidate?.status === "unreachable" ? "目标不可达"
    : candidate?.status === "stale" ? "来源已失效"
      : candidate?.status === "conflict" ? "约束冲突"
        : candidate?.classification === "destructive" ? "覆盖已有面"
          : candidate?.classification === "facet" ? "形成有效切面"
            : candidate ? "仅接触" : "尚未定位";
  const meetLabel = meet?.status === "valid" ? (secondTarget ? "双 Meet 已锁定" : "A 已锁定 · 深度求解")
    : meet?.status === "unreachable" ? "目标不可达"
      : meet?.status === "destructive" ? "覆盖已有面"
        : meet?.status === "stale" ? "来源已失效" : meet ? "约束冲突" : "";
  const targetKind = (target) => target?.kind === "edge-point"
    ? `棱上比例点 · t ${Number(target.ratio).toFixed(3)}` : "实体顶点";
  const requiredDepth = candidate?.requiredDepth ?? candidate?.depth;
  const candidateInvalid = candidate && !["valid", "destructive"].includes(candidate.status);
  const candidateMessage = candidate?.message ?? candidate?.solution?.message;
  const panelInvalid = candidateInvalid || (meet && !["valid", "destructive"].includes(meet.status));
  const previewingSecond = Boolean(meet && candidate);
  const cancelToolLabel = construction?.tool === "pick-edge" || construction?.tool === "pick-vertex" ? "退出选择"
      : "取消第二点预览";
  return (
    <section className="mast-panel" aria-label={t("角度与深度参数")}>
      <div className="mast-parameter-grid">
        <label className="mast-parameter-block">
          <span className="mast-parameter-label">{t("行业角")} <i>β {signedBeta > 0 ? "+" : ""}{signedBeta.toFixed(2)}°</i></span>
          <input
            aria-label={t("行业角")}
            type="range"
            min="0"
            max="90"
            step="0.01"
            value={industryAngle}
            disabled={disabledAngle}
            onChange={(event) => onAngleChange(Number(event.target.value))}
          />
          <span className="mast-number-field">
            <input
              aria-label={t("行业角数值")}
              type="number"
              min="0"
              max="90"
              step="0.01"
              value={Number(industryAngle.toFixed(2))}
              disabled={disabledAngle}
              onChange={(event) => onAngleChange(Number(event.target.value))}
            />
            <i>°</i>
          </span>
        </label>

        <label className="mast-parameter-block">
          <span className="mast-parameter-label">{t("切入深度")}</span>
          <span className="mast-slider-track">
            <input
              aria-label={t("切入深度")}
              type="range"
              min="0"
              max={depthMax}
              step="0.005"
              value={depth}
              disabled={disabledDepth}
              onChange={(event) => onDepthChange(Number(event.target.value))}
            />
          </span>
          <span className="mast-number-field">
            <input
              aria-label={t("切入深度数值")}
              type="number"
              min="0"
              step="0.001"
              value={depth.toFixed(3)}
              disabled={disabledDepth}
              onChange={(event) => onDepthChange(Number(event.target.value))}
            />
          </span>
        </label>
      </div>

      {canUseMeetJump ? (
        <section className={`construction-panel${panelInvalid ? " is-error" : meet?.status === "destructive" ? " is-warning" : ""}`} aria-label={t("定位与约束")}>
          <div className="construction-heading">
            <strong>{t("定位与约束")}</strong>
            <span>{t(previewingSecond ? t("预览 B · {0}", [t(candidateLabel)]) : meet ? meetLabel : candidate ? candidateLabel : nextJumpCandidate ? t("已预告下一点") : candidateLabel)}</span>
          </div>
          {meet ? (
            <div className="construction-targets" aria-label={t("已锁定约束")}>
              {[["A", meet.target, meet.sourceLabel, canRemoveMeetA], ["B", secondTarget, meet.secondSourceLabel, canRemoveMeetB]]
                .filter(([, target]) => target)
                .map(([slot, target, sourceLabel, canRemove]) => (
                  <div className="construction-target" key={slot}>
                    <b className="construction-target-slot">{t(slot)}</b>
                    <span><strong>{t(targetKind(target))}</strong><small>{sourceLabel ?? t("施工阶段实体")}</small></span>
                    <button type="button" onClick={() => onRemoveMeet?.(slot)} disabled={!canRemove} aria-label={t("解除 Meet {0}", [slot])}>{t("解除")}</button>
                  </div>
                ))}
            </div>
          ) : null}
          <div className="construction-actions">
            <button type="button" onClick={() => onJump?.(-1)} disabled={!canJumpPrevious} title={secondTarget ? t("双 Meet 已锁定；解除 B 后可继续浏览") : t("上一{0} · Shift+J", [meet ? t("个第二点") : t("交点")])}>{meet ? t("上一第二点") : t("上一交点")}</button>
            <button type="button" onClick={() => onJump?.(1)} disabled={!canJumpNext} title={secondTarget ? t("双 Meet 已锁定；解除 B 后可继续浏览") : t("下一{0} · J", [meet ? t("个第二点") : t("交点")])}>{meet ? t("下一第二点") : t("下一交点")}</button>
          </div>
          <div className="construction-actions construction-pick-actions">
            <button type="button" className={construction?.tool === "pick-vertex" ? "is-active" : ""}
              aria-pressed={construction?.tool === "pick-vertex"}
              onClick={() => onStartMeetPick?.({ kind: "vertex", slot: candidateSlot })} disabled={!canPickMeetTarget}> {t("选择顶点")}{meet ? " B" : ""}
            </button>
            <button type="button" className={construction?.tool === "pick-edge" ? "is-active" : ""}
              aria-pressed={construction?.tool === "pick-edge"}
              onClick={() => onStartMeetPick?.({ kind: "edge", slot: candidateSlot })} disabled={!canPickMeetTarget}> {t("选择棱")}{meet ? " B" : ""}
            </button>
            {canCancelConstructionTool && construction?.tool !== "edit-edge" ? <button type="button" className="construction-exit-pick" onClick={onCancelConstructionTool}>{t(cancelToolLabel)}</button> : null}
          </div>
          {nextJumpCandidate && !secondTarget ? (
            <p className="construction-next" role="status">
              <b>{t("下一")}{meet ? t("第二点") : t("点")} · {t(nextJumpCandidate.position)} · {nextJumpCandidate.classification === "contact-only" ? t("仅接触") : nextJumpCandidate.classification === "destructive" ? t("覆盖已有面") : t("形成有效切面")}</b>
              <span>{t(meet && Number.isFinite(nextJumpCandidate.industryAngleDeg) ? `A ${nextJumpCandidate.industryAngleDeg.toFixed(2)}° · ` : "")}D {Number(nextJumpCandidate.depth).toFixed(3)} · {nextJumpCandidate.sourceLabel ?? t("实体顶点")}</span>
            </p>
          ) : null}
          {candidate ? (
            <div className="construction-readout" role="status">
              <span><b>{t(candidateSlot)} · {t(candidate.position ?? "—")}</b><small>{t("候选")}</small></span>
              <span><b>{Number.isFinite(requiredDepth) ? requiredDepth.toFixed(3) : "—"}</b><small>{t("所需深度")}</small></span>
              <span><b title={candidate.sourceLabel}>{candidate.sourceLabel ?? t("实体顶点")}</b><small>{t("来源")}</small></span>
            </div>
          ) : null}
          {edgeCandidate ? (
            <div className="construction-edge-editor" aria-label={t("棱上比例点")}>
              <label><span>{t("沿棱比例 t")}</span><input type="number" min="0" max="1" step="0.001" value={edgeRatio} disabled={!canEditEdgeRatio}
                onChange={(event) => { const value = event.target.valueAsNumber; if (Number.isFinite(value) && value >= 0 && value <= 1) onEdgeRatioChange?.(value); }} /></label>
              <div className="construction-ratio-presets" role="group" aria-label={t("比例预设")}>
                {[["¼", 1/4], ["⅓", 1/3], ["½", 1/2], ["⅔", 2/3], ["¾", 3/4], ["0.95", .95]].map(([label, value]) => (
                  <button type="button" key={label} aria-pressed={Math.abs(edgeRatio - value) < 1e-8} disabled={!canEditEdgeRatio} onClick={() => onEdgeRatioChange?.(value)}>{t(label)}</button>
                ))}
              </div>
              <p>{t("t = 0 为起点，t = 1 为终点；方向随棱保持固定。")}</p>
              {construction?.tool === "edit-edge" ? <button type="button" className="construction-edge-done" onClick={onFinishEdgeEdit}>{t("完成比例调整")}</button> : null}
            </div>
          ) : null}
          <p className="construction-diagnostic" role={panelInvalid ? "alert" : "status"}>
            {t(candidateInvalid ? candidateMessage || t("{0}，请调整分度或重新选择目标。", [t(candidateLabel)])
              : meet?.status === "destructive" ? t("当前轨道会覆盖已有面；保存前仍会检查完整重复与镜像的影响。")
                : meet && meet.status !== "valid" ? meet.message || t("约束无法求解，请调整分度或解除目标后重选。")
              : candidate ? t("{0} · 预览后锁定 {1}，才建立约束。", [t(candidateLabel), candidateSlot])
                : secondTarget ? t("行业角与深度由 A / B 联合求解；解除 B 后保留单 Meet。")
                  : meet ? t("深度由 A 自动求解。可浏览或选择第二点 B，联合求解行业角。")
                    : canCancelConstructionTool ? t("仅拾取前序施工实体上可见的顶点或棱；Esc 退出选择。")
                      : t("J / Shift+J 浏览交点，V 选择顶点，M 锁定 A。"))}
          </p>
          <div className="construction-lock-row">
            {meet ? <button type="button" className="construction-clear" onClick={onClearMeet} disabled={!canClearMeet}>{t("清除全部")}</button> : null}
            {!secondTarget ? <button type="button" onClick={meet ? onLockSecondMeet : onLockMeet} disabled={meet ? !canLockSecondMeet : !canLockMeet}>
              {meet ? t("锁定 B · 双 Meet") : t("锁定 Meet A")}
            </button> : null}
          </div>
        </section>
      ) : null}

      <p className="mast-viewport-hint">{t("桥架调行业角 · 伸缩杆调深度 · 双环调索引与镜像")}</p>
    </section>
  );
}
