import { t } from '../i18n/locale.js';
const VIEWS = [
  ["perspective", "透视"], ["top", "台面"], ["bottom", "亭部"],
  ["front", "正视"], ["side", "侧视"],
];

export function OpticsViewSwitch({ viewMode, onViewMode, inspectorOpen = true }) {
  const activeLabel = VIEWS.find(([value]) => value === viewMode)?.[1] ?? "透视";
  return (
    <div className={`optics-view-switch optics-canvas-views${inspectorOpen ? " is-inspector-open" : ""}`} role="group" aria-label={t("光学观察视角，当前{0}", [t(activeLabel)])}>
      {VIEWS.map(([value, label]) => (
        <button type="button" key={value} className={viewMode === value ? "is-active" : ""}
          aria-pressed={viewMode === value} onClick={() => onViewMode(value)}>{t(label)}</button>
      ))}
    </div>
  );
}
