// Synchronous, browser-compatible CSG; all external mathematics stays behind
// this adapter. JSCAD performs solid subtraction, never a vertex deformation.
import subtractPair from '@jscad/modeling/src/operations/booleans/subtractGeom3Sub.js';
const subtract = (source, ...tools) => tools.reduce((solid, tool) => subtractPair(solid, tool), source);
import geom3 from '@jscad/modeling/src/geometries/geom3/index.js';
import poly3 from '@jscad/modeling/src/geometries/poly3/index.js';
import sphere from '@jscad/modeling/src/primitives/sphere.js';
import cylinder from '@jscad/modeling/src/primitives/cylinder.js';
import insertTjunctions from '@jscad/modeling/src/operations/modifiers/insertTjunctions.js';
import { createMeshSolid, PolyhedronError } from './index.js';
import { add, cross, dot, length, normalize, scale, sub } from './vectors.js';
import { polyhedronTolerance } from './types.js';
import { triangulateSection } from './section.js';

const point = a => ({ x: a[0], y: a[1], z: a[2] });
const array = p => [p.x, p.y, p.z];
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

function bounds(vertices) {
  return {
    min: [0, 1, 2].map(i => Math.min(...vertices.map(p => p[i]))),
    max: [0, 1, 2].map(i => Math.max(...vertices.map(p => p[i]))),
  };
}

function planeRecord(polygon, metadata, reverse = false) {
  const plane = poly3.plane(polygon);
  const sign = reverse ? -1 : 1;
  return { normal: point(plane.slice(0, 3).map(v => v * sign)), offset: plane[3] * sign, metadata };
}

// Ideal V-edged wheel: two conical flanks meeting at the circumference.
// length / (2 * radius) is tan(included angle / 2); the preset uses 90°.
function vWheel({ radius, length: width, segments }) {
  const ring = Array.from({ length: segments }, (_, i) => [radius * Math.cos(i * 2 * Math.PI / segments), radius * Math.sin(i * 2 * Math.PI / segments), 0]);
  return geom3.create(ring.flatMap((p, i) => {
    const next = ring[(i + 1) % segments];
    return [poly3.create([[0, 0, width / 2], p, next]), poly3.create([[0, 0, -width / 2], next, p])];
  }));
}

// Isosceles triangular cross-section, with its tip along local -X and
// a straight extrusion along the tool axis. Width and included tip angle
// determine the triangle height; radius is its half-height, not a round tool.
function triangularPrism({ width, radius, length: fullLength }) {
  const ring = [[-radius, 0], [radius, -width / 2], [radius, width / 2]];
  const bottom = ring.map(([x, y]) => [x, y, -fullLength / 2]);
  const top = ring.map(([x, y]) => [x, y, fullLength / 2]);
  return geom3.create([
    poly3.create([...bottom].reverse()), poly3.create(top),
    ...ring.map((_, i) => poly3.create([bottom[i], bottom[(i + 1) % 3], top[(i + 1) % 3], top[i]])),
  ]);
}

/** Faceted approximation of a round cutter; positions and dimensions are exact
 * parameter values. segments controls approximation, not machine indexing. */
