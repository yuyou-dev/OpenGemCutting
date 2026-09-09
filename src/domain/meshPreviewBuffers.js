import { getMeshBoundaryEdges } from "./meshDisplay.js";

const cache = new WeakMap();
const axes = ["x", "y", "z"];

/** CPU preparation is shared by every orthographic view of one immutable solid. */
export function getMeshPreviewBuffers(solid) {
  if (cache.has(solid)) return cache.get(solid);
  const positions = [];
  const faceRanges = [];
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const vertex of solid.vertices) axes.forEach((axis, i) => {
    bounds.min[i] = Math.min(bounds.min[i], vertex[axis]);
    bounds.max[i] = Math.max(bounds.max[i], vertex[axis]);
  });
  for (const face of solid.faces) {
    const start = positions.length / 3;
    for (let i = 1; i + 1 < face.vertexIndices.length; i += 1) {
      for (const index of [face.vertexIndices[0], face.vertexIndices[i], face.vertexIndices[i + 1]]) {
        const p = solid.vertices[index]; positions.push(p.x, p.y, p.z);
      }
    }
    faceRanges.push({ start, count: positions.length / 3 - start, operationId: face.sourceOperationId });
  }
  const edges = getMeshBoundaryEdges(solid);
  const lines = new Float32Array(edges.length * 6 * 8);
  let cursor = 0;
  for (const [start, end] of edges) {
    const a = solid.vertices[start], b = solid.vertices[end];
    for (const [along, side] of [[0,-1],[1,-1],[1,1],[0,-1],[1,1],[0,1]]) {
      lines.set([a.x,a.y,a.z,b.x,b.y,b.z,along,side],cursor); cursor += 8;
    }
  }
  const result = { positions: new Float32Array(positions), lines, faceRanges, bounds, edgeCount: edges.length };
  cache.set(solid,result);
  return result;
}

const COLORS = { normal: [243/255,244/255,242/255], active: [248/255,181/255,206/255], preview: [170/255,213/255,244/255], highlight: [238/255,141/255,172/255] };
export function fillMeshPreviewColors(buffers, { activeOperationId, previewOperationId, highlightOperationId } = {}) {
  const colors = new Float32Array(buffers.positions.length);
  for (const { start, count, operationId } of buffers.faceRanges) {
    const color = activeOperationId && operationId === activeOperationId ? COLORS.active
      : previewOperationId && operationId === previewOperationId ? COLORS.preview
      : highlightOperationId && operationId === highlightOperationId ? COLORS.highlight : COLORS.normal;
    for (let vertex = start; vertex < start + count; vertex += 1) colors.set(color,vertex*3);
  }
  return colors;
}
