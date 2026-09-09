// Adapted from gemcut-core experimental kernel (MIT); see LICENSE.
import { cross, dot, lerp, scale, sub } from "./vectors.js";
import { sectionLoops, triangulateSection } from "./section.js";
import { edgeKey, PolyhedronError, polyhedronTolerance } from "./types.js";
import { validatePolyhedron } from "./validate.js";
function cutPolyhedron(solid, cut, options) {
  if (!options.trustedInput) validatePolyhedron(solid);
  const norm = Math.hypot(cut.normal.x, cut.normal.y, cut.normal.z);
  if (!Number.isFinite(norm) || norm === 0 || !Number.isFinite(cut.offset)) throw new PolyhedronError("invalid-mesh", "Invalid cutting plane");
  const normal = scale(cut.normal, 1 / norm), offset = cut.offset / norm;
  const eps = options.tolerance ?? polyhedronTolerance(solid.vertices);
  const distances = new Float64Array(solid.vertices.length);
  let inside = 0, outside = 0;
  for (let i = 0; i < solid.vertices.length; i++) {
    const d = dot(normal, solid.vertices[i]) - offset;
    distances[i] = Math.abs(d) <= eps ? 0 : d;
    if (d < -eps) inside++;
    if (d > eps) outside++;
  }
  const stats = { crossedEdges: 0, capPatches: 0, edgeLookups: 0 };
  if (!outside) return { solid, status: solid.faces.length ? "unchanged" : "empty", sectionLoops: [], stats };
  if (!inside) return { solid: { ...solid, vertices: [], faces: [] }, status: "empty", sectionLoops: [], stats };
  const vertices = solid.vertices.map((p, i) => distances[i] === 0 ? sub(p, scale(normal, dot(normal, p) - offset)) : p);
  const intersections = /* @__PURE__ */ new Map();
  const intersect = (a, b) => {
    if (distances[a] === 0) return a;
    if (distances[b] === 0) return b;
    const key = edgeKey(a, b);
    stats.edgeLookups++;
    let id = intersections.get(key);
    if (id !== void 0) return id;
    const da = distances[a], db = distances[b];
    const p = lerp(vertices[a], vertices[b], da / (da - db));
    id = vertices.length;
    vertices.push(sub(p, scale(normal, dot(normal, p) - offset)));
    intersections.set(key, id);
    stats.crossedEdges++;
    return id;
  };
  const faces = [];
  const boundary = /* @__PURE__ */ new Map();
  const onPlane = (id) => id >= distances.length || distances[id] === 0;
  for (const face of solid.faces) {
    const ids = [];
    let touchesPlane = false, allOnPlane = true;
    for (let j = 0; j < face.vertexIndices.length; j++) {
      const a = face.vertexIndices[j], b = face.vertexIndices[(j + 1) % face.vertexIndices.length];
      const da = distances[a], db = distances[b];
      if (da <= 0) {
        ids.push(a);
        if (da === 0) touchesPlane = true;
        else allOnPlane = false;
      }
      if (da < 0 && db > 0 || da > 0 && db < 0) {
        ids.push(intersect(a, b)); touchesPlane = true;
      }
    }
    if (ids.length < 3) continue;
    if (allOnPlane) {
      const a = vertices[ids[0]];
      let orientation = 0;
      for (let j = 1; j + 1 < ids.length; j++) orientation += dot(normal, cross(sub(vertices[ids[j]], a), sub(vertices[ids[j + 1]], a)));
      if (orientation <= 0) continue;
    }
    faces.push({ metadata: face, vertexIndices: ids });
    if (!touchesPlane) continue;
    for (let j = 0; j < ids.length; j++) {
      const a = ids[j], b = ids[(j + 1) % ids.length];
      if (!onPlane(a) || !onPlane(b)) continue;
      const key = edgeKey(a, b);
      const previous = boundary.get(key);
      if (!previous) boundary.set(key, [b, a]);
      else if (previous[0] === a && previous[1] === b) boundary.delete(key);
      else throw new PolyhedronError("singular-section", "Overlapping section edges");
    }
  }
  const loops = sectionLoops(boundary);
  if (options.convexCaps && loops.length > 1) throw new PolyhedronError('singular-section', 'Convex preview produced multiple section contours');
  // A validated convex source has one convex section; retain its polygon and
  // logical face identity instead of triangulating it into rendering patches.
  const caps = options.convexCaps ? loops : triangulateSection(vertices, loops, normal, eps);
  stats.capPatches = caps.length;
  const usedIds = options.convexCaps ? null : new Set(solid.faces.map(face => face.id));
  let patchNumber = 0;
  for (const ids of caps) {
    let id;
    if (options.convexCaps) id = options.facetId;
    else do { id = `${options.facetId}:patch:${patchNumber++}`; } while (usedIds.has(id));
    usedIds?.add(id);
    faces.push({ metadata: { ...options.faceMetadata, id, ...(options.convexCaps ? {} : { facetId: options.facetId }), normal }, vertexIndices: ids });
  }
  const remap = new Int32Array(vertices.length).fill(-1);
  const compact = [];
  const mapId = (id) => {
    let mapped = remap[id];
    if (mapped === -1) {
      mapped = compact.length;
      remap[id] = mapped;
      compact.push(vertices[id]);
    }
    return mapped;
  };
  const output = { ...solid, vertices: compact, faces: faces.map((f) => ({ ...f.metadata, vertexIndices: f.vertexIndices.map(mapId) })) };
  return { solid: output, status: output.faces.length ? "clipped" : "empty", sectionLoops: loops.map((loop) => loop.map(mapId)), stats };
}
export {
  cutPolyhedron
};