export function createRoundCutter(tool) {
  const raw = tool.type === 'sphere'
    ? sphere({ radius: tool.radius, segments: tool.segments })
    : tool.type === 'triangular-prism' ? triangularPrism(tool) : tool.type === 'v-wheel' ? vWheel(tool) : cylinder({ radius: tool.radius, height: tool.length, segments: tool.segments });
  const angle = (tool.phaseDeg + 360 * tool.repeatIndex / tool.repeat) * Math.PI / 180;
  const spin = ([x, y, z], radians) => [Math.cos(radians) * x - Math.sin(radians) * y, Math.sin(radians) * x + Math.cos(radians) * y, z];
  // Recover the unrotated axis so the tessellation itself has the requested
  // symmetry, including fivefold patterns that do not divide 96 or segments.
  const axis = point(spin(tool.axis, -angle));
  const u = normalize(cross(Math.abs(axis.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 }, axis));
  const v = cross(axis, u);
  const polygons = geom3.toPolygons(raw).map(polygon => poly3.create(polygon.vertices.map(([x, y, z]) => {
    const local = tool.type === 'sphere' ? [x, y, z] : array(add(add(scale(u, x), scale(v, y)), scale(axis, z)));
    return spin(local, angle).map((component, i) => component + tool.position[i]);
  })));
  const metadata = {
    region: 'concave', operationType: 'concave', sourceOperationId: tool.id,
    concaveCutId: tool.id, toolInstanceId: tool.instanceId, surfaceType: tool.type === 'triangular-prism' ? 'plane' : tool.type, toolType: tool.type,
  };
  return { geometry: geom3.create(polygons), metadata, bounds: bounds(polygons.flatMap(p => p.vertices)), planes: polygons.map(p => {
    const isEndCap = tool.type === 'cylinder' && Math.abs(dot(point(poly3.plane(p).slice(0, 3)), point(tool.axis))) > 1 - 1e-8;
    return planeRecord(p, isEndCap ? { ...metadata, surfaceType: 'plane' } : metadata, true);
  }) };
}

function toGeometry(solid) {
  return geom3.create(solid.faces.map(face => {
    const vertices = face.vertexIndices.map(id => solid.vertices[id]);
    const anchor = vertices[0];
    const area = vertices.slice(1, -1).reduce((sum, p, i) => add(sum, cross(sub(p, anchor), sub(vertices[i + 2], anchor))), { x: 0, y: 0, z: 0 });
    const normal = face.normal ?? normalize(area);
    const polygon = poly3.create(vertices.map(array));
    // JSCAD averages unit corner normals. Nearly collinear CUT vertices can
    // give roundoff-sized corners the same weight as a whole face and tilt
    // its plane. The area-weighted boundary normal keeps the authored plane.
    polygon.plane = [...array(normal), dot(normal, anchor)];
    return polygon;
  }));
}

