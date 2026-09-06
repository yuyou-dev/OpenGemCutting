import { useMemo } from "react";
import { projectTechnicalPreview } from "../domain/technicalPreview.js";

function faceFill(face, activeOperationId, previewOperationId, highlightOperationId) {
  if (activeOperationId && face.sourceOperationId === activeOperationId) return "#f8b5ce";
  if (previewOperationId && face.sourceOperationId === previewOperationId) return "#aad5f4";
  if (highlightOperationId && face.sourceOperationId === highlightOperationId) return "#ee8dac";
  return "#f3f4f2";
}

export function TechnicalPreview({
  solid,
  view = "isometric",
  label,
  className = "",
  activeOperationId,
  previewOperationId,
  highlightOperationId,
}) {
  const projection = useMemo(() => projectTechnicalPreview(solid, view), [solid, view]);
  return (
    <svg
      className={`technical-preview ${className}`.trim()}
      viewBox={`0 0 ${projection.width} ${projection.height}`}
      role="img"
      aria-label={label || projection.label}
    >
      {projection.faces.map((face, index) => (
        <polygon
          key={face.id ?? index}
          points={face.vertexIndices.map((vertexIndex) => {
            const point = projection.points[vertexIndex];
            return `${point.x},${point.y}`;
          }).join(" ")}
          fill={faceFill(face, activeOperationId, previewOperationId, highlightOperationId)}
        />
      ))}
      <g stroke="#343936" strokeWidth="0.85" fill="none" strokeLinejoin="round">
        {projection.edges.map(([start, end]) => (
          <line
            key={`${start}:${end}`}
            x1={projection.points[start].x}
            y1={projection.points[start].y}
            x2={projection.points[end].x}
            y2={projection.points[end].y}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    </svg>
  );
}
