// Adapted from gemcut-core experimental kernel (MIT); see LICENSE.
import { cross, dot, length, sub } from "./vectors.js";
import { edgeKey, PolyhedronError, polyhedronTolerance } from "./types.js";
function polyhedronVolume(solid) {
  const origin = solid.vertices[0];
  if (!origin) return 0;
  let volume6 = 0;
  for (const face of solid.faces) {
    const a = sub(solid.vertices[face.vertexIndices[0]], origin);
    for (let j = 1; j + 1 < face.vertexIndices.length; j++) {
      const b = sub(solid.vertices[face.vertexIndices[j]], origin);
      const c = sub(solid.vertices[face.vertexIndices[j + 1]], origin);
      volume6 += dot(a, cross(b, c));
    }
  }
  return volume6 / 6;
}
function validatePolyhedron(solid) {
  const fail = (message) => {
    throw new PolyhedronError("invalid-mesh", message);
  };
  const eps = polyhedronTolerance(solid.vertices);
  for (const p of solid.vertices) {
    if (![p.x, p.y, p.z].every(Number.isFinite)) fail("Non-finite vertex");
  }
  const edges = /* @__PURE__ */ new Map();
  const incident = /* @__PURE__ */ new Map();
  const links = /* @__PURE__ */ new Map();
  const neighbors = solid.faces.map(() => []);
  solid.faces.forEach((face, fi) => {
    const ids = face.vertexIndices;
    if (ids.length < 3 || new Set(ids).size !== ids.length) fail(`Face ${fi}: repeated or too few vertices`);
    for (const id of ids) {
      if (!Number.isInteger(id) || !solid.vertices[id]) fail(`Face ${fi}: invalid vertex ID`);
      const list = incident.get(id) ?? [];
      list.push(fi);
      incident.set(id, list);
    }
    const anchor = solid.vertices[ids[0]];
    let normal = { x: 0, y: 0, z: 0 };
    for (let j = 1; j + 1 < ids.length; j++) {
      const n = cross(sub(solid.vertices[ids[j]], anchor), sub(solid.vertices[ids[j + 1]], anchor));
      normal = { x: normal.x + n.x, y: normal.y + n.y, z: normal.z + n.z };
    }
    const norm = length(normal);
    if (norm <= eps * eps) fail(`Face ${fi}: zero area`);
    for (let j = 0; j < ids.length; j++) {
      const a = ids[j], b = ids[(j + 1) % ids.length], c = ids[(j + 2) % ids.length];
      const pa = solid.vertices[a], pb = solid.vertices[b], pc = solid.vertices[c];
      if (Math.abs(dot(normal, sub(pa, anchor))) > eps * norm) fail(`Face ${fi}: non-planar`);
      if (length(sub(pa, pb)) <= eps) fail(`Face ${fi}: zero-length edge`);
      if (dot(cross(sub(pb, pa), sub(pc, pb)), normal) < -eps * (length(sub(pb, pa)) + length(sub(pc, pb))) * norm) fail(`Face ${fi}: concave patch; triangulate first`);
      const key = edgeKey(a, b);
      const edge = edges.get(key);
      if (!edge) edges.set(key, { a, b, face: fi, count: 1 });
      else {
        if (edge.count !== 1 || edge.a !== b || edge.b !== a) fail(`Edge ${key}: non-manifold or inconsistent orientation`);
        edge.count++;
        neighbors[fi].push(edge.face);
        neighbors[edge.face].push(fi);
        for (const id of [a, b]) {
          const link = links.get(id) ?? /* @__PURE__ */ new Map();
          const first = link.get(fi) ?? [], second = link.get(edge.face) ?? [];
          first.push(edge.face);
          second.push(fi);
          link.set(fi, first);
          link.set(edge.face, second);
          links.set(id, link);
        }
      }
    }
  });
  for (const [key, edge] of edges) if (edge.count !== 2) fail(`Edge ${key}: open boundary`);
  for (const [id, faces] of incident) {
    const allowed = new Set(faces);
    const visited2 = /* @__PURE__ */ new Set();
    const stack = [faces[0]];
    while (stack.length) {
      const f = stack.pop();
      if (visited2.has(f)) continue;
      visited2.add(f);
      for (const n of links.get(id).get(f)) if (!visited2.has(n)) stack.push(n);
    }
    if (visited2.size !== allowed.size) fail(`Vertex ${id}: disconnected link`);
  }
  if (incident.size !== solid.vertices.length) fail("Unreferenced vertices; compact input first");
  let shells = 0;
  const visited = /* @__PURE__ */ new Set();
  for (let i = 0; i < solid.faces.length; i++) {
    if (visited.has(i)) continue;
    shells++;
    const stack = [i];
    while (stack.length) {
      const f = stack.pop();
      if (visited.has(f)) continue;
      visited.add(f);
      for (const n of neighbors[f]) if (!visited.has(n)) stack.push(n);
    }
  }
  const volume = polyhedronVolume(solid);
  if (solid.faces.length && volume <= eps ** 3) fail("Non-positive material volume");
  return { vertices: incident.size, edges: edges.size, faces: solid.faces.length, shells, euler: incident.size - edges.size + solid.faces.length, volume };
}
export {
  polyhedronVolume,
  validatePolyhedron
};
