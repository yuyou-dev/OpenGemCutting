// Test fixtures adapted from gemcut-core (MIT); see LICENSE.
import { triangulateSection } from "./section.js";
function starRough(faceCount) {
  const n = (faceCount + 4) / 4;
  if (!Number.isInteger(n) || n < 6) throw new Error("faceCount must be 4n - 4, n >= 6");
  const vertices = [];
  for (const z of [-1, 1]) for (let i = 0; i < n; i++) {
    const angle = 2 * Math.PI * i / n;
    const r = i % 2 ? 0.45 : 1;
    vertices.push({ x: r * Math.cos(angle), y: r * Math.sin(angle), z });
  }
  const faces = [];
  const bottom = Array.from({ length: n }, (_, i) => n - 1 - i);
  const top = Array.from({ length: n }, (_, i) => n + i);
  for (const [loop, normal] of [[bottom, { x: 0, y: 0, z: -1 }], [top, { x: 0, y: 0, z: 1 }]]) {
    for (const ids of triangulateSection(vertices, [loop], normal, 1e-10)) faces.push({ vertexIndices: ids, surfaceId: `rough:${faces.length}` });
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push({ vertexIndices: [i, j, j + n], surfaceId: `rough:side:${i}` });
    faces.push({ vertexIndices: [i, j + n, i + n], surfaceId: `rough:side:${i}` });
  }
  if (faces.length !== faceCount) throw new Error(`Expected ${faceCount} faces, got ${faces.length}`);
  return { vertices, faces };
}
function voxelRough(cells) {
  const occupied = new Set(cells.map((c) => c.join(",")));
  const vertices = [];
  const ids = /* @__PURE__ */ new Map();
  const faces = [];
  const directions = [
    { d: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
    { d: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
    { d: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
    { d: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
    { d: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
    { d: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] }
  ];
  for (const [x, y, z] of cells) for (const { d, corners } of directions) {
    if (occupied.has([x + d[0], y + d[1], z + d[2]].join(","))) continue;
    const polygon = corners.map(([dx, dy, dz]) => {
      const p = { x: x + dx, y: y + dy, z: z + dz }, key = `${p.x},${p.y},${p.z}`;
      let id = ids.get(key);
      if (id === void 0) {
        id = vertices.length;
        ids.set(key, id);
        vertices.push(p);
      }
      return id;
    });
    faces.push({ vertexIndices: polygon, surfaceId: `rough:${faces.length}` });
  }
  return { vertices, faces };
}
const uRough = () => voxelRough([[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0], [2, 1, 0], [0, 2, 0], [2, 2, 0]]);
function hollowRough(cavity = false) {
  const cells = [];
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < (cavity ? 3 : 1); z++) {
    if (x === 1 && y === 1 && (!cavity || z === 1)) continue;
    cells.push([x, y, z]);
  }
  return voxelRough(cells);
}
function torusRough(faceCount) {
  const around = faceCount === 100 ? 10 : 50, tube = faceCount === 100 ? 5 : 10;
  const vertices = [], faces = [];
  for (let i = 0; i < around; i++) for (let j = 0; j < tube; j++) {
    const u = 2 * Math.PI * i / around, v = 2 * Math.PI * j / tube;
    vertices.push({ x: (1 + 0.35 * Math.cos(v)) * Math.cos(u), y: (1 + 0.35 * Math.cos(v)) * Math.sin(u), z: 0.35 * Math.sin(v) });
  }
  const id = (i, j) => i % around * tube + j % tube;
  for (let i = 0; i < around; i++) for (let j = 0; j < tube; j++) {
    const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
    faces.push({ vertexIndices: [a, b, c], surfaceId: `rough:${faces.length}` });
    faces.push({ vertexIndices: [a, c, d], surfaceId: `rough:${faces.length}` });
  }
  return { vertices, faces };
}
export {
  hollowRough,
  starRough,
  torusRough,
  uRough,
  voxelRough
};
