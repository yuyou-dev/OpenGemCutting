import { useRef } from 'react';

export function Dome({ api, state }) {
  const ref = useRef(null);
  const drag = useRef(false);
  const endDrag = () => { if (drag.current) { drag.current = false; api.endLightDrag(); } };
  const cancelDrag = () => { if (drag.current) { drag.current = false; api.cancelLightDrag(); } };
  return <svg ref={ref} className="lightlab-dome" viewBox="0 0 252 247" role="group" aria-label="灯光方位角与仰角编辑穹顶" onPointerMove={e => {
    if (!drag.current) return;
    const point = e.currentTarget.createSVGPoint();
    point.x = e.clientX; point.y = e.clientY;
    const local = point.matrixTransform(e.currentTarget.getScreenCTM().inverse());
    api.dragLightTo(local.x, local.y);
  }} onPointerUp={endDrag} onPointerCancel={cancelDrag} onLostPointerCapture={endDrag} onKeyDown={e => { if (e.key === 'Escape') { cancelDrag(); e.stopPropagation(); } }}>
    <circle cx="126" cy="123" r="92" className="lightlab-dome-fill" />
    {[30, 60, 90].map(angle => <circle key={angle} cx="126" cy="123" r={angle / 90 * 92} className="lightlab-dome-ring" />)}
    <path d="M34 123h184M126 31v184" className="lightlab-dome-ring" />
    <text x="126" y="17" textAnchor="middle">0°</text><text x="236" y="127" textAnchor="middle">90°</text><text x="126" y="236" textAnchor="middle">180°</text><text x="16" y="127" textAnchor="middle">270°</text>
    <text x="131" y="67" className="lightlab-dome-ring-label">30°</text><text x="131" y="97" className="lightlab-dome-ring-label">60°</text>
    {state.domeMarks.map(mark => <g key={mark.id} tabIndex={0} role="button" aria-label={`移动 ${mark.name}`} className={`lightlab-dome-light${mark.selected ? ' selected' : ''}${mark.enabled ? '' : ' off'}${mark.blocker ? ' blocker' : ''}`} onPointerDown={e => {
      e.preventDefault();
      if (api.beginLightDrag(mark.id) === false) return;
      drag.current = true;
      e.currentTarget.focus();
      ref.current.setPointerCapture(e.pointerId);
    }} onKeyDown={e => {
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
      if (!arrows[e.key]) return;
      e.preventDefault();
      const [dx, dy] = arrows[e.key], step = e.shiftKey ? 5 : 1;
      api.nudgeLight(mark.id, dx * step, dy * step);
    }}>
      <ellipse cx={mark.x} cy={mark.y} rx={mark.rx} ry={mark.ry} transform={`rotate(${mark.rotation} ${mark.x} ${mark.y})`} className="lightlab-dome-footprint" />
      <circle cx={mark.x} cy={mark.y} r={mark.selected ? 11 : 9} className="lightlab-dome-point" /><text x={mark.x} y={mark.y + 3.6} textAnchor="middle">{mark.index + 1}</text>
    </g>)}
  </svg>;
}
