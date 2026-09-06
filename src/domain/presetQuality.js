import { buildConstructionStages } from "./constructionHistory.js";
import { createCenteredCube, measurePolyhedron } from "./geometry.js";

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const length = (a) => Math.hypot(a.x, a.y, a.z);


function inspectTopology(solid, tolerance) {
  const vertices = [];
  const remap = solid.vertices.map((point) => {
    const match = vertices.findIndex((other) => length(subtract(point, other)) <= tolerance);
    if (match >= 0) return match;
    vertices.push(point);
    return vertices.length - 1;
  });
  const edges = new Map();
  const usedVertices = new Set();
  let faceCount = 0;
  for (const face of solid.faces) {
    const mapped = face.vertexIndices.map((index) => remap[index]);
    const indices = mapped.filter((index, ordinal) => index !== mapped[(ordinal + mapped.length - 1) % mapped.length]);
    if (indices.some((index) => index === undefined) || new Set(indices).size < 3) continue;
    faceCount += 1;
    for (let ordinal = 0; ordinal < indices.length; ordinal += 1) {
      const startIndex = indices[ordinal];
      const endIndex = indices[(ordinal + 1) % indices.length];
      const start = vertices[startIndex];
      const direction = subtract(vertices[endIndex], start);
      const squaredLength = dot(direction, direction);
      const split = [{ index: startIndex, t: 0 }, { index: endIndex, t: 1 }];
      // Polygon simplification may remove a collinear vertex on just one side
      // of an edge. Split both sides into the same mesh segments.
      vertices.forEach((point, index) => {
        if (index === startIndex || index === endIndex) return;
        const relative = subtract(point, start);
        const t = dot(relative, direction) / squaredLength;
        if (t <= 0 || t >= 1) return;
        const residual = { x: relative.x - t * direction.x, y: relative.y - t * direction.y, z: relative.z - t * direction.z };
        if (length(residual) <= tolerance) split.push({ index, t });
      });
      split.sort((a, b) => a.t - b.t);
      for (let segment = 1; segment < split.length; segment += 1) {
        const a = split[segment - 1].index;
        const b = split[segment].index;
        usedVertices.add(a);
        usedVertices.add(b);
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        const edge = edges.get(key) ?? { count: 0, winding: 0 };
        edge.count += 1;
        edge.winding += a < b ? 1 : -1;
        edges.set(key, edge);
      }
    }
  }
  return {
    vertexCount: usedVertices.size, edgeCount: edges.size, tolerance,
    eulerCharacteristic: usedVertices.size - edges.size + faceCount,
    badEdges: [...edges.values()].filter((edge) => edge.count !== 2 || edge.winding !== 0).length,
  };
}