function indexedBoundary(geometry, sources, tolerance, toWorld) {
  // Canonicalize only numerically coincident positions; never snap to a grid,
  // which would move surface planes and machining coordinates.
  const points = [], buckets = new Map(), exactPoints = new Map();
  const weld = p => {
    const exactKey = p.join(',');
    const exact = exactPoints.get(exactKey);
    if (exact) return exact;
    const cell = p.map(v => Math.floor(v / tolerance));
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      const list = buckets.get([cell[0] + x, cell[1] + y, cell[2] + z].join(','));
      if (list) for (const id of list) if (p.every((v, axis) => Math.abs(v - points[id][axis]) <= tolerance)) {
        exactPoints.set(exactKey, points[id]);
        return points[id];
      }
    }
    const key = cell.join(',');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(points.length);
    points.push(p);
    exactPoints.set(exactKey, p);
    return p;
  };
  const raw = geom3.toPolygons(geometry).map(polygon => {
    const ring = [...new Set(polygon.vertices.map(weld))];
    return { ...polygon, vertices: ring };
  }).filter(polygon => polygon.vertices.length >= 3);
  const polygons = completeBoundaryJunctions(insertTjunctions(raw), tolerance);
  const vertices = [], vertexIds = new Map(), faces = [];
  const idOf = p => {
    if (!vertexIds.has(p)) { vertexIds.set(p, vertices.length); vertices.push(point(toWorld(p))); }
    return vertexIds.get(p);
  };
  for (const [polygonIndex, polygon] of polygons.entries()) {
    const ring = [...new Set(polygon.vertices)];
    if (new Set(ring).size < 3) continue;
    const anchor = point(ring[0]);
    const area = ring.slice(1, -1).reduce((sum, p, i) => add(sum, cross(sub(point(p), anchor), sub(point(ring[i + 2]), anchor))), { x: 0, y: 0, z: 0 });
    if (length(area) <= tolerance ** 2) continue;
    const normal = point(poly3.plane(raw[polygonIndex]).slice(0, 3));
    const source = sources.find(source => dot(normal, source.normal) > 1 - 1e-6
      && ring.every(p => Math.abs(dot(source.normal, point(p)) - source.offset) < tolerance * 64));
    if (!source) throw new PolyhedronError('boolean-provenance', 'Boolean surface cannot be traced to its stock or cutter.');
    // Most BSP patches stay convex. A completed numerical T junction can make
    // a boundary slightly concave; decompose just that patch, keeping every
    // original edge. Triangulation uses coordinate precision, not the larger
    // BSP splitting tolerance, so it does not simplify a narrow boundary.
    const metadata = source.metadata;
    const positions = ring.map(point), unitNormal = normalize(area);
    const convex = positions.every((a, i) => {
      const ab = sub(positions[(i + 1) % ring.length], a);
      const bc = sub(positions[(i + 2) % ring.length], positions[(i + 1) % ring.length]);
      return dot(cross(ab, bc), unitNormal) >= -tolerance * (length(ab) + length(bc));
    });
    const patches = convex ? [ring] : triangulateSection(positions, [positions.map((_, i) => i)], unitNormal,
      Number.EPSILON * Math.max(...ring.flat().map(Math.abs)) * 16).map(ids => ids.map(id => ring[id]));
    for (const patch of patches) faces.push({ ...metadata, id: `${metadata.id ?? metadata.toolInstanceId ?? 'boolean'}:patch:${faces.length}`, vertexIndices: patch.map(idOf) });
  }
  if (!faces.length) throw new PolyhedronError('empty-concave-result', 'Concave tools remove all material. Reduce the radius or move the cutter outward.');
  // Topology, orientation, material volume, cavity nesting and self-intersection
  // all pass the existing strict mesh boundary before optics or planar CUT use.
  return createMeshSolid({ vertices, faces });
}

// BSP splits the two incident faces independently. Their edge positions can
// each differ by one splitting tolerance. Complete the remaining T junctions
// using existing boundary vertices; no positions or surface planes are moved.
// The resulting mesh still goes through the full, unchanged mesh validation.
function completeBoundaryJunctions(polygons, tolerance) {
  const ids = new Map(), unmatched = new Map();
  const idOf = point => {
    if (!ids.has(point)) ids.set(point, ids.size);
    return ids.get(point);
  };
  for (const polygon of polygons) polygon.vertices.forEach((a, i) => {
    const b = polygon.vertices[(i + 1) % polygon.vertices.length];
    const key = `${idOf(a)}:${idOf(b)}`, reverse = `${idOf(b)}:${idOf(a)}`;
    if (unmatched.has(reverse)) unmatched.delete(reverse);
    else unmatched.set(key, [a, b]);
  });
  if (!unmatched.size) return polygons;
  const candidates = [...new Set([...unmatched.values()].flat())];
  return polygons.map(polygon => ({ ...polygon, vertices: polygon.vertices.flatMap((a, i) => {
    const b = polygon.vertices[(i + 1) % polygon.vertices.length];
    if (!unmatched.has(`${idOf(a)}:${idOf(b)}`)) return [a];
    const edge = sub(point(b), point(a)), squaredLength = dot(edge, edge);
    const junctions = candidates.flatMap(p => {
      if (p === a || p === b) return [];
      const relative = sub(point(p), point(a)), t = dot(relative, edge) / squaredLength;
      return t > 0 && t < 1 && length(sub(relative, scale(edge, t))) <= tolerance * 2 ? [{ p, t }] : [];
    }).sort((a, b) => a.t - b.t);
    return [a, ...junctions.map(({ p }) => p)];
  }) }));
}

