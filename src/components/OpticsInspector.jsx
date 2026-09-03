import { useEffect, useState } from "react";
import { IconAdjustments, IconChevronDown, IconDiamond, IconSparkles, IconSun, IconX } from "@tabler/icons-react";
import {
  OPTICAL_BACKGROUNDS,
  OPTICAL_ENVIRONMENTS,
  OPTICAL_PRESETS,
  applyOpticalPreset,
  criticalAngleDegrees,
  resolveOpticsSettings,
} from "../domain/optics.js";

const BODY_COLORS = [
  ["#ffffff", "无色"],
  ["#f4df73", "暖黄"],
  ["#efb4c6", "粉色"],
  ["#a9d4ff", "浅蓝"],
  ["#adddc8", "薄荷"],
];

function RangeField({ label, code, value, min, max, step, unit, digits = 3, onChange }) {
  return (
    <label className="optics-range-field">
      <span className="optics-field-label"><strong>{label}</strong><small>{code}</small></span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="optics-number-field">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={Number(value).toFixed(digits)}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {unit ? <i>{unit}</i> : null}
      </span>
    </label>
  );
}

export function OpticsInspector({ settings, tab, onTabChange, onChange, onClose }) {
  const resolved = resolveOpticsSettings(settings);
  const [colorDraft, setColorDraft] = useState(resolved.material.bodyColor);
  const updateMaterial = (changes) => onChange(resolveOpticsSettings({
    ...resolved,
    material: { ...resolved.material, ...changes },
  }));
  const updateView = (changes) => onChange(resolveOpticsSettings({
    ...resolved,
    view: { ...resolved.view, ...changes },
  }));
  const updateAdvanced = (changes) => onChange(resolveOpticsSettings({
    ...resolved,
    advanced: { ...resolved.advanced, ...changes },
  }));
  const environmentLabel = OPTICAL_ENVIRONMENTS.find((item) => item.id === resolved.view.environment)?.label;
  const backgroundLabel = OPTICAL_BACKGROUNDS.find((item) => item.id === resolved.view.background)?.label;

  useEffect(() => {
    setColorDraft(resolved.material.bodyColor);
  }, [resolved.material.bodyColor]);

  const commitColorDraft = () => {
    if (/^#[0-9a-f]{6}$/i.test(colorDraft)) {
      updateMaterial({ bodyColor: colorDraft.toLowerCase(), preset: "custom" });
    } else {
      setColorDraft(resolved.material.bodyColor);
    }
  };

  return (
    <aside className="optics-inspector" aria-label="光学仿真检查器">
      <div className="optics-inspector__heading">
        <span><IconDiamond size={17} stroke={1.6} /><strong>光学仿真</strong><small>OPTICS</small></span>
        <button type="button" onClick={onClose} aria-label="收起光学参数"><IconX size={16} stroke={1.7} /></button>
      </div>
      <div className="optics-tabs" role="tablist" aria-label="光学参数分类">
        <button type="button" role="tab" aria-selected={tab === "material"} className={tab === "material" ? "is-active" : ""} onClick={() => onTabChange("material")}>
          材质 MATERIAL
        </button>
        <button type="button" role="tab" aria-selected={tab === "view"} className={tab === "view" ? "is-active" : ""} onClick={() => onTabChange("view")}>
          视图 VIEW
        </button>
      </div>

      {tab === "material" ? (
        <div className="optics-inspector__body" role="tabpanel">
          <label className="optics-select-field">
            <span><strong>材质预设</strong><small>PRESET</small></span>
            <select
              value={resolved.material.preset}
              onChange={(event) => onChange(applyOpticalPreset(resolved, event.target.value))}
            >
              {Object.values(OPTICAL_PRESETS).map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.label}</option>
              ))}
            </select>
          </label>

          <div className="optics-physical-card">
            <div className="optics-card-title"><IconSparkles size={14} stroke={1.7} /><span>物理材质常量</span><small>PHYSICAL</small></div>
            <RangeField label="折射率" code="IOR · nD" value={resolved.material.ior} min="1.001" max="3.5" step="0.001" onChange={(ior) => updateMaterial({ ior, preset: "custom" })} />
            <RangeField label="色散" code="DISPERSION · B−G" value={resolved.material.dispersion} min="0" max="0.15" step="0.001" onChange={(dispersion) => updateMaterial({ dispersion, preset: "custom" })} />
            <div className="optics-derived-readout">
              <span>临界角 <small>CRITICAL ANGLE</small></span>
              <strong>{criticalAngleDegrees(resolved.material.ior).toFixed(1)}°</strong>
            </div>
          </div>

          <fieldset className="optics-color-field">
            <legend><strong>体色</strong><small>BODY COLOR / ABSORPTION TINT</small></legend>
            <div className="optics-swatches">
              {BODY_COLORS.map(([color, label]) => (
                <button
                  type="button"
                  key={color}
                  className={resolved.material.bodyColor.toLowerCase() === color ? "is-active" : ""}
                  style={{ "--swatch": color }}
                  onClick={() => updateMaterial({ bodyColor: color, preset: "custom" })}
                  aria-label={label}
                  title={label}
                />
              ))}
            </div>
            <details className="optics-color-picker">
              <summary>
                <span className="optics-color-preview" style={{ "--swatch": resolved.material.bodyColor }} />
                <span>自定义体色 <small>COLOR PICKER</small></span>
                <IconChevronDown size={13} stroke={1.6} />
              </summary>
              <div className="optics-color-picker__controls">
                <input
                  type="color"
                  value={resolved.material.bodyColor}
                  aria-label="自定义体色调色盘"
                  onChange={(event) => updateMaterial({ bodyColor: event.target.value, preset: "custom" })}
                />
                <input
                  type="text"
                  value={colorDraft}
                  aria-label="体色十六进制色值"
                  spellCheck="false"
                  onChange={(event) => setColorDraft(event.target.value)}
                  onBlur={commitColorDraft}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                      setColorDraft(resolved.material.bodyColor);
                      event.currentTarget.blur();
                    }
                  }}
                />
              </div>
            </details>
          </fieldset>

          <RangeField label="吸收系数" code="BEER–LAMBERT" value={resolved.material.absorption} min="0" max="0.5" step="0.005" unit="mm⁻¹" onChange={(absorption) => updateMaterial({ absorption, preset: "custom" })} />

          <details className="optics-advanced">
            <summary><IconAdjustments size={14} stroke={1.6} /><span>高级计算</span><small>ADVANCED</small></summary>
            <RangeField label="内部反射" code="MAX BOUNCES" value={resolved.advanced.maxBounces} min="2" max="8" step="1" digits={0} onChange={(maxBounces) => updateAdvanced({ maxBounces })} />
          </details>
        </div>
      ) : (
        <div className="optics-inspector__body" role="tabpanel">
          <div className="optics-view-section">
            <div className="optics-card-title"><IconSun size={14} stroke={1.7} /><span>摄影棚环境</span><small>VIEW ONLY</small></div>
            <label className="optics-select-field is-compact">
              <span><strong>环境</strong><small>ENVIRONMENT</small></span>
              <select value={resolved.view.environment} onChange={(event) => updateView({ environment: event.target.value })}>
                {OPTICAL_ENVIRONMENTS.map((environment) => <option key={environment.id} value={environment.id}>{environment.label}</option>)}
              </select>
            </label>
            <label className="optics-select-field is-compact">
              <span><strong>背景</strong><small>BACKGROUND</small></span>
              <select value={resolved.view.background} onChange={(event) => updateView({ background: event.target.value })}>
                {OPTICAL_BACKGROUNDS.map((background) => <option key={background.id} value={background.id}>{background.label}</option>)}
              </select>
            </label>
            <RangeField label="曝光" code="EXPOSURE" value={resolved.view.exposure} min="-2" max="2" step="0.05" unit="EV" digits={2} onChange={(exposure) => updateView({ exposure })} />
            <RangeField label="环境旋转" code="ROTATION" value={resolved.view.environmentRotation} min="-180" max="180" step="1" unit="°" digits={0} onChange={(environmentRotation) => updateView({ environmentRotation })} />
          </div>
          <p className="optics-view-note">环境、背景与曝光只影响观看，不改变当前文档的折射率、色散与吸收常量。</p>
        </div>
      )}

      <button type="button" className="optics-view-summary" onClick={() => onTabChange("view")}>
        <span>{environmentLabel} · {backgroundLabel}</span>
        <strong>{resolved.view.exposure >= 0 ? "+" : ""}{resolved.view.exposure.toFixed(1)} EV</strong>
      </button>
      <footer className="optics-inspector__footer">
        <span className="optics-live-dot" />
        <span>实时光线追踪</span>
        <small>FRESNEL · TIR · DISPERSION</small>
      </footer>
    </aside>
  );
}
