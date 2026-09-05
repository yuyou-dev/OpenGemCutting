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
}) {
  const disabledAngle = disabled || region === "girdle" || angleLocked;
  const disabledDepth = disabled || !depthEditable;
  const candidate = construction?.candidate;
  const meet = construction?.meet;
  const candidateLabel = candidate?.status === "unreachable"
    ? "目标不可达"
    : candidate?.status === "stale"
      ? "来源已失效"
      : candidate?.classification === "destructive"
    ? "覆盖已有面"
    : candidate?.classification === "facet"
      ? "形成有效切面"
      : candidate ? "仅接触" : "尚未定位";
  const meetLabel = meet?.status === "valid"
    ? "Meet 已锁定"
    : meet?.status === "unreachable"
      ? "目标不可达"
      : meet?.status === "destructive"
        ? "覆盖已有面"
        : meet?.status === "stale" ? "来源已失效" : "";
  return (
    <section className="mast-panel" aria-label="角度与深度参数">
      <div className="mast-parameter-grid">
        <label className="mast-parameter-block">
          <span className="mast-parameter-label">行业角 <i>β {signedBeta > 0 ? "+" : ""}{signedBeta.toFixed(2)}°</i></span>
          <input
            aria-label="行业角"
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
              aria-label="行业角数值"
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
          <span className="mast-parameter-label">切入深度</span>
          <span className="mast-slider-track">
            <input
              aria-label="切入深度"
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
              aria-label="切入深度数值"
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
        <section className={`construction-panel${meet?.status === "destructive" ? " is-warning" : meet && meet.status !== "valid" ? " is-error" : ""}`} aria-label="定位与约束">
          <div className="construction-heading">
            <strong>定位与约束</strong>
            <span>{meet ? meetLabel : candidate ? candidateLabel : nextJumpCandidate ? "已预告下一点" : candidateLabel}</span>
          </div>
          <div className="construction-actions">
            <button type="button" onClick={() => onJump?.(-1)} disabled={!canJumpPrevious} title={meet ? "先解除 Meet 才能浏览交点" : !canJumpPrevious ? "没有更浅的交点" : "上一交点 · Shift+J"}>上一交点</button>
            <button type="button" onClick={() => onJump?.(1)} disabled={!canJumpNext} title={meet ? "先解除 Meet 才能浏览交点" : !canJumpNext ? "没有更深的交点" : "下一交点 · J"}>下一交点</button>
            <button
              type="button"
              className={canCancelConstructionTool ? "is-active" : ""}
              onClick={canCancelConstructionTool ? onCancelConstructionTool : onStartMeetPick}
              disabled={!canCancelConstructionTool && !canPickMeetTarget}
            >
              {canCancelConstructionTool ? "退出选择" : "选择顶点"}
            </button>
          </div>
          {nextJumpCandidate && !meet ? (
            <p className="construction-next" role="status">
              <b>下一点 · {nextJumpCandidate.position} · {nextJumpCandidate.classification === "contact-only" ? "仅接触" : nextJumpCandidate.classification === "destructive" ? "覆盖已有面" : "形成有效切面"}</b>
              <span>D {Number(nextJumpCandidate.depth).toFixed(3)} · {nextJumpCandidate.sourceLabel ?? "实体顶点"}</span>
            </p>
          ) : null}
          {candidate ? (
            <div className="construction-readout" role="status">
              <span><b>{candidate.position ?? "—"}</b><small>候选</small></span>
              <span><b>{Number(candidate.requiredDepth ?? candidate.depth).toFixed(3)}</b><small>所需深度</small></span>
              <span><b>{candidate.sourceLabel ?? "实体顶点"}</b><small>来源</small></span>
            </div>
          ) : null}
          {meet ? (
            <p className="construction-diagnostic" role={meet.status === "unreachable" || meet.status === "stale" ? "alert" : "status"}>
              {meet.status === "valid"
                ? `自动求解深度 ${Number(meet.requiredDepth).toFixed(3)}；解除 Meet 后可调深度与浏览交点。`
                : meet.message ?? `目标需要深度 ${Number(meet.requiredDepth).toFixed(3)}，当前参数无法安全构建。`}
            </p>
          ) : candidate ? (
            <p className="construction-diagnostic">{candidateLabel} · 先预览，再锁定 Meet。</p>
          ) : (
            <p className="construction-diagnostic">
              {canCancelConstructionTool
                ? "仅显示当前可见、已提交实体的顶点；编辑时排除当前层。"
                : "J / Shift+J 浏览交点，或显式选择实体顶点。"}
            </p>
          )}
          <div className="construction-lock-row">
            {meet ? (
              <button type="button" onClick={onClearMeet}>解除 Meet</button>
            ) : (
              <button type="button" onClick={onLockMeet} disabled={!canLockMeet}>锁定 Meet</button>
            )}
          </div>
        </section>
      ) : null}

      <p className="mast-viewport-hint">桥架调行业角 · 伸缩杆调深度 · 双环调索引与镜像</p>
    </section>
  );
}
