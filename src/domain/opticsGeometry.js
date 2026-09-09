import { buildMeshBvh, getMeshBvh, raycastMesh } from "./meshRaycast.js";

function vector(value) {
  return Array.isArray(value) ? value : [value?.x ?? 0, value?.y ?? 0, value?.z ?? 0];
}

/** Match the viewport's centered unit bounds without dropping any face plane. */
export function normalizedOpticsPlanes(polyhedron) {
  const vertices = (polyhedron?.vertices ?? []).map(vector);
  if (!vertices.length) return { planes: [], faceCount: 0 };
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (const vertex of vertices) {
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], vertex[axis]);
      maximum[axis] = Math.max(maximum[axis], vertex[axis]);
    }
  }
  const center = minimum.map((value, axis) => (value + maximum[axis]) / 2);
  const scale = Math.max(...minimum.map((value, axis) => maximum[axis] - value), 1e-6) / 2;
  const planes = [];
  for (const face of polyhedron?.faces ?? []) {
    const rawNormal = vector(face.normal);
    const length = Math.hypot(...rawNormal);
    const firstVertex = vertices[face.vertexIndices?.[0]];
    if (!firstVertex || length < 1e-8) continue;
    const normal = rawNormal.map((value) => value / length);
    const offset = normal.reduce((sum, value, axis) => sum + value * firstVertex[axis], 0);
    const normalizedOffset = (offset - normal.reduce((sum, value, axis) => sum + value * center[axis], 0)) / scale;
    planes.push([...normal, normalizedOffset]);
  }
  // A canonical traversal also makes exact boundary ties independent of face order.
  planes.sort((left, right) => {
    for (let axis = 0; axis < 4; axis += 1) {
      if (left[axis] !== right[axis]) return left[axis] - right[axis];
    }
    return 0;
  });
  return { planes, faceCount: polyhedron?.faces?.length ?? 0 };
}

/** RGBA32F stores one complete half-space per texel, spanning rows as needed. */
export function packOpticsPlaneTexture(planes, maxTextureSize) {
  if (planes.length > maxTextureSize * maxTextureSize) {
    throw new RangeError(`当前显卡最多容纳 ${maxTextureSize * maxTextureSize} 个仿真切面，当前实体有 ${planes.length} 个；无法完整显示光学仿真。`);
  }
  const width = Math.min(Math.max(1, planes.length), maxTextureSize);
  const height = Math.max(1, Math.ceil(planes.length / width));
  const data = new Float32Array(width * height * 4);
  planes.forEach((plane, index) => data.set(plane, index * 4));
  return { width, height, data };
}

/** Keep cavities and disconnected components: normalized triangles, never a hull. */
export function normalizedOpticsMesh(polyhedron) {
  const vertices = polyhedron.vertices.map(vector);
  if (!vertices.length) return { nodes: [], triangles: [], faceCount: 0 };
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (const vertex of vertices) {
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], vertex[axis]);
      maximum[axis] = Math.max(maximum[axis], vertex[axis]);
    }
  }
  const center = minimum.map((value, axis) => (value + maximum[axis]) / 2);
  const scale = Math.max(...minimum.map((value, axis) => maximum[axis] - value), 1e-6) / 2;
  const normalizedVertices = vertices.map((vertex) => vertex.map((value, axis) => (value - center[axis]) / scale));
  let radius = 0;
  for (const vertex of normalizedVertices) radius = Math.max(radius, Math.hypot(...vertex));
  return { ...buildMeshBvh({ ...polyhedron, vertices: normalizedVertices }), radius,
    faceCount: polyhedron.faces.length };
}

function floatTexture(texels, maxTextureSize) {
  if (texels.length > maxTextureSize * maxTextureSize || texels.length > 2 ** 24) {
    throw new RangeError("当前显卡无法容纳完整原石网格，无法完整显示光学仿真；未省略任何面片。");
  }
  const width = Math.min(Math.max(1, texels.length), maxTextureSize);
  const height = Math.max(1, Math.ceil(texels.length / width));
  const data = new Float32Array(width * height * 4);
  texels.forEach((texel, index) => data.set(texel, index * 4));
  return { width, height, data };
}

