import { auditSolid, EXACT, NEAR, SPLIT } from '../domain/meetAudit.js';
import { evaluateDocument } from '../domain/documentGeometry.js';

/** Shared read-only inspection. Curved-tool intersections have no supported
 * planar meet semantics; do not silently substitute the pre-tool solid. */
export function inspectMeetpoints(document) {
  const base = { advisory: true, scope: 'committed-planar',
    thresholds: { clusterOfWidth: EXACT, nearOfWidth: NEAR, splitOfWidth: SPLIT } };
  if (document.concaveCuts?.some(cut => cut.enabled !== false)) {
    return { ...base, status: 'unsupported', reason: 'active-concave-cuts' };
  }
  const solid = evaluateDocument(document);
  const xs = solid.vertices.map(p => p.x);
  if (!xs.length || Math.max(...xs) - Math.min(...xs) <= 0) {
    return { ...base, status: 'unsupported', reason: 'empty-or-zero-width' };
  }
  if (!solid.faces.some(face => document.facets.some(facet => facet.id === (face.facetId ?? face.id)))) {
    return { ...base, status: 'unsupported', reason: 'no-effective-cuts' };
  }
  return { ...base, status: 'measured', ...auditSolid(document, solid) };
}
