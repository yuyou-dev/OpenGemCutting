const MODES = [
  ["edit", "编辑", null],
  ["assistant", "切割助手", ""],
  ["optics", "光学仿真", null],
];

export function ViewportModeSwitch({ mode, onModeChange }) {
  const activeLabel = MODES.find(([value]) => value === mode)?.[1] ?? "编辑";
  return (
    <div className="optics-view-switch viewport-mode-switch" role="group" aria-label={`视口模式，当前${activeLabel}`}>
      {MODES.map(([value, label, badge]) => (
        <button type="button" key={value} className={mode === value ? "is-active" : ""}
          aria-pressed={mode === value} onClick={() => onModeChange(value)}>
          <span>{label}</span>
          {badge ? <sup className="viewport-mode-beta">{badge}</sup> : null}
        </button>
      ))}
    </div>
  );
}
