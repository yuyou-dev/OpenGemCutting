import { createMeshSolid } from "./mesh/index.js";

const normalized = new WeakMap();
const solids = new WeakMap();
const freeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

// The immutable starting crystal is shared across CUT snapshots. Geometry
// validation belongs at this boundary, never inside every depth calculation.
export function normalizeMeshStock(stock) {
  if (normalized.has(stock)) return normalized.get(stock);
  if (!stock.mesh || !Array.isArray(stock.mesh.vertices) || !Array.isArray(stock.mesh.faces)) {
    throw new TypeError("晶体缺少顶点或面网格。");
  }
  // Stock persists only polygon indices. Derive the same rough identities from
  // those indices now and on JSON reload; cutter face metadata is not stock.
  const solid = createMeshSolid({
    vertices: stock.mesh.vertices,
    faces: stock.mesh.faces.map(face => Array.isArray(face) ? face : face.vertexIndices),
  });
  for (const face of solid.faces) {
    face.sourceOperationId = "rough-mesh";
    face.region = "rough";
  }
  const center = stock.center ?? [0, 0, 0];
  const size = stock.size ?? 2;
  if (!Array.isArray(center) || center.length !== 3 || !center.every(Number.isFinite) || !Number.isFinite(size) || size <= 0) {
    throw new TypeError("晶体的机台坐标或尺寸无效。");
  }
  let radius = 0, halfHeight = 0;
  for (const point of solid.vertices) {
    radius = Math.max(radius, Math.hypot(point.x - center[0], point.y - center[1]));
    halfHeight = Math.max(halfHeight, Math.abs(point.z - center[2]));
  }
  const result = freeze({
    kind: "mesh", size, center: [...center],
    mesh: { vertices: solid.vertices.map(p => ({ ...p })), faces: solid.faces.map(f => [...f.vertexIndices]) },
    envelope: { radius, halfHeight },
    ...(stock.source ? { source: JSON.parse(JSON.stringify(stock.source)) } : {}),
  });
  normalized.set(result, result);
  solids.set(result, freeze(solid));
  return result;
}

export function getMeshStockSolid(stock) {
  const resolved = normalizeMeshStock(stock);
  return solids.get(resolved);
}
