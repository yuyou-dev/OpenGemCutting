// Adapted from gemcut-core experimental kernel (MIT); see LICENSE.
import { add, cross, dot, length, normalize, sub } from "./vectors.js";
import { polyhedronTolerance } from "./types.js";
import { validatePolyhedron } from "./validate.js";
import { triangulateSection } from "./section.js";
function importRoughObj(text, { maxFaces = Infinity, maxVertices = Infinity } = {}) {
  const positions = [];
  const polygons = [];
  const lines = text.replace(/\\\r?\n/g, " ").split(/\r?\n/);
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    const [kind, ...values] = lines[lineNumber].split("#")[0].trim().split(/\s+/);
    if (kind === "v") {
      if (positions.length >= maxVertices) throw new Error(`OBJ 最多允许 ${maxVertices} 个源顶点，请移除未使用顶点或简化模型。`);
      const [x, y, z] = values.slice(0, 3).map(Number);
      if (x === void 0 || y === void 0 || z === void 0 || ![x, y, z].every(Number.isFinite)) throw new Error(`第 ${lineNumber + 1} 行：顶点坐标无效`);
      positions.push({ x, y, z });
    } else if (kind === "f") {
      if (polygons.length >= maxFaces) throw new Error(`初始晶体最多允许 ${maxFaces} 个面，文件面数已超过上限；请先简化模型。`);
      if (values.length < 3) throw new Error(`第 ${lineNumber + 1} 行：面至少需要 3 个顶点`);
      polygons.push(values.map((value) => {
        const token = value.split("/")[0];
        const n = Number(token);
        const index = n < 0 ? positions.length + n : n - 1;
        if (!/^-?\d+$/.test(token) || !Number.isSafeInteger(n) || n === 0 || !positions[index]) throw new Error(`第 ${lineNumber + 1} 行：顶点索引无效`);
        return index;
      }));
    }
  }
  if (!polygons.length) throw new Error("没有找到 OBJ 多边形面；请选择含 v / f 记录的三维 OBJ 文件");
  const vertices = [];
  const weld = /* @__PURE__ */ new Map();
  const rings = polygons.map((polygon) => polygon.map((id) => {
    const p = positions[id], key = `${p.x},${p.y},${p.z}`;
    let mapped = weld.get(key);
    if (mapped === void 0) {
      mapped = vertices.length;
      vertices.push(p);
      weld.set(key, mapped);
    }
    return mapped;
  }));
  const eps = polyhedronTolerance(vertices);
  const faces = [];
  rings.forEach((ring, i) => {
    if (new Set(ring).size !== ring.length) throw new Error(`面 ${i + 1} 有重复顶点`);
    const anchor = vertices[ring[0]];
    let areaNormal = { x: 0, y: 0, z: 0 };
    for (let j = 1; j + 1 < ring.length; j++) areaNormal = add(areaNormal, cross(sub(vertices[ring[j]], anchor), sub(vertices[ring[j + 1]], anchor)));
    if (length(areaNormal) <= eps * eps) throw new Error(`面 ${i + 1} 面积为零`);
    const normal = normalize(areaNormal);
    if (ring.some((id) => Math.abs(dot(normal, sub(vertices[id], anchor))) > eps)) throw new Error(`面 ${i + 1} 不共面；请在建模软件中先三角化`);
    const convex = ring.every((id, j) => {
      const ab = sub(vertices[ring[(j + 1) % ring.length]], vertices[id]);
      const bc = sub(vertices[ring[(j + 2) % ring.length]], vertices[ring[(j + 1) % ring.length]]);
      return dot(cross(ab, bc), normal) >= -eps * (length(ab) + length(bc));
    });
    for (const ids of convex ? [ring] : triangulateSection(vertices, [ring], normal, eps)) faces.push({ vertexIndices: ids, surfaceId: `rough:import:${i}` });
  });
  if (faces.length > maxFaces) throw new Error(`初始晶体分解后有 ${faces.length} 个面片，超过 ${maxFaces} 面上限；请先简化模型。`);
  const solid = { vertices, faces };
  validatePolyhedron(solid);
  return { solid, sourceFaces: polygons.length };
}
export {
  importRoughObj
};
