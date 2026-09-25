import { cross, dot, length, normalize, scale, sub, add } from './vectors.js';
import { PolyhedronError, polyhedronTolerance } from './types.js';

const axes = ['x', 'y', 'z'];
const bounds = points => ({
  min: Object.fromEntries(axes.map(axis => [axis, Math.min(...points.map(p => p[axis]))])),
  max: Object.fromEntries(axes.map(axis => [axis, Math.max(...points.map(p => p[axis]))])),
});
const overlaps = (a, b, eps) => a.min.x <= b.max.x + eps && b.min.x <= a.max.x + eps
  && a.min.y <= b.max.y + eps && b.min.y <= a.max.y + eps
  && a.min.z <= b.max.z + eps && b.min.z <= a.max.z + eps;

/** Triangles retain patch ownership; collinear fan triangles have no surface area. */
export function meshTriangles(solid) {
  const triangles = [];
  const eps = polyhedronTolerance(solid.vertices);
  solid.faces.forEach((face, faceIndex) => {
    const ids = face.vertexIndices;
    const facePoints = ids.map(id => solid.vertices[id]);
    // All fan triangles belong to one validated planar patch. A very thin
    // fan wedge has an ill-conditioned cross product; use the full boundary
    // normal so it cannot invent a plane crossing its neighboring patch.
    const faceArea = facePoints.slice(1, -1).reduce((sum, p, i) => add(sum,
      cross(sub(p, facePoints[0]), sub(facePoints[i + 2], facePoints[0]))), { x: 0, y: 0, z: 0 });
    const normal = normalize(faceArea);
    for (let i = 1; i + 1 < ids.length; i++) {
      const vertexIndices = [ids[0], ids[i], ids[i + 1]];
      const points = vertexIndices.map(id => solid.vertices[id]);
      const area = cross(sub(points[1], points[0]), sub(points[2], points[0]));
      if (length(area) <= eps * Math.max(length(sub(points[1], points[0])), length(sub(points[2], points[0])))) continue;
      triangles.push({ vertexIndices, points, face, facePoints, faceIndex, normal, bounds: bounds(points) });
    }
  });
  return triangles;
}

/** Median BVH: O(T log² T) construction with sorting at each level; reused for all import intersection pairs. */
export function buildTriangleBVH(triangles) {
  if (!triangles.length) return null;
  const box = { min: {}, max: {} };
  for (const axis of axes) {
    box.min[axis] = Infinity; box.max[axis] = -Infinity;
    for (const triangle of triangles) {
      box.min[axis] = Math.min(box.min[axis], triangle.bounds.min[axis]);
      box.max[axis] = Math.max(box.max[axis], triangle.bounds.max[axis]);
    }
  }
  if (triangles.length <= 8) return { ...box, triangles };
  const axis = axes.reduce((a, b) => box.max[a] - box.min[a] >= box.max[b] - box.min[b] ? a : b);
  const sorted = [...triangles].sort((a, b) => (a.bounds.min[axis] + a.bounds.max[axis]) - (b.bounds.min[axis] + b.bounds.max[axis]));
  const middle = sorted.length >> 1;
  return { ...box, left: buildTriangleBVH(sorted.slice(0, middle)), right: buildTriangleBVH(sorted.slice(middle)) };
}

function pointOnCommonBoundary(point, common, eps) {
  if (common.points.some(p => length(sub(point, p)) <= eps * 4)) return true;
  return common.edges.some(([a, b]) => {
    const edge = sub(b, a), relative = sub(point, a);
    const t = dot(relative, edge) / dot(edge, edge);
    return t >= 0 && t <= 1 && length(sub(relative, scale(edge, t))) <= eps * 4;
  });
}

function pointInTriangle(point, triangle, eps) {
  for (let i = 0; i < 3; i++) {
    const a = triangle.points[i], b = triangle.points[(i + 1) % 3];
    const edge = sub(b, a), relative = sub(point, a);
    const side = dot(cross(edge, relative), triangle.normal);
    if (side < -eps * length(edge)) return false;
    if (side < 0) {
      // Distance to an infinite supporting line admits points far beyond an
      // acute triangle tip. A tolerance contact must reach the finite edge.
      const t = Math.max(0, Math.min(1, dot(relative, edge) / dot(edge, edge)));
      if (length(sub(relative, scale(edge, t))) > eps) return false;
    }
  }
  return true;
}