export function packOpticsMeshTextures(bvh, maxTextureSize) {
  return {
    nodes: floatTexture(bvh.nodes.flatMap((node) => [
      [...node.minimum, node.escape], [...node.maximum, node.start], [node.count, 0, 0, 0],
    ]), maxTextureSize),
    triangles: floatTexture(bvh.triangles.flatMap((triangle) => [
      [...triangle.a, 0], [...triangle.ab, 0], [...triangle.ac, 0], [...triangle.normal, 0],
    ]), maxTextureSize),
  };
}

/** CPU reference for optical path QA and diagnostics. As in the mesh shader,
 * every reflected/transmitted path searches the actual boundary again, including
 * air gaps. The bounce budget discards unresolved energy instead of inventing an
 * environmental exit through another component. */
export function traceMeshOpticalPaths(mesh, origin, direction, { ior = 1.5, maxBounces = 8, absorption = 0, minimumWeight = 0.002 } = {}) {
  const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
  const scale = (a, value) => a.map((item) => item * value);
  const add = (a, b) => a.map((value, axis) => value + b[axis]);
  const directionArray = vector(direction);
  const queue = [{ origin: vector(origin), direction: scale(directionArray, 1 / Math.hypot(...directionArray)), weight: 1, inside: false, boundaries: [] }];
  const escaped = [];
  const unresolved = [];
  const bvh = getMeshBvh(mesh);
  while (queue.length) {
    const path = queue.pop();
    const hit = raycastMesh(bvh, path.origin, path.direction);
    if (!hit) { escaped.push(path); continue; }
    if (path.boundaries.length >= maxBounces) { unresolved.push(path); continue; }
    const entering = dot(path.direction, hit.normal) < 0;
    const normal = scale(hit.normal, entering ? 1 : -1);
    const cosine = Math.min(1, Math.max(0, -dot(path.direction, normal)));
    const n1 = entering ? 1 : ior;
    const n2 = entering ? ior : 1;
    const ratio = n1 / n2;
    const sinSquared = ratio * ratio * (1 - cosine * cosine);
    const transmittedCosine = Math.sqrt(Math.max(0, 1 - sinSquared));
    const parallel = (n2 * cosine - n1 * transmittedCosine) / (n2 * cosine + n1 * transmittedCosine);
    const perpendicular = (n1 * cosine - n2 * transmittedCosine) / (n1 * cosine + n2 * transmittedCosine);
    const fresnel = sinSquared >= 1 ? 1 : (parallel * parallel + perpendicular * perpendicular) / 2;
    const weight = path.weight * (path.inside ? Math.exp(-absorption * hit.distance) : 1);
    const boundaries = [...path.boundaries, { ...hit, entering, insideDistance: path.inside ? hit.distance : 0 }];
    if (weight * fresnel >= minimumWeight) queue.push({ origin: add(hit.point, scale(normal, 2e-6)),
      direction: add(path.direction, scale(normal, 2 * cosine)), weight: weight * fresnel, inside: !entering, boundaries });
    if (sinSquared < 1 && weight * (1 - fresnel) >= minimumWeight) queue.push({ origin: add(hit.point, scale(normal, -2e-6)),
      direction: add(scale(path.direction, ratio), scale(normal, ratio * cosine - transmittedCosine)), weight: weight * (1 - fresnel), inside: entering, boundaries });
  }
  return { escaped, unresolved };
}


/** Fit the complete normalized crystal at zoom=1 for every orbit orientation.
 * Account for the real inspector footprint; user zoom/pan remains independent. */
export function opticsMeshFraming(mesh, { width, height, occludedRight = 0 }) {
  const availableWidth = Math.max(1, width - occludedRight);
  const halfField = Math.max(0.05, Math.min((height - 128) / height, (availableWidth - 48) / height));
  const radius = mesh.radius || 1;
  const tangent = radius / Math.sqrt(4.4 ** 2 - radius ** 2);
  return { cameraScale: tangent / halfField * 1.08, focusOffset: occludedRight / height };
}