/** Inspect the actual mesh, without rejecting shapes for aesthetic proportions or size. */
export function inspectPresetPolyhedron(solid) {
  const issues = [];
  const addIssue = (code, message, details = {}) => issues.push({ code, message, ...details });
  if (!solid.vertices.length || !solid.faces.length) {
    addIssue("EMPTY_SOLID", "切割后没有有效实体。");
    return { metrics: { volume: 0, surfaceArea: 0, vertexCount: 0, faceCount: 0, edgeCount: 0 }, issues };
  }
  if (solid.vertices.some((point) => ![point.x, point.y, point.z].every(Number.isFinite))) {
    addIssue("NONFINITE_GEOMETRY", "实体顶点包含无效坐标。");
    return { metrics: null, issues };
  }
  const spans = ["x", "y", "z"].map((axis) => {
    const values = solid.vertices.map((point) => point[axis]);
    return Math.max(...values) - Math.min(...values);
  });
  // Match the clipping solver's numerical scale, allowing accumulated cap/pool rounding.
  const tolerance = Math.max(1, ...spans) * 1e-8;
  let structuralFailure = false;
  for (const face of solid.faces) {
    const indices = face.vertexIndices;
    if (indices.length < 3 || new Set(indices).size !== indices.length
      || indices.some((index) => !Number.isInteger(index) || !solid.vertices[index])) {
      addIssue("DEGENERATE_FACE", "刻面顶点不足、重复或引用不存在的顶点。", { faceId: face.id });
      structuralFailure = true;
      continue;
    }
    const points = indices.map((index) => solid.vertices[index]);
    const normalLength = length(face.normal);
    if (!Number.isFinite(normalLength) || normalLength === 0) {
      addIssue("DEGENERATE_FACE", "刻面法线无效。", { faceId: face.id });
      structuralFailure = true;
      continue;
    }
    const normal = { x: face.normal.x / normalLength, y: face.normal.y / normalLength, z: face.normal.z / normalLength };
    const offset = dot(normal, points[0]);
    if (points.some((point) => Math.abs(dot(normal, point) - offset) > tolerance)) {
      addIssue("NON_PLANAR_FACE", "刻面顶点不共面。", { faceId: face.id });
    }
    if (solid.vertices.some((point) => dot(normal, point) - offset > tolerance)) {
      addIssue("OUTSIDE_FACE_HALFSPACE", "实体顶点穿越刻面保留半空间，或刻面朝向错误。", { faceId: face.id });
    }
  }
  let topology = inspectTopology(solid, 0);
  // ASC distance rounding can leave subpixel seams in the solver mesh. Only
  // retry failed topology at numerical precision; preserve every actual face.
  if (topology.badEdges || topology.eulerCharacteristic !== 2) topology = inspectTopology(solid, tolerance * 100);
  if (topology.badEdges) addIssue("NON_MANIFOLD_EDGES", "实体存在未闭合、重复或朝向不一致的边。", { edgeCount: topology.badEdges });
  if (topology.eulerCharacteristic !== 2) addIssue("EULER_MISMATCH", "实体拓扑不满足封闭凸多面体的欧拉关系。", { eulerCharacteristic: topology.eulerCharacteristic });
  const roughFaceCount = solid.faces.filter((face) => face.sourceOperationId === "rough-cube" || face.region === "rough" || face.id.startsWith("cube:")).length;
  if (roughFaceCount) addIssue("ROUGH_STOCK_REMAINS", "最终实体仍有未经切割的毛坯表面。", { faceCount: roughFaceCount });
  if (structuralFailure) return { metrics: null, issues };
  const metrics = {
    ...measurePolyhedron(solid),
    vertexCount: topology.vertexCount, faceCount: solid.faces.length, edgeCount: topology.edgeCount,
    eulerCharacteristic: topology.eulerCharacteristic, topologyTolerance: topology.tolerance, roughFaceCount, dimensions: { x: spans[0], y: spans[1], z: spans[2] },
  };
  for (const face of metrics.faces) {
    if (!Number.isFinite(face.area) || face.area <= 0) addIssue("DEGENERATE_FACE", "刻面面积无效。", { faceId: face.id });
  }
  if (!Number.isFinite(metrics.volume) || metrics.volume <= 0) addIssue("INVALID_VOLUME", "实体没有有限的正体积。");
  return { metrics, issues };
}

/**
 * Replay saved tiers exactly as the editor does. Fingerprints describe only the
 * final active half-spaces (unit normals, 1e-8 quantization), independent of
 * names, redundant operations and tier order. Rotation is deliberately retained.
 */
export function inspectPresetSolid(document) {
  const stages = buildConstructionStages(document);
  const solid = stages.at(-1)?.afterSolid ?? createCenteredCube(document.stock.size, {
    center: document.stock.center, sourceOperationId: "rough-cube", region: "rough",
  });
  const { metrics, issues } = inspectPresetPolyhedron(solid);
  const facetsById = new Map(document.facets.map((facet) => [facet.id, facet]));
  const effectiveFaces = solid.faces.filter((face) => facetsById.has(face.id));
  const planes = effectiveFaces.map((face) => {
    const { normal, offset } = facetsById.get(face.id).plane;
    const magnitude = length(normal);
    return [normal.x, normal.y, normal.z, offset].map((value) => Math.round(value / magnitude * 1e8)).join(":");
  });
  return {
    solid, metrics, issues,
    fingerprint: issues.length ? null : [...new Set(planes)].sort().join("|"),
    facetCount: effectiveFaces.length,
    tierCount: new Set(effectiveFaces.map((face) => face.sourceOperationId)).size,
  };
}
