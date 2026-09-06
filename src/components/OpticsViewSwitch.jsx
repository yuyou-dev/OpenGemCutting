const VIEWS = [
  ["perspective", "透视"], ["top", "台面"], ["bottom", "亭部"],
  ["front", "正视"], ["side", "侧视"],
];

export function OpticsViewSwitch({ viewMode, onViewMode }) {
  const activeLabel = VIEWS.find(([value]) => value === viewMode)?.[1] ?? "透视";
  return (
    <div className="optics-view-switch optics-canvas-views" role="group" aria-label={`光学观察视角，当前${activeLabel}`}>
      {VIEWS.map(([value, label]) => (
        <button type="button" key={value} className={viewMode === value ? "is-active" : ""}
          aria-pressed={viewMode === value} onClick={() => onViewMode(value)}>{label}</button>
      ))}
    </div>
  );
}