function intersectingBeyondSharedBoundary(a, b, eps) {
  const da = a.points.map(p => dot(b.normal, sub(p, b.points[0])));
  const db = b.points.map(p => dot(a.normal, sub(p, a.points[0])));
  if (da.every(d => d > eps) || da.every(d => d < -eps) || db.every(d => d > eps) || db.every(d => d < -eps)) return false;
  const aIds = a.face.vertexIndices, bIds = b.face.vertexIndices;
  const commonIds = aIds.filter(id => bIds.includes(id));
  const position = id => a.facePoints[aIds.indexOf(id)];
  const common = { points: commonIds.map(position), edges: [] };
  for (let i = 0; i < aIds.length; i++) {
    const first = aIds[i], second = aIds[(i + 1) % aIds.length];
    const j = bIds.indexOf(second);
    if (j >= 0 && bIds[(j + 1) % bIds.length] === first) common.edges.push([position(first), position(second)]);
  }
  if (da.every(d => Math.abs(d) <= eps) && db.every(d => Math.abs(d) <= eps)) {
    // Clip the projected triangle intersection. A positive area is overlap,
    // even if the triangles happen to share a legitimate vertex or edge.
    let polygon = a.points;
    for (let i = 0; i < 3 && polygon.length; i++) {
      const origin = b.points[i], edge = sub(b.points[(i + 1) % 3], origin);
      const distance = p => dot(cross(edge, sub(p, origin)), b.normal);
      const clipped = [];
      for (let j = 0; j < polygon.length; j++) {
        const p = polygon[j], q = polygon[(j + 1) % polygon.length];
        const dp = distance(p), dq = distance(q);
        if (dp >= 0) clipped.push(p);
        if (dp < 0 && dq > 0 || dp > 0 && dq < 0) clipped.push(add(p, scale(sub(q, p), dp / (dp - dq))));
      }
      polygon = clipped;
    }
    // A positive-area intersection must extend into every triangle edge's
    // interior halfspace. Without this separation check, clipping near an
    // acute corner amplifies roundoff into a spurious long, zero-width sliver.
    const interiorOverlap = [[a, b], [b, a]].every(([source, target]) => target.points.every((origin, i) => {
      const edge = sub(target.points[(i + 1) % 3], origin);
      return source.points.some(p => dot(cross(edge, sub(p, origin)), target.normal) > eps * length(edge));
    }));
    if (interiorOverlap && polygon.some(p => !pointOnCommonBoundary(p, common, eps))) return true;
    // Collinear touching may collapse under clipping; inspect original vertices.
    return a.points.some(p => pointInTriangle(p, b, eps) && !pointOnCommonBoundary(p, common, eps))
      || b.points.some(p => pointInTriangle(p, a, eps) && !pointOnCommonBoundary(p, common, eps));
  }
  for (const [source, target, distances] of [[a, b, da], [b, a, db]]) {
    for (let i = 0; i < 3; i++) {
      const p = source.points[i], q = source.points[(i + 1) % 3];
      const dp = distances[i], dq = distances[(i + 1) % 3];
      if (Math.abs(dp) <= eps && pointInTriangle(p, target, eps) && !pointOnCommonBoundary(p, common, eps)) return true;
      // Endpoints within the plane tolerance are already handled above.
      // Interpolating their roundoff sign along a nearly coplanar edge can
      // turn a shared endpoint into a spurious distant intersection.
      if (dp > eps && dq < -eps || dp < -eps && dq > eps) {
        const point = add(p, scale(sub(q, p), dp / (dp - dq)));
        if (pointInTriangle(point, target, eps) && !pointOnCommonBoundary(point, common, eps)) return true;
      }
    }
  }
  return false;
}

function containsPoint(triangles, point) {
  let angle = 0;
  for (const triangle of triangles) {
    const [a, b, c] = triangle.points.map(p => sub(p, point));
    const la = length(a), lb = length(b), lc = length(c);
    angle += 2 * Math.atan2(dot(a, cross(b, c)), la * lb * lc + dot(a, b) * lc + dot(b, c) * la + dot(c, a) * lb);
  }
  return Math.abs(angle) > Math.PI * 2;
}

/** Full import check: triangle embedding AND alternating material/cavity shells. */
export function validateMeshEmbedding(solid) {
  const triangles = meshTriangles(solid), tree = buildTriangleBVH(triangles);
  const eps = polyhedronTolerance(solid.vertices);
  let candidatePairs = 0;
  // Traverse pairs of BVH nodes once. Querying the full tree separately for
  // every triangle repeated the same box comparisons in both directions.
  const pairs = tree ? [[tree, tree]] : [];
  while (pairs.length) {
    const [a, b] = pairs.pop();
    if (!overlaps(a, b, eps)) continue;
    if (a.triangles && b.triangles) {
      for (let i = 0; i < a.triangles.length; i++) {
        const triangle = a.triangles[i];
        for (let j = a === b ? i + 1 : 0; j < b.triangles.length; j++) {
          const other = b.triangles[j];
          if (other.faceIndex === triangle.faceIndex || !overlaps(triangle.bounds, other.bounds, eps)) continue;
          candidatePairs++;
          if (intersectingBeyondSharedBoundary(triangle, other, eps)) {
            throw new PolyhedronError('invalid-mesh', `Faces ${triangle.faceIndex + 1} and ${other.faceIndex + 1}: self-intersection or overlapping shells`);
          }
        }
      }
    } else if (a === b) {
      pairs.push([a.left, a.left], [a.left, a.right], [a.right, a.right]);
    } else if (!a.triangles) {
      pairs.push([a.left, b], [a.right, b]);
    } else {
      pairs.push([a, b.left], [a, b.right]);
    }
  }
  const parent = solid.vertices.map((_, index) => index);
  const find = id => { while (parent[id] !== id) { parent[id] = parent[parent[id]]; id = parent[id]; } return id; };
  for (const face of solid.faces) for (const id of face.vertexIndices) parent[find(id)] = find(face.vertexIndices[0]);
  const groups = new Map();
  for (const triangle of triangles) {
    const id = find(triangle.vertexIndices[0]);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(triangle);
  }
  const shells = [...groups.values()];
  for (const shell of shells) {
    const origin = shell[0].points[0];
    let volume6 = 0;
    for (const triangle of shell) {
      const [a, b, c] = triangle.points.map(p => sub(p, origin));
      volume6 += dot(a, cross(b, c));
    }
    const depth = shells.filter(other => other !== shell && containsPoint(other, origin)).length;
    if (Math.abs(volume6) <= eps ** 3 || (volume6 > 0) !== (depth % 2 === 0)) {
      throw new PolyhedronError('invalid-mesh', 'Shell orientation does not match material/cavity containment');
    }
  }
  return { triangles: triangles.length, candidatePairs, shells: shells.length, embeddingChecked: true };
}
