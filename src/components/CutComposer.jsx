import { displayIndex } from "../domain/faceting.js";
import { IndexTape } from "./IndexTape.jsx";

export function CutComposer({
  patternMode,
  onPatternModeChange,
  baseIndex,
  onBaseIndexChange,
  repeatCount,
  repeatOptions,
  onRepeatChange,
  mirrorOffset,
  onMirrorChange,
  customIndices,
  onCustomIndicesChange,
  primaryIndices = [],
  primaryIndexEditable = false,
  preform = false,
  canEditPreform = false,
  onPreformChange,
  generatedCount,
  instructionGroups,
  mode,
  controlsEnabled = false,
  previewEnabled,
  lockedPattern = false,
  validationMessage,
  warningMessage,
  status,
}) {
  const editing = mode === "edit";
  const creating = mode === "create";
  const controlsDisabled = !controlsEnabled;

  return (
    <aside className="composer-panel" aria-labelledby="composer-title">
      <div className="panel-heading-row">
        <h2 id="composer-title">切割构成器</h2>
        <span>{generatedCount} 个候选面</span>
      </div>

      <div className="pattern-mode" role="group" aria-label="索引模式">
        <button
          type="button"
          className={patternMode === "symmetric" ? "is-active" : ""}
          onClick={() => onPatternModeChange("symmetric")}
          aria-pressed={patternMode === "symmetric"}
          disabled={lockedPattern || controlsDisabled}
        >
          对称模式
        </button>
        <button
          type="button"
          className={patternMode === "arbitrary" ? "is-active" : ""}
          onClick={() => onPatternModeChange("arbitrary")}
          aria-pressed={patternMode === "arbitrary"}
          disabled={lockedPattern || controlsDisabled}
        >
          自定义索引
        </button>
      </div>

      {patternMode === "symmetric" ? (
        <div className="composer-symmetry">
          <IndexTape index={baseIndex} onIndexChange={onBaseIndexChange} disabled={lockedPattern || controlsDisabled} />
          <div className="composer-symmetry-row">
            <label>
              <span>旋转重复</span>
              <select value={repeatCount} disabled={lockedPattern || controlsDisabled} onChange={(event) => onRepeatChange(Number(event.target.value))}>
                {repeatOptions.map((value) => <option value={value} key={value}>{value}</option>)}
              </select>
            </label>
            <label>
              <span>镜像轴偏移</span>
              <span className="number-with-prefix">
                <span>轴</span>
                <input
                  type="number"
                  min="0"
                  max="48"
                  value={mirrorOffset}
                  disabled={lockedPattern || controlsDisabled}
                  onChange={(event) => onMirrorChange(Number(event.target.value) || 0)}
                />
              </span>
            </label>
          </div>
        </div>
      ) : (
        <div className="composer-custom">
        <label className="custom-index-field">
          <span>整数索引列表</span>
          <textarea
            value={customIndices}
            disabled={controlsDisabled}
            onChange={(event) => onCustomIndicesChange(event.target.value)}
            rows="3"
            spellCheck="false"
            placeholder="02 22 26 46 50 70 74 94"
          />
        </label>
        <label className="custom-primary-field">
          <span>主切面分度</span>
          <select aria-label="自定义主切面分度" value={primaryIndices.includes(baseIndex) ? baseIndex : ""} disabled={!primaryIndexEditable} onChange={(event) => onBaseIndexChange(Number(event.target.value))}>
            {!primaryIndices.includes(baseIndex) ? <option value="" disabled>请选择</option> : null}
            {primaryIndices.map((index) => <option key={index} value={index}>{String(displayIndex(index)).padStart(2, "0")}</option>)}
          </select>
          <small>主切面控制 Meet / Jump 与操纵杆，必须在索引列表内。</small>
        </label>
        </div>
      )}

      {canEditPreform || preform ? (
        <label className="construction-preform-field">
          <input type="checkbox" checked={preform} disabled={!canEditPreform} onChange={(event) => onPreformChange?.(event.target.checked)} />
          <span><strong>预形工序</strong><small>标记施工用途；仍参与几何与有效面统计。</small></span>
        </label>
      ) : null}

      <div className="generated-indices">
        <div className="generated-instructions-heading">
          <strong>切割指令</strong>
          <span>INSTRUCTIONS</span>
        </div>
        {[
          ["亭部", instructionGroups.pavilion],
          ["腰部", instructionGroups.girdle],
          ["冠部", instructionGroups.crown],
        ].map(([title, rows]) => (
          <section className="generated-instruction-group" key={title}>
            <h3>{title}</h3>
            <div className={`generated-instruction-list${rows.length === 0 ? " is-empty" : ""}`} aria-label={`${title}切割指令`}>
              {rows.map((row) => (
                <div
                  className={`generated-instruction-row${row.active ? " is-active" : ""}${row.hidden ? " is-hidden" : ""}`}
                  key={row.id}
                >
                  <strong className="generated-instruction-prefix">{row.prefix}</strong>
                  <span className="generated-instruction-angle">{Number(row.angle).toFixed(2)}</span>
                  <span className="generated-instruction-indexes">
                    {row.indices.map((value) => String(displayIndex(value)).padStart(2, "0")).join("-")}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {validationMessage ? <p className="validation-message" role="alert">{validationMessage}</p> : null}
      {!validationMessage && warningMessage ? <p className="impact-warning" role="status">{warningMessage}</p> : null}

      <p className="composer-status">
        {creating ? "新建预览" : editing ? (previewEnabled ? "编辑预览" : "已选中保存图层") : mode === "group" ? "整体调整中" : "等待新建图层"} · {status}
      </p>
    </aside>
  );
}
