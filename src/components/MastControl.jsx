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
}) {
  const disabledAngle = disabled || region === "girdle" || angleLocked;
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
              disabled={disabled}
              onChange={(event) => onDepthChange(Number(event.target.value))}
            />
          </span>
          <span className="mast-number-field">
            <input
              aria-label="切入深度数值"
              type="number"
              min="0"
              step="0.001"
              value={Number(depth.toFixed(6))}
              disabled={disabled}
              onChange={(event) => onDepthChange(Number(event.target.value))}
            />
          </span>
        </label>
      </div>

      <p className="mast-viewport-hint">桥架调行业角 · 伸缩杆调深度 · 双环调索引与镜像</p>
    </section>
  );
}
