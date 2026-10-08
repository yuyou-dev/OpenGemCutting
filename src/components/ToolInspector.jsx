import { useState } from "react";
import { t } from "../i18n/locale.js";
import "./composite-tools.css";
import { COMPOSITE_PARAM_GROUPS } from "../domain/compositeTools.js";
import { gridSymmetryAvailable } from "../domain/gridCut.js";
import { toolPreviewHood } from "../application/compositeToolSession.js";
import { IndexTape } from "./IndexTape.jsx";
import { ToolSketch } from "./ToolSketch.jsx";

const labelOf = (param, values) => (typeof param.label === "function" ? param.label(values) : param.label);
const optionsOf = (param, values) => (typeof param.options === "function" ? param.options(values) : param.options);

/** A numeric field: label, slider and exact input on one row. `offset` shows a 0-based counter from 1. */
function NumberField({ label, hint, value, min, max, step, onChange, disabled, percent = false, suffix = "", offset = 0 }) {
  const shown = percent ? Math.round(value * 100) : Number(Number(value + offset).toFixed(step < 0.01 ? 3 : 2));
  // Typing keeps its own text: "1" on the way to "12" must not be clamped to the minimum.
  const [text, setText] = useState(null);
  const scale = percent ? 100 : 1;
  const commit = (raw) => {
    const number = Number(raw) / scale - offset;
    if (raw !== "" && Number.isFinite(number) && number >= min - 1e-9 && number <= max + 1e-9) onChange(number);
  };
  return (
    <label className="tool-field">
      <span className="tool-field-label">{t(label)}{hint ? <small>{t(hint)}</small> : null}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} aria-label={t(label)} onChange={(event) => onChange(Number(event.target.value))} />
      <span className="tool-field-number">
        <input
          type="number" aria-label={t("{0}数值", [t(label)])} disabled={disabled}
          min={Math.round((min + offset) * scale * 1000) / 1000} max={Math.round((max + offset) * scale * 1000) / 1000} step={percent ? 1 : step}
          value={text ?? shown}
          onChange={(event) => { setText(event.target.value); commit(event.target.value); }}
          onBlur={() => setText(null)}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        />
        {percent ? <i>%</i> : suffix ? <i>{suffix}</i> : null}
      </span>
    </label>
  );
}

/**
 * Parameters of the active composite tool in four fixed groups — symmetry,
 * form, placement, machining — so every tool reads the same way. Placement
 * writes the CUT draft (angle, depth, whole-tooth rotation, extent); the
 * rest writes the tool's own shape. Nothing here decides availability:
 * `disabled` comes from the CUT session's capability bits.
 */