/** Difference of an oriented, possibly nonconvex stock and round tool solids. */
export function subtractRoundCutters(solid, tools) {
  if (!tools.length) return solid;
  const worldBounds = bounds(solid.vertices.map(array));
  const extent = Math.max(...worldBounds.max.map((v, i) => v - worldBounds.min[i]));
  const origin = worldBounds.min.map((v, i) => (v + worldBounds.max[i]) / 2);
  // JSCAD uses an absolute splitting epsilon. Work in a centered 100,000-unit
  // box so ordinary shallow grooves do not collapse at its default epsilon.
  // The original machine coordinate system is restored before validation.
  const factor = 1e5 / extent;
  const local = p => p.map((v, i) => (v - origin[i]) * factor);
  const world = p => p.map((v, i) => v / factor + origin[i]);
  const conditioned = { ...solid, vertices: solid.vertices.map(p => point(local(array(p)))) };
  let geometry = toGeometry(conditioned);
  const sourceBounds = bounds(conditioned.vertices.map(array));
  const tolerance = Math.max(polyhedronTolerance(conditioned.vertices), Number.EPSILON * 64);
  const sourcePlanes = solid.faces.map((face, i) => {
    // Convex CUTs use the face id as their logical plane id. Once Boolean
    // subtraction splits a plane, retain that id separately from patch ids.
    const metadata = solid.kind === 'mesh' || face.region === 'rough'
      ? face : { ...face, facetId: face.id };
    return planeRecord(geometry.polygons[i], metadata);
  });
  const cutters = [];
  for (const tool of tools) {
    if (tool.radius < extent * 1e-6 || (tool.type !== 'sphere' && tool.length < extent * 1e-6)) {
      throw new PolyhedronError('concave-resolution', 'Concave tool dimensions are below the stock-relative numerical resolution (one millionth of the stock extent).');
    }
    const localTool = { ...tool, position: local(tool.position), radius: tool.radius * factor, length: tool.length * factor, ...(tool.width === undefined ? {} : { width: tool.width * factor }) };
    if (![...localTool.position, localTool.radius, localTool.length].every(Number.isFinite)) throw new PolyhedronError('concave-coordinates', 'Concave tool coordinates or dimensions exceed the numeric range of this stock.');
    const cutter = createRoundCutter(localTool);
    // Tangential contact removes no volume. Preserve the exact original mesh.
    if ([0, 1, 2].some(i => cutter.bounds.max[i] <= sourceBounds.min[i] + tolerance || cutter.bounds.min[i] >= sourceBounds.max[i] - tolerance)) continue;
    cutters.push(cutter);
    sourcePlanes.push(...cutter.planes);
  }
  if (!cutters.length) return solid;
  // Disjoint closed tools form one compound solid. Overlapping tools use the
  // sequential BSP batch. Retain its convex patches: retessellation can erase
  // narrow boundary wedges where an authored CUT meets a cutter tip.
  const disjoint = cutters.every((a, i) => cutters.slice(i + 1).every(b =>
    [0, 1, 2].some(axis => a.bounds.max[axis] < b.bounds.min[axis] - tolerance || b.bounds.max[axis] < a.bounds.min[axis] - tolerance)));
  geometry = disjoint
    ? subtract(geometry, geom3.create(cutters.flatMap(cutter => cutter.geometry.polygons)))
    : subtract(geometry, ...cutters.map(cutter => cutter.geometry));
  if (!geometry.polygons.length) throw new PolyhedronError('empty-concave-result', 'Concave tools remove all material. Reduce the radius or move the cutter outward.');
  const result = indexedBoundary(geometry, sourcePlanes, tolerance, world);
  // A cutter inside a pre-existing air cavity removes no material even though
  // its bounds overlap. CSG may repartition those polygons; retain exact stock.
  // Do not compare total volume here: a tiny real groove can be much smaller
  // than a volume-relative epsilon but still has an observable boundary.
  if (!result.faces.some(face => face.region === 'concave')) return solid;
  return freeze(result);
}
