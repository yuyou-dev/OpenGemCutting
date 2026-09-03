const VIEW_CONFIG = Object.freeze({
  isometric: Object.freeze({
    label: "45°",
    basis: Object.freeze({
      horizontal: Object.freeze({ x: Math.SQRT1_2, y: -Math.SQRT1_2, z: 0 }),
      vertical: Object.freeze({ x: -1 / Math.sqrt(6), y: -1 / Math.sqrt(6), z: 2 / Math.sqrt(6) }),
      view: Object.freeze({ x: 1 / Math.sqrt(3), y: 1 / Math.sqrt(3), z: 1 / Math.sqrt(3) }),
    }),
  }),
  top: Object.freeze({ label: "TOP", axes: Object.freeze(["x", "y"]), viewAxis: "z", viewSign: 1 }),
  bottom: Object.freeze({ label: "BOTTOM", axes: Object.freeze(["x", "y"]), viewAxis: "z", viewSign: -1 }),
  front: Object.freeze({ label: "FRONT", axes: Object.freeze(["x", "z"]), viewAxis: "y", viewSign: 1 }),
});

export const TECHNICAL_PREVIEW_VIEWS = Object.freeze(Object.keys(VIEW_CONFIG));

function dot(left, right) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function visibleFace(face, config) {
  const facing = config.basis
    ? dot(face.normal, config.basis.view)
    : (face.normal?.[config.viewAxis] ?? 0) * config.viewSign;
  // Faces parallel to the view collapse into the projected silhouette. Their
  // non-zero edges must remain visible even when no front-facing facet reaches
  // the stone's outer profile (for example, an oval pavilion below its girdle).
  return facing >= -1e-6;
}

function visibleEdges(solid, config) {
  const edges = new Set();
  solid.faces.filter((face) => visibleFace(face, config)).forEach((face) => {
    face.vertexIndices.forEach((start, index) => {
      const end = face.vertexIndices[(index + 1) % face.vertexIndices.length];
      edges.add(start < end ? `${start}:${end}` : `${end}:${start}`);
    });
  });
  return [...edges].map((edge) => edge.split(":").map(Number));
}

export function projectTechnicalPreview(solid, view, { width = 320, height = 240, padding = 20 } = {}) {
  const config = VIEW_CONFIG[view];
  if (!config) throw new RangeError(`unknown technical preview view: ${view}`);
  if (!solid?.vertices?.length) return { view, label: config.label, width, height, points: [], edges: [] };

  const horizontal = config.basis
    ? (vertex) => dot(vertex, config.basis.horizontal)
    : (vertex) => vertex[config.axes[0]];
  const vertical = config.basis
    ? (vertex) => dot(vertex, config.basis.vertical)
    : (vertex) => vertex[config.axes[1]];
  const xs = solid.vertices.map(horizontal);
  const ys = solid.vertices.map(vertical);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const innerWidth = Math.max(1, width - padding * 2);
  const innerHeight = Math.max(1, height - padding * 2);
  const scale = Math.min(
    innerWidth / Math.max(maxX - minX, 1e-6),
    innerHeight / Math.max(maxY - minY, 1e-6),
  );
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const points = solid.vertices.map((vertex) => ({
    x: width / 2 + (horizontal(vertex) - centerX) * scale,
    y: height / 2 - (vertical(vertex) - centerY) * scale,
  }));

  const projectedEdges = [];
  const seenEdges = new Set();
  visibleEdges(solid, config).forEach(([start, end]) => {
    const a = points[start]; const b = points[end];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.08) return;
    const aKey = `${a.x.toFixed(2)}:${a.y.toFixed(2)}`;
    const bKey = `${b.x.toFixed(2)}:${b.y.toFixed(2)}`;
    const key = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    projectedEdges.push([start, end]);
  });

  return {
    view,
    label: config.label,
    width,
    height,
    points,
    edges: projectedEdges,
  };
}

export function technicalPreviewSvg(solid, view, options = {}) {
  const projection = projectTechnicalPreview(solid, view, options);
  const lines = projection.edges.map(([start, end]) => {
    const a = projection.points[start]; const b = projection.points[end];
    return `<line x1="${a.x.toFixed(2)}" y1="${a.y.toFixed(2)}" x2="${b.x.toFixed(2)}" y2="${b.y.toFixed(2)}"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${projection.width} ${projection.height}" role="img" aria-label="${projection.label}"><rect width="100%" height="100%" fill="#fff"/><g stroke="#262a2b" stroke-width="1" fill="none" vector-effect="non-scaling-stroke">${lines}</g></svg>`;
}
