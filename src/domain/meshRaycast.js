const vector = (value) => Array.isArray(value) ? value : [value.x, value.y, value.z];
const subtract = (a, b) => a.map((value, axis) => value - b[axis]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const cache = new WeakMap();

/** Immutable mesh patches are convex (imported concave polygons are triangulated).
 * Preorder escape links give CPU and GPU the same stackless BVH traversal. */
export function buildMeshBvh(mesh) {
  const vertices = mesh.vertices.map(vector);
  const triangles = [];
  mesh.faces.forEach((face, faceIndex) => {
    const indices = face.vertexIndices;
    for (let index = 1; index + 1 < indices.length; index += 1) {
      const a = vertices[indices[0]];
      const b = vertices[indices[index]];
      const c = vertices[indices[index + 1]];
      const ab = subtract(b, a);
      const ac = subtract(c, a);
      const geometricNormal = cross(ab, ac);
      // Fan triangulation may include collinear boundary vertices. Their tiny
      // cancellation residue is not a surface: float32 upload can inflate it
      // into a sliver with an arbitrary normal and cause optical self-hits.
      // Bound subtraction/product cancellation relative to both edge lengths;
      // unlike an area cutoff this retains real tiny and very thin triangles.
      const length = Math.hypot(...geometricNormal);
      const roundingBound = 16 * Number.EPSILON * Math.hypot(...ab) * Math.hypot(...ac);
      if (length <= roundingBound) continue;
      const outward = face.normal ? vector(face.normal) : geometricNormal;
      const sign = dot(outward, geometricNormal) < 0 ? -1 : 1;
      triangles.push({ a, ab, ac, normal: geometricNormal.map((value) => sign * value / length), face, faceIndex,
        minimum: a.map((value, axis) => Math.min(value, b[axis], c[axis])),
        maximum: a.map((value, axis) => Math.max(value, b[axis], c[axis])) });
    }
  });
  const nodes = [];
  function partition(start, end) {
    const index = nodes.length;
    const minimum = [Infinity, Infinity, Infinity];
    const maximum = [-Infinity, -Infinity, -Infinity];
    for (let triangle = start; triangle < end; triangle += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        minimum[axis] = Math.min(minimum[axis], triangles[triangle].minimum[axis]);
        maximum[axis] = Math.max(maximum[axis], triangles[triangle].maximum[axis]);
      }
    }
    const node = { minimum, maximum, start, count: end - start, escape: 0 };
    nodes.push(node);
    if (end - start > 4) {
      const extent = maximum.map((value, axis) => value - minimum[axis]);
      const axis = extent.indexOf(Math.max(...extent));
      const sorted = triangles.slice(start, end).sort((a, b) =>
        a.minimum[axis] + a.maximum[axis] - b.minimum[axis] - b.maximum[axis]);
      sorted.forEach((triangle, offset) => { triangles[start + offset] = triangle; });
      const middle = (start + end) >>> 1;
      node.count = 0;
      partition(start, middle);
      partition(middle, end);
    }
    node.escape = nodes.length;
  }
  if (triangles.length) partition(0, triangles.length);
  return { nodes, triangles };
}

export function getMeshBvh(mesh) {
  let bvh = cache.get(mesh);
  if (!bvh) { bvh = buildMeshBvh(mesh); cache.set(mesh, bvh); }
  return bvh;
}

function intersectsBounds(node, origin, direction, minimum, maximum) {
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(direction[axis]) < 1e-15) {
      if (origin[axis] < node.minimum[axis] || origin[axis] > node.maximum[axis]) return false;
    } else {
      const a = (node.minimum[axis] - origin[axis]) / direction[axis];
      const b = (node.maximum[axis] - origin[axis]) / direction[axis];
      minimum = Math.max(minimum, Math.min(a, b));
      maximum = Math.min(maximum, Math.max(a, b));
      if (maximum < minimum) return false;
    }
  }
  return true;
}

/** Direction is normalized internally; distances are in model units. No backface
 * culling: concave optical exits and cavities need both sides of each boundary. */
export function raycastMesh(meshOrBvh, rawOrigin, rawDirection, { minDistance = 1e-8, maxDistance = Infinity } = {}) {
  const bvh = meshOrBvh.nodes ? meshOrBvh : getMeshBvh(meshOrBvh);
  const origin = vector(rawOrigin);
  const raw = vector(rawDirection);
  const length = Math.hypot(...raw);
  if (!length) return null;
  const direction = raw.map((value) => value / length);
  let nearest = maxDistance;
  let result = null;
  for (let index = 0; index < bvh.nodes.length;) {
    const node = bvh.nodes[index];
    if (!intersectsBounds(node, origin, direction, minDistance, nearest)) { index = node.escape; continue; }
    for (let triangleIndex = node.start; triangleIndex < node.start + node.count; triangleIndex += 1) {
      const triangle = bvh.triangles[triangleIndex];
      const p = cross(direction, triangle.ac);
      const determinant = dot(triangle.ab, p);
      if (Math.abs(determinant) < 1e-14) continue;
      const relative = subtract(origin, triangle.a);
      const u = dot(relative, p) / determinant;
      if (u < -1e-10 || u > 1 + 1e-10) continue;
      const q = cross(relative, triangle.ab);
      const v = dot(direction, q) / determinant;
      if (v < -1e-10 || u + v > 1 + 1e-10) continue;
      const distance = dot(triangle.ac, q) / determinant;
      if (distance <= minDistance || distance >= nearest) continue;
      nearest = distance;
      result = { distance, normal: triangle.normal, face: triangle.face, faceIndex: triangle.faceIndex, triangleIndex,
        point: origin.map((value, axis) => value + direction[axis] * distance) };
    }
    index += 1;
  }
  return result;
}

export function intersectMeshSegment(meshOrBvh, start, end, { epsilon = 1e-7 } = {}) {
  const direction = subtract(vector(end), vector(start));
  return raycastMesh(meshOrBvh, start, direction, { minDistance: epsilon, maxDistance: Math.hypot(...direction) - epsilon });
}

/** On an oriented closed mesh, the first positive boundary exits material only
 * when the origin is inside. A non-axis ray avoids planar grid degeneracies;
 * surface points within epsilon remain available to surface helpers. */
export function isPointInsideMesh(meshOrBvh, point, { epsilon = 1e-7 } = {}) {
  const direction = [1, 0.3713906763541037, 0.5291132280512412];
  const hit = raycastMesh(meshOrBvh, point, direction, { minDistance: -epsilon });
  return Boolean(hit && hit.distance > epsilon && dot(direction, hit.normal) > 0);
}
