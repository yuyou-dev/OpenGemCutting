import { useMemo } from "react";
import { ringCutSketch } from "../domain/ringCut.js";
import { t } from "../i18n/locale.js";

const RANGE = 1.18;
// Top view frame: +x to the right, +y up (SVG y points down).
const svgPoint = ([x, y]) => `${x.toFixed(4)},${(-y).toFixed(4)}`;

/** Live top-view sketch of the ring being composed: ideal outline, division points and the snapped, solved outline. */
export function RingCutSketch({ ring, indexTeeth }) {
  const sketch = useMemo(() => ringCutSketch(ring, indexTeeth), [ring, indexTeeth]);
  const arc = ring.kind === "arc";
  return (
    <figure className="ring-sketch">
      <svg viewBox={`${-RANGE} ${-RANGE} ${RANGE * 2} ${RANGE * 2}`} role="img" aria-label={t("环切顶视示意")}>
        <circle className="ring-sketch-circle" cx="0" cy="0" r="1" />
        <polygon className="ring-sketch-reference" points={sketch.corners.map(svgPoint).join(" ")} />
        {sketch.arcs.map((points, side) => <polyline key={side} className="ring-sketch-arc" points={points.map(svgPoint).join(" ")} />)}
        {sketch.edges.map((edge) => (
          <line
            key={edge.index}
            className={`ring-sketch-edge is-level-${Math.min(edge.level, 3)}${edge.primary ? " is-primary" : ""}`}
            x1={edge.from[0]} y1={-edge.from[1]} x2={edge.to[0]} y2={-edge.to[1]}
          />
        ))}
        {[...sketch.corners, ...sketch.divisions].map((point, order) => <circle key={order} className="ring-sketch-point" cx={point[0]} cy={-point[1]} r="0.035" />)}
      </svg>
      <figcaption>
        {arc ? t("虚线：母形与理想圆弧 · 点：等分点 · 实线：取整后外形，颜色为深度级 · 粉：主切面")
          : t("虚线：母形 · 实线：取整后外形 · 粉：主切面")}
      </figcaption>
    </figure>
  );
}
