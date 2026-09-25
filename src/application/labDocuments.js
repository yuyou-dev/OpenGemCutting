import { importFacetingJSON } from '../domain/faceting.js';
import { assertValidDocumentGeometry } from '../domain/documentGeometry.js';
import { polyhedronVolume } from '../domain/geometry.js';
import { buildConstructionStages } from '../domain/constructionHistory.js';
import { inspectLabDocument, indexCompatibilityReport, millimetersPerModelUnit } from '../domain/labsContract/index.js';

/** Full host boundary for fixtures and future source/candidate exchange.
 * Pure: never saves, replaces a project, commits a CUT, or executes a recipe.
 */
export function readLabDocument(input) {
  const document = importFacetingJSON(input);
  const inspection = inspectLabDocument(document);
  if (!inspection.supported) {
    const error = new Error(inspection.errors.map(e => `${e.path}: ${e.message}`).join('\n'));
    error.code = 'LAB_UNSUPPORTED_DOCUMENT';
    error.errors = inspection.errors;
    throw error;
  }
  const solid = assertValidDocumentGeometry(document);
  const ids = new Set(document.facets.map(f => f.id));
  const effectiveFacetIds = [...new Set(solid.faces.map(f => f.facetId ?? f.id).filter(id => ids.has(id)))].sort();
  return { document, summary: {
    schemaVersion: document.schemaVersion,
    millimetersPerModelUnit: millimetersPerModelUnit(document),
    volumeModelUnits: polyhedronVolume(solid),
    vertices: solid.vertices.map(p => [p.x, p.y, p.z]).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]),
    effectiveFacetIds,
    construction: buildConstructionStages(document).filter(s => s.construction).map(s => ({
      patternId: s.patternId, status: s.construction.status, reason: s.construction.reason,
    })),
    all: indexCompatibilityReport(document),
    final: indexCompatibilityReport(document, { scope: 'final', effectiveFacetIds }),
  } };
}
