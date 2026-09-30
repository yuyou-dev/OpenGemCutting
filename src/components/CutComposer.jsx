import { t } from '../i18n/locale.js';
import { displayIndex } from "../domain/faceting.js";
import { IndexTape } from "./IndexTape.jsx";
import { RingCutSketch } from "./RingCutSketch.jsx";
import { ARC_TWO_SIDED_MIN_BULGE, DEFAULT_RING_CUT, RING_CUT_KINDS, RING_CUT_LIMITS } from "../domain/ringCut.js";

export function CutComposer({
  patternMode,
  onPatternModeChange,
  baseIndex,
  indexTeeth = 96,
  onBaseIndexChange,
  repeatCount,
  onRepeatChange,
  mirrorOffset,
  onMirrorChange,
  customIndices,
  onCustomIndicesChange,
  ring = null,
  ringLayout = null,
  onRingChange,
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
  const activeMode = ring ? "ring" : patternMode;
  const ringField = (key, value) => onRingChange?.({ ...ring, [key]: value });

  return (
    <aside className="composer-panel" aria-labelledby="composer-title">
      <div className="panel-heading-row">
        <h2 id="composer-title">{t("切割构成器")}</h2>
        <span>{t(generatedCount)} {t("个候选面")}</span>
      </div>

      <div className="pattern-mode" role="group" aria-label={t("索引模式")}>
        <button
          type="button"
          className={patternMode === "symmetric" ? "is-active" : ""}
          onClick={() => onPatternModeChange("symmetric")}
          aria-pressed={patternMode === "symmetric"}
          disabled={lockedPattern || controlsDisabled}
        > {t("对称模式")} </button>
        <button
          type="button"
          className={activeMode === "arbitrary" ? "is-active" : ""}
          onClick={() => onPatternModeChange("arbitrary")}
          aria-pressed={activeMode === "arbitrary"}
          disabled={lockedPattern || controlsDisabled}
        > {t("自定义索引")} </button>
        <button
          type="button"
          className={activeMode === "ring" ? "is-active" : ""}
          onClick={() => { if (!ring) onRingChange?.({ ...DEFAULT_RING_CUT, rotation: Math.round(baseIndex) % indexTeeth }); }}
          aria-pressed={activeMode === "ring"}
          disabled={lockedPattern || controlsDisabled}
        > {t("环切")} </button>
      </div>

      {activeMode === "ring" ? (
        <div className="composer-ring">
          <IndexTape indexTeeth={indexTeeth} index={baseIndex} onIndexChange={onBaseIndexChange} disabled={controlsDisabled} />
          <div className="composer-ring-kind" role="group" aria-label={t("环切形式")}>
            {RING_CUT_KINDS.map((kind) => (
              <button
                key={kind.id}
                type="button"
                className={(ring.kind ?? "fan") === kind.id ? "is-active" : ""}
                aria-pressed={(ring.kind ?? "fan") === kind.id}
                disabled={controlsDisabled}
                onClick={() => { if ((ring.kind ?? "fan") !== kind.id) onRingChange?.({ ...kind.defaults, symmetry: ring.symmetry, subdivisions: ring.subdivisions, rotation: ring.rotation }); }}
              >{t(kind.label)}</button>
            ))}
          </div>
          {ring.kind === "arc" ? (
            <>
              <div className="composer-ring-row is-two">
                <label>
                  <span>{t("对称数")}</span>
                  <input type="number" min={RING_CUT_LIMITS.symmetry[0]} max={RING_CUT_LIMITS.symmetry[1]} step="1" aria-label={t("环切对称数")} value={ring.symmetry} disabled={controlsDisabled} onChange={(event) => ringField("symmetry", Number(event.target.value))} />
                </label>
                <label>
                  <span>{t("每弧分段")}</span>
                  <input type="number" min={ring.symmetry === 2 ? 2 : RING_CUT_LIMITS.subdivisions[0]} max={RING_CUT_LIMITS.subdivisions[1]} step="1" aria-label={t("弧切每弧分段")} value={ring.subdivisions} disabled={controlsDisabled} onChange={(event) => ringField("subdivisions", Number(event.target.value))} />
                </label>
              </div>
              <label className="composer-ring-bulge">
                <span>{t("凸度")}<small>{t("0 直边 · 1 整圆")}</small></span>
                <input type="range" min={ring.symmetry === 2 ? ARC_TWO_SIDED_MIN_BULGE : 0} max="1" step="0.01" aria-label={t("弧切凸度滑块")} value={ring.bulge} disabled={controlsDisabled} onChange={(event) => ringField("bulge", Number(event.target.value))} />
                <input type="number" min={ring.symmetry === 2 ? ARC_TWO_SIDED_MIN_BULGE : 0} max="1" step="0.05" aria-label={t("弧切凸度")} value={ring.bulge} disabled={controlsDisabled} onChange={(event) => ringField("bulge", Number(event.target.value))} />
              </label>
            </>
          ) : (
            <div className="composer-ring-row">
              <label>
                <span>{t("对称数")}</span>
                <input type="number" min={RING_CUT_LIMITS.symmetry[0]} max={RING_CUT_LIMITS.symmetry[1]} step="1" aria-label={t("环切对称数")} value={ring.symmetry} disabled={controlsDisabled} onChange={(event) => ringField("symmetry", Number(event.target.value))} />
              </label>
              <label>
                <span>{t("每边细分")}</span>
                <input type="number" min={RING_CUT_LIMITS.subdivisions[0]} max={RING_CUT_LIMITS.subdivisions[1]} step="1" aria-label={t("环切每边细分")} value={ring.subdivisions} disabled={controlsDisabled} onChange={(event) => ringField("subdivisions", Number(event.target.value))} />
              </label>
              <label>
                <span>{t("细分间距 °")}</span>
                <input type="number" min={RING_CUT_LIMITS.spacingDeg[0]} max={RING_CUT_LIMITS.spacingDeg[1]} step="0.5" aria-label={t("环切细分间距")} value={ring.spacingDeg} disabled={controlsDisabled || ring.subdivisions < 2} onChange={(event) => ringField("spacingDeg", Number(event.target.value))} />
              </label>
            </div>
          )}
          {ringLayout ? <RingCutSketch ring={ring} indexTeeth={indexTeeth} /> : null}
          {ringLayout && ring.kind === "arc" ? (
            <div className="composer-ring-summary" role="status">
              <strong>{t("弧切 L{0}×{1} · {2} 面 · {3} 级深度", [ring.symmetry, ring.subdivisions, ringLayout.indices.length, ringLayout.levels.length])}</strong>
              <span className="composer-ring-levels">{t("离心距离")}{ringLayout.levels.map((level, order) => (
                <em key={level.offset} className={`is-level-${Math.min(order, 3)}`}>{`${Number((level.ratio * 100).toFixed(1))}%×${level.indices.length}`}</em>
              ))}</span>
              {!ringLayout.exactSymmetry ? <span className="is-warning">{t("{0} 齿不能整齿等分 {1} 边：边中心已就近取整，边距相差 1 齿。", [indexTeeth, ring.symmetry])}</span> : null}
              {ringLayout.merged > 0 ? <span className="is-warning">{t("弧段取整到同一分度，已合并 {0} 面；可加大凸度或减少分段。", [ringLayout.merged])}</span> : null}
              {ringLayout.degenerate ? <span className="is-warning">{t("取整后面数不足以围成外形，请加大凸度。")}</span> : null}
              {ringLayout.residual > 0.02 ? <span className="is-warning">{t("整齿取整使拐点偏离弧线 {0}%（按外接圆半径）。", [Number((ringLayout.residual * 100).toFixed(1))])}</span> : null}
              <small>{t("深度输入对应主切面（最外一级）；其余各级按离心距离联动加深。Meet／Jump 作用于主切面；要逐级 Meet，请先在 CUT STACK 打散为各级普通层。")}</small>
            </div>
          ) : ringLayout ? (
            <div className="composer-ring-summary" role="status">
              <strong>{t("环切 L{0}×{1} · {2} 面", [ring.symmetry, ring.subdivisions, ringLayout.indices.length])}</strong>
              {ring.subdivisions > 1 ? <span>{t("实际间距 {0}° · 偏移 {1} 齿", [Number(ringLayout.actualSpacingDeg.toFixed(2)), ringLayout.offsets.filter((offset) => offset > 0).map((offset) => `±${offset}`).join(" ")])}</span> : null}
              {!ringLayout.exactSymmetry ? <span className="is-warning">{t("{0} 齿不能整齿等分 {1} 边：边中心已就近取整，边距相差 1 齿。", [indexTeeth, ring.symmetry])}</span> : null}
              {ringLayout.merged > 0 ? <span className="is-warning">{t("相邻边的细分面重合，已合并 {0} 面；可减小间距。", [ringLayout.merged])}</span> : null}
              {!ringLayout.merged && ringLayout.crossesNeighbours ? <span className="is-warning">{t("细分扇面宽过一条边，会越过相邻边的中心。")}</span> : null}
              <small>{t("整组旋转用分度带或操纵环；行业角与深度整组共用。改选“对称模式”或“自定义索引”会打散环切，保留现有切面。")}</small>
            </div>
          ) : null}
        </div>
      ) : activeMode === "symmetric" ? (
        <div className="composer-symmetry">
          <IndexTape indexTeeth={indexTeeth} index={baseIndex} onIndexChange={onBaseIndexChange} disabled={lockedPattern || controlsDisabled} />
          <div className="composer-symmetry-row">
            <label>
              <span>{t("旋转重复")}</span>
              <input type="number" min="1" max="360" step="1" aria-label={t("旋转重复")} value={repeatCount} disabled={lockedPattern || controlsDisabled} onChange={(event) => onRepeatChange(Number(event.target.value))} />
            </label>
            <label>
              <span>{t("镜像轴偏移")}</span>
              <span className="number-with-prefix">
                <span>{t("轴")}</span>
                <input
                  type="number"
                  min="0"
                  max={indexTeeth / 2}
                  step="any"
                  aria-label={t("镜像轴偏移")}
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
          <span>{t("索引列表（支持小数）")}</span>
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
          <span>{t("主切面分度")}</span>
          <select aria-label={t("自定义主切面分度")} value={primaryIndices.includes(baseIndex) ? baseIndex : ""} disabled={!primaryIndexEditable} onChange={(event) => onBaseIndexChange(Number(event.target.value))}>
            {!primaryIndices.includes(baseIndex) ? <option value="" disabled>{t("请选择")}</option> : null}
            {primaryIndices.map((index) => <option key={index} value={index}>{String(displayIndex(index, indexTeeth)).padStart(2, "0")}</option>)}
          </select>
          <small>{t("主切面控制 Meet / Jump 与操纵杆，必须在索引列表内。")}</small>
        </label>
        </div>
      )}

      {canEditPreform || preform ? (
        <label className="construction-preform-field">
          <input type="checkbox" checked={preform} disabled={!canEditPreform} onChange={(event) => onPreformChange?.(event.target.checked)} />
          <span><strong>{t("预形工序")}</strong><small>{t("标记施工用途；仍参与几何与有效面统计。")}</small></span>
        </label>
      ) : null}

      <div className="generated-indices">
        <div className="generated-instructions-heading">
          <strong>{t("切割指令")}</strong>
          <span>INSTRUCTIONS</span>
        </div>
        {[
          [t("亭部"), instructionGroups.pavilion],
          [t("腰部"), instructionGroups.girdle],
          [t("冠部"), instructionGroups.crown],
        ].map(([title, rows]) => (
          <section className="generated-instruction-group" key={title}>
            <h3>{t(title)}</h3>
            <div className={`generated-instruction-list${rows.length === 0 ? " is-empty" : ""}`} aria-label={t("{0}切割指令", [t(title)])}>
              {rows.map((row) => (
                <div
                  className={`generated-instruction-row${row.active ? " is-active" : ""}${row.hidden ? " is-hidden" : ""}`}
                  key={row.id}
                >
                  <strong className="generated-instruction-prefix" title={t("{0} 齿", [row.indexTeeth ?? 96])}>{t(row.prefix)}</strong>
                  <span className="generated-instruction-angle">{Number(row.angle).toFixed(2)}</span>
                  <span className="generated-instruction-indexes" title={t("{0} 齿分度", [row.indexTeeth ?? 96])}>
                    {row.indices.map((value) => String(displayIndex(value, row.indexTeeth ?? 96)).padStart(2, "0")).join("-")}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {validationMessage ? <p className="validation-message" role="alert">{t(validationMessage)}</p> : null}
      {!validationMessage && warningMessage ? <p className="impact-warning" role="status">{t(warningMessage)}</p> : null}

      <p className="composer-status">
        {creating ? t("新建预览") : editing ? (previewEnabled ? t("编辑预览") : t("已选中保存图层")) : mode === "group" ? t("整体调整中") : t("等待新建图层")} · {t(status)}
      </p>
    </aside>
  );
}