export function ToolInspector({
  tool, params, draft, region, indexTeeth = 96, report = null, disabled = false, depthMax = 2,
  onParams, onPlacement, onExtent, onSnap, onFit, onPreset, showPresets = true,
  angleLocked = false, depthLocked = false, placementExtra = null,
}) {
  if (!tool || !params) return null;
  const optionDisabled = (param, value) => (tool.engine === "grid" && param.key === "symmetry" && !gridSymmetryAvailable(value, indexTeeth, false)
    ? t("{0} 齿不能整齿等分 {1} 次对称。", [indexTeeth, value]) : "");
  const field = (param) => {
    if (param.when && !param.when(params)) return null;
    const label = labelOf(param, params);
    if (param.type === "choice") {
      return (
        <div className="tool-field is-choice" key={`${param.key}-${label}`}>
          <span className="tool-field-label">{t(label)}</span>
          <div className="tool-choice" role="group" aria-label={t(label)}>
            {optionsOf(param, params).map(([value, optionLabel]) => {
              const reason = optionDisabled(param, value);
              return (
                <button
                  key={String(value)} type="button"
                  className={params[param.key] === value ? "is-active" : ""} aria-pressed={params[param.key] === value}
                  disabled={disabled || Boolean(reason)} title={reason || undefined}
                  onClick={() => onParams?.({ [param.key]: value })}
                >{t(optionLabel)}</button>
              );
            })}
          </div>
        </div>
      );
    }
    if (param.type === "bool") {
      const reason = tool.engine === "grid" && param.key === "mirror" && !gridSymmetryAvailable(params.symmetry, indexTeeth, true)
        ? t("{0} 齿不能让 {1} 次对称的镜像轴落在整齿上。", [indexTeeth, params.symmetry]) : "";
      return (
        <label className="tool-field is-check" key={param.key} title={reason || undefined}>
          <input type="checkbox" checked={Boolean(params[param.key])} disabled={disabled || Boolean(reason)} onChange={(event) => onParams?.({ [param.key]: event.target.checked })} />
          <span>{t(label)}</span>
        </label>
      );
    }
    return (
      <NumberField
        key={`${param.key}-${label}`} label={label} hint={param.hint} value={Number(params[param.key] ?? param.min)}
        min={param.min} max={param.max} step={param.step} percent={param.percent} offset={param.offset} disabled={disabled}
        onChange={(value) => onParams?.({ [param.key]: param.type === "int" ? Math.round(value) : value })}
      />
    );
  };
  const groups = COMPOSITE_PARAM_GROUPS.filter((group) => ["symmetry", "form"].includes(group.id))
    .map((group) => ({ ...group, fields: tool.params.filter((param) => param.group === group.id).map(field).filter(Boolean) }))
    .filter((group) => group.fields.length);
  const extent = draft.grid?.extent ?? draft.composite?.extent;
  const angleRange = tool.angle;
  return (
    <div className="tool-inspector">
      {showPresets && tool.presets?.length ? (
        <div className="tool-presets" role="group" aria-label={t("预设")}>
          {tool.presets.map((preset) => (
            <button key={preset.id} type="button" className="tool-preset" disabled={disabled} onClick={() => onPreset?.(preset.params)} title={t(preset.label)}>
              <ToolSketch hood={toolPreviewHood(tool.id, { region, indexTeeth, params: preset.params })} size={34} outline={false} />
              <span>{t(preset.label)}</span>
            </button>
          ))}
        </div>
      ) : null}
      {groups.map((group) => (
        <section className="tool-group" key={group.id} aria-label={t(group.label)}>
          <h4>{t(group.label)}</h4>
          {group.fields}
        </section>
      ))}
      <section className="tool-group" aria-label={t("放置")}>
        <h4>{t("放置")}<small>{t("整把刀作为一个零件装在机台主轴上")}</small></h4>
        <NumberField
          label={angleRange.label} value={Number(draft.industryAngle)} min={angleRange.min} max={region === "girdle" ? 90 : angleRange.max}
          step={0.01} suffix="°" disabled={disabled || region === "girdle" || angleLocked} onChange={(value) => onPlacement?.({ industryAngle: value })}
        />
        <NumberField
          label={tool.depth.label} hint={depthLocked ? "由 Meet 约束求解" : tool.depth.hint} value={Number(draft.depth)} min={0} max={depthMax} step={0.001}
          disabled={disabled || depthLocked} onChange={(value) => onPlacement?.({ depth: Math.max(0, value) })}
        />
        <div className="tool-field is-tape">
          <span className="tool-field-label">{t("整组旋转")}<small>{t("整齿")}</small></span>
          <IndexTape indexTeeth={indexTeeth} index={draft.baseIndex} onIndexChange={(value) => onPlacement?.({ baseIndex: Math.round(value) })} disabled={disabled} />
        </div>
        {extent !== undefined && extent !== null ? (
          <div className="tool-field-row">
            <NumberField label={tool.engine === "grid" ? "范围" : "刀具半径"} hint={tool.engine === "grid" ? "参考半径的倍数" : "腰线半径的倍数"} value={Number(extent)} min={0.2} max={tool.engine === "grid" ? 1.2 : 1.5} step={0.005} disabled={disabled} onChange={(value) => onExtent?.(value)} />
            <button type="button" className="tool-fit" disabled={disabled || !onFit} onClick={() => onFit?.()}>{t("贴合腰线")}</button>
          </div>
        ) : null}
        {placementExtra}
      </section>
      <section className="tool-group is-machining" aria-label={t("加工")}>
        <h4>{t("加工")}<small>{t("每个刀面都是一组标准分度、行业角与深度")}</small></h4>
        {draft.composite ? (
          <div className="tool-field is-choice">
            <span className="tool-field-label">{t("分度取整")}</span>
            <div className="tool-choice" role="group" aria-label={t("分度取整")}>
              {[["tooth", "整齿（推荐）"], ["exact", "精确小数"]].map(([value, label]) => (
                <button key={value} type="button" className={(draft.composite.snap ?? "tooth") === value ? "is-active" : ""} aria-pressed={(draft.composite.snap ?? "tooth") === value} disabled={disabled} onClick={() => onSnap?.(value)}>{t(label)}</button>
              ))}
            </div>
          </div>
        ) : null}
        {report ? (
          <div className="tool-report" role="status">
            <strong>{t("{0} 面 · {1} 组角度与深度 · {2} 次对称", [report.facets, report.levels, report.order])}</strong>
            {report.notes.map((note) => <span key={note}>{t(note)}</span>)}
            {report.warnings.map((warning) => <span key={warning} className="is-warning">{t(warning)}</span>)}
          </div>
        ) : null}
      </section>
    </div>
  );
}
