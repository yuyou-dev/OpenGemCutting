import { normalizedOpticsMesh, normalizedOpticsPlanes } from './opticsGeometry.js';
import { isSupportedSurfaceFinish } from './labsContract/validation.js';

/** Match the actual boundary patches, never a whole operation or a sorted slot.
 * Each material is [alpha, scatter, faceIndex + 1, 0]; zero alpha is polished. */
export function opticsSurfaceMaterials(polyhedron, facets) {
  const byId = new Map(facets.map(f => [f.id, f.metadata?.surfaceFinish]));
  let frostedCount = 0;
  const materials = polyhedron.faces.map((face, index) => {
    const finish = byId.get(face.facetId ?? face.id);
    if (finish?.state !== 'frosted') return [0, 0, index + 1, 0];
    if (!isSupportedSurfaceFinish(finish)) throw new Error('存在不支持的磨砂表面参数，请先核对设计标注。');
    frostedCount++;
    return [finish.alpha, finish.scatter ?? 0, index + 1, 0];
  });
  return { materials, frostedCount };
}

/** Convex solids within one GPU uniform block are traced by their half-spaces;
 * other solids by BVH triangles. Materials follow the traced primitive order. */
export const MAX_SURFACE_PLANES = 512;

export function normalizedSurfaceOptics(polyhedron, materials) {
  if (polyhedron.kind !== 'mesh' && polyhedron.faces.length <= MAX_SURFACE_PLANES) {
    const { planes, faceIndices, faceCount } = normalizedOpticsPlanes(polyhedron);
    return { planes, faceCount, framing: 'convex', materials: faceIndices.map(index => materials[index]) };
  }
  const mesh = normalizedOpticsMesh(polyhedron);
  return { mesh, faceCount: mesh.faceCount, framing: polyhedron.kind === 'mesh' ? 'mesh' : 'convex',
    // BVH construction reorders triangles. Resolve after that reorder.
    materials: mesh.triangles.map(triangle => materials[triangle.faceIndex]) };
}
