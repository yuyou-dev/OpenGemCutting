import { t } from '../i18n/locale.js';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { renderTechnicalMesh } from "./meshTechnicalRenderer.js";
import { projectTechnicalPreview } from "../domain/technicalPreview.js";

function faceFill(face, activeOperationId, previewOperationId, highlightOperationId) {
  if (activeOperationId && face.sourceOperationId === activeOperationId) return "#f8b5ce";
  if (previewOperationId && face.sourceOperationId === previewOperationId) return "#aad5f4";
  if (highlightOperationId && face.sourceOperationId === highlightOperationId) return "#ee8dac";
  return "#f3f4f2";
}

function VectorTechnicalPreview({
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
      aria-label={label || t(projection.label)}
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
      <path
        d={projection.edges.map(([start, end]) => {
          const a = projection.points[start];
          const b = projection.points[end];
          return `M${a.x},${a.y}L${b.x},${b.y}`;
        }).join(" ")}
        stroke="#343936"
        strokeWidth="0.85"
        fill="none"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function MeshTechnicalPreview(props) {
  const { solid, view = "isometric", label, className = "", activeOperationId, previewOperationId, highlightOperationId } = props;
  const canvasRef = useRef(null);
  const drawRef = useRef(null);
  const [fallback, setFallback] = useState(false);
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const density = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(box.width * density));
    const height = Math.max(1, Math.round(box.height * density));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    try {
      if (!renderTechnicalMesh(canvas, solid, view, { activeOperationId, previewOperationId, highlightOperationId })) setFallback(true);
    } catch { setFallback(true); }
  }, [solid, view, activeOperationId, previewOperationId, highlightOperationId]);
  drawRef.current = draw;
  useLayoutEffect(() => { draw(); }, [draw]);
  useLayoutEffect(() => {
    if (fallback) return;
    const observer = new ResizeObserver(() => drawRef.current());
    observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [fallback]);
  if (fallback) return <VectorTechnicalPreview {...props} />;
  return <canvas ref={canvasRef} className={`technical-preview ${className}`.trim()} role="img" aria-label={t(label || t("{0} · 宝石正交预览", [view]))} style={{ display: "block", width: "100%", height: "100%" }} />;
}

export function TechnicalPreview(props) {
  return props.solid?.kind === "mesh" ? <MeshTechnicalPreview {...props} /> : <VectorTechnicalPreview {...props} />;
}
