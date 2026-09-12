import { t } from '../i18n/locale.js';
const MODES = [
  ["edit", "编辑", null],
  ["assistant", "切割助手", ""],
  ["optics", "光学仿真", null],
];

export function ViewportModeSwitch({ mode, onModeChange }) {
  const activeLabel = MODES.find(([value]) => value === mode)?.[1] ?? "编辑";
  return (
    <div className="optics-view-switch viewport-mode-switch" role="group" aria-label={t("视口模式，当前{0}", [t(activeLabel)])}>
      {MODES.map(([value, label, badge]) => (
        <button type="button" key={value} className={mode === value ? "is-active" : ""}
          aria-pressed={mode === value} onClick={() => onModeChange(value)}>
          <span>{t(label)}</span>
          {badge ? <sup className="viewport-mode-beta">{t(badge)}</sup> : null}
        </button>
      ))}
    </div>
  );
}
