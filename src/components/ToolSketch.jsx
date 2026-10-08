import { useMemo } from "react";
import { t } from "../i18n/locale.js";
import "./composite-tools.css";
import { hoodSketch } from "../domain/compositeHood.js";

/**
 * Top view of a tool hood: one polygon per tool face, coloured by machining
 * level (same direction as the top view: index 0 to the right, counter-
 * clockwise). Faces that did not become facets on the stone are hollow.
 */
export function ToolSketch({ hood, size = 168, missingIds = null, outline = true, title, className = "" }) {
  const sketch = useMemo(() => hoodSketch(hood), [hood]);
  if (!sketch?.faces.length) {
    return <div className={`tool-sketch is-empty ${className}`} style={{ width: size, height: size }}>{t("刀具尚未成形")}</div>;
  }
  const r = sketch.radius * 1.04;
  return (
    <svg
      className={`tool-sketch ${className}`}
      viewBox={`${-r} ${-r} ${2 * r} ${2 * r}`}
      width={size}
      height={size}
      role="img"
      aria-label={title ?? t("刀具顶视示意")}
    >
      <g transform="scale(1,-1)">
        {outline ? <circle className="tool-sketch-rim" cx="0" cy="0" r={sketch.radius} /> : null}
        {sketch.faces.map((face) => (
          <polygon
            key={face.id}
            className={`tool-sketch-face is-level-${face.level % 8}${missingIds?.has(face.id) ? " is-missing" : ""}`}
            points={face.points.map(([x, y]) => `${x},${y}`).join(" ")}
          />
        ))}
      </g>
    </svg>
  );
}
