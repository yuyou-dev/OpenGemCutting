import { cross, dot, length, normalize, scale, sub, add } from './vectors.js';
import { PolyhedronError, polyhedronTolerance } from './types.js';

const axes = ['x', 'y', 'z'];
const bounds = points => ({
  min: Object.fromEntries(axes.map(axis => [axis, Math.min(...points.map(p => p[axis]))])),
  max: Object.fromEntries(axes.map(axis => [axis, Math.max(...points.map(p => p[axis]))])),
});
const overlaps = (a, b, eps) => axes.every(axis => a.min[axis] <= b.max[axis] + eps && b.min[axis] <= a.max[axis] + eps);

/** Triangles retain patch ownership; collinear fan triangles have no surface area. */
export function meshTriangles(solid) {
  const triangles = [];
  const eps = polyhedronTolerance(solid.vertices);
  solid.faces.forEach((face, faceIndex) => {
    const ids = face.vertexIndices;
    for (let i = 1; i + 1 < ids.length; i++) {
      const vertexIndices = [ids[0], ids[i], ids[i + 1]];
      const points = vertexIndices.map(id => solid.vertices[id]);
      const area = cross(sub(points[1], points[0]), sub(points[2], points[0]));
      if (length(area) <= eps * Math.max(length(sub(points[1], points[0])), length(sub(points[2], points[0])))) continue;
      triangles.push({ vertexIndices, points, face, facePoints: ids.map(id => solid.vertices[id]), faceIndex, normal: normalize(area), bounds: bounds(points) });
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
    if (dot(cross(sub(b, a), sub(point, a)), triangle.normal) < -eps * length(sub(b, a))) return false;
  }
  return true;
}

function intersectingBeyondSharedBoundary(a, b, eps) {
  const aIds = a.face.vertexIndices, bIds = b.face.vertexIndices;
  const commonIds = aIds.filter(id => bIds.includes(id));
  const position = id => a.facePoints[aIds.indexOf(id)];
  const common = { points: commonIds.map(position), edges: [] };
  for (let i = 0; i < aIds.length; i++) {
    const first = aIds[i], second = aIds[(i + 1) % aIds.length];
    const j = bIds.indexOf(second);
    if (j >= 0 && bIds[(j + 1) % bIds.length] === first) common.edges.push([position(first), position(second)]);
  }
  const da = a.points.map(p => dot(b.normal, sub(p, b.points[0])));
  const db = b.points.map(p => dot(a.normal, sub(p, a.points[0])));
  if (da.every(d => d > eps) || da.every(d => d < -eps) || db.every(d => d > eps) || db.every(d => d < -eps)) return false;
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
    if (polygon.some(p => !pointOnCommonBoundary(p, common, eps))) return true;
    // Collinear touching may collapse under clipping; inspect original vertices.
    return a.points.some(p => pointInTriangle(p, b, eps) && !pointOnCommonBoundary(p, common, eps))
      || b.points.some(p => pointInTriangle(p, a, eps) && !pointOnCommonBoundary(p, common, eps));
  }
  for (const [source, target, distances] of [[a, b, da], [b, a, db]]) {
    for (let i = 0; i < 3; i++) {
      const p = source.points[i], q = source.points[(i + 1) % 3];
      const dp = distances[i], dq = distances[(i + 1) % 3];
      if (Math.abs(dp) <= eps && pointInTriangle(p, target, eps) && !pointOnCommonBoundary(p, common, eps)) return true;
      if (dp * dq < 0) {
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
  triangles.forEach((triangle, index) => { triangle.index = index; });
  let candidatePairs = 0;
  for (const triangle of triangles) {
    const stack = tree ? [tree] : [];
    while (stack.length) {
      const node = stack.pop();
      if (!overlaps(triangle.bounds, node, eps)) continue;
      if (!node.triangles) { stack.push(node.left, node.right); continue; }
      for (const other of node.triangles) {
        if (other.index <= triangle.index || other.faceIndex === triangle.faceIndex || !overlaps(triangle.bounds, other.bounds, eps)) continue;
        candidatePairs++;
        if (intersectingBeyondSharedBoundary(triangle, other, eps)) {
          throw new PolyhedronError('invalid-mesh', `Faces ${triangle.faceIndex + 1} and ${other.faceIndex + 1}: self-intersection or overlapping shells`);
        }
      }
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
