import { getCuttingReference } from './faceting.js';
import { createCenteredCube, clipPolyhedronByPlanes } from './geometry.js';

/** The planar design, independent of the physical blank and concave tools.
 * Missing girdle uses the fixed machine equator, never a stock bounding face. */
export function resolveGroupReference(document) {
  const reference = getCuttingReference(document);
  const solid = clipPolyhedronByPlanes(createCenteredCube(reference.size, { center: reference.center }),
    document.facets.map(facet => ({ ...facet.plane, faceId: facet.id, operationId: facet.patternId, region: facet.region })));
  const girdleIds = new Set(document.facets.filter(f => f.region === 'girdle').map(f => f.patternId));
  const zs = solid.faces.filter(face => girdleIds.has(face.sourceOperationId))
    .flatMap(face => face.vertexIndices.map(id => solid.vertices[id].z));
  const centerZ = reference.center[2];
  const top = zs.length ? Math.max(...zs) : centerZ;
  const bottom = zs.length ? Math.min(...zs) : centerZ;
  const heights = solid.vertices.map(p => p.z);
  return { hasGirdle: zs.length > 0, top, bottom,
    crownHeight: heights.length ? Math.max(0, Math.max(...heights) - top) : 0,
    pavilionHeight: heights.length ? Math.max(0, bottom - Math.min(...heights)) : 0 };
}
