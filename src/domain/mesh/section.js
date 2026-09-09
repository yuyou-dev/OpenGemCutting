// Adapted from gemcut-core experimental kernel (MIT); see LICENSE.
import { cross, dot, normalize, sub } from "./vectors.js";
import earcut from "./vendor/earcut.js";
import { edgeKey, PolyhedronError } from "./types.js";
function sectionLoops(edges) {
  const next = /* @__PURE__ */ new Map();
  const incoming = /* @__PURE__ */ new Set();
  for (const [a, b] of edges.values()) {
    if (next.has(a) || incoming.has(b)) {
      throw new PolyhedronError("singular-section", "Cut meets a branching vertex; manifold regularization is required");
    }
    next.set(a, b);
    incoming.add(b);
  }
  const loops = [];
  while (next.size) {
    const start = next.keys().next().value;
    const loop = [];
    let current = start;
    do {
      loop.push(current);
      const to = next.get(current);
      if (to === void 0) throw new PolyhedronError("singular-section", "Open cut contour");
      next.delete(current);
      current = to;
    } while (current !== start);
    if (loop.length < 3) throw new PolyhedronError("singular-section", "Collapsed cut contour");
    loops.push(loop);
  }
  return loops;
}
const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function signedArea(ids, points) {
  const a = points.get(ids[0]);
  let area = 0;
  for (let i = 1; i + 1 < ids.length; i++) area += orient(a, points.get(ids[i]), points.get(ids[i + 1]));
  return area / 2;
}
function contains(p, ids, points) {
  let inside = false;
  for (let i = 0, j = ids.length - 1; i < ids.length; j = i++) {
    const a = points.get(ids[i]), b = points.get(ids[j]);
    if (a.y > p.y !== b.y > p.y && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function triangulateSection(vertices, loops, normal, eps) {
  if (!loops.length) return [];
  const ref = Math.abs(normal.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const u = normalize(cross(ref, normal)), v = cross(normal, u);
  const origin = vertices[loops[0][0]];
  const points = /* @__PURE__ */ new Map();
  const successor = /* @__PURE__ */ new Map();
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const id = loop[i], p = sub(vertices[id], origin);
      points.set(id, { x: dot(p, u), y: dot(p, v) });
      successor.set(id, loop[(i + 1) % loop.length]);
    }
  }
  const simplified = loops.map((loop) => loop.filter((id, i) => {
    const a = points.get(loop[(i + loop.length - 1) % loop.length]);
    const b = points.get(id), c = points.get(loop[(i + 1) % loop.length]);
    return Math.abs(orient(a, b, c)) > eps * (Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - b.x, c.y - b.y));
  }));
  if (simplified.some((r) => r.length < 3)) throw new PolyhedronError("singular-section", "Collapsed section ring");
  const rings = simplified.map((ids) => ({ ids, area: signedArea(ids, points), holes: [] }));
  const outers = rings.filter((r) => r.area > eps * eps);
  for (const ring of rings) {
    if (Math.abs(ring.area) <= eps * eps) throw new PolyhedronError("singular-section", "Section below area tolerance");
    if (ring.area > 0) continue;
    let parent;
    for (const outer of outers) {
      if ((!parent || outer.area < parent.area) && contains(points.get(ring.ids[0]), outer.ids, points)) parent = outer;
    }
    if (!parent) throw new PolyhedronError("triangulation-failed", "Hole has no containing material contour");
    parent.holes.push(ring.ids);
  }
  const triangles = [];
  for (const outer of outers) {
    const ids = [...outer.ids];
    const holes = [];
    for (const hole of outer.holes) {
      holes.push(ids.length);
      ids.push(...hole);
    }
    const coords = ids.flatMap((id) => {
      const p = points.get(id);
      return [p.x, p.y];
    });
    const indices = earcut(coords, holes, 2);
    for (let i = 0; i < indices.length; i += 3) triangles.push([ids[indices[i]], ids[indices[i + 1]], ids[indices[i + 2]]]);
  }
  const uses = /* @__PURE__ */ new Map();
  for (const tri of triangles) for (let i = 0; i < 3; i++) {
    const key = edgeKey(tri[i], tri[(i + 1) % 3]);
    uses.set(key, (uses.get(key) ?? 0) + 1);
  }
  const patches = triangles.map((tri) => {
    const patch = [];
    for (let i = 0; i < 3; i++) {
      const a = tri[i], b = tri[(i + 1) % 3];
      patch.push(a);
      if (uses.get(edgeKey(a, b)) !== 1) continue;
      let current = successor.get(a);
      let steps = 0;
      while (current !== b) {
        if (current === void 0 || ++steps > points.size || Math.abs(orient(points.get(a), points.get(b), points.get(current))) > eps * Math.hypot(points.get(b).x - points.get(a).x, points.get(b).y - points.get(a).y)) {
          throw new PolyhedronError("triangulation-failed", "Triangulator did not preserve the section boundary");
        }
        patch.push(current);
        current = successor.get(current);
      }
    }
    return patch;
  });
  const boundary = /* @__PURE__ */ new Map();
  let actualArea = 0;
  for (const patch of patches) {
    const area = signedArea(patch, points);
    if (area <= 0) throw new PolyhedronError("triangulation-failed", "Non-positive cap patch");
    actualArea += area;
    for (let i = 0; i < patch.length; i++) {
      const a = patch[i], b = patch[(i + 1) % patch.length], key = edgeKey(a, b);
      const previous = boundary.get(key);
      if (!previous) boundary.set(key, [a, b]);
      else if (previous[0] === b && previous[1] === a) boundary.delete(key);
      else throw new PolyhedronError("triangulation-failed", "Inconsistent cap edge orientation");
    }
  }
  if (boundary.size !== successor.size || [...boundary.values()].some(([a, b]) => successor.get(a) !== b)) {
    throw new PolyhedronError("triangulation-failed", "Cap has unmatched boundary edges");
  }
  const expectedArea = rings.reduce((sum, r) => sum + r.area, 0);
  if (Math.abs(actualArea - expectedArea) > Math.max(eps * eps * points.size, Math.abs(expectedArea) * 1e-8)) {
    throw new PolyhedronError("triangulation-failed", "Cap area mismatch");
  }
  return patches;
}
export {
  sectionLoops,
  triangulateSection
};
