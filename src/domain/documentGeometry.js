import { getCuttingReference } from './faceting.js';
import { normalizeConcaveCuts, expandConcaveCuts } from './concaveCuts.js';
import { clipPolyhedronByPlanes, polyhedronVolume, indexedBooleanSource } from './geometry.js';
import { PolyhedronError, adoptValidatedWorkerMesh } from './mesh/index.js';
import { createStockSolid } from './stockGeometry.js';
import { subtractRoundCutters } from './mesh/boolean.js';

const EMPTY_FACETS = Object.freeze([]);
const EMPTY_TOOLS = normalizeConcaveCuts([]);
const planarCache = new WeakMap();
const booleanCache = new WeakMap();
const solvedCache = new WeakMap();
const planesOf = facets => facets.map(facet => ({ ...facet.plane, operationId: facet.patternId,
  faceId: facet.id, region: facet.region, operationType: facet.metadata?.operationType }));

function resultsFor(stock) {
  let results = solvedCache.get(stock);
  if (!results) { results = new WeakMap(); solvedCache.set(stock, results); }
  return results;
}

/** Planar construction uses only the immutable blank and planar halfspaces.
 * Meet/Jump references never depend on Boolean tessellation or tool settings. */
export function evaluatePlanarDocument(document, { facets = document.facets } = {}) {
  const planes = planesOf(facets), key = JSON.stringify(planes);
  const cached = planarCache.get(document.stock);
  if (cached?.key === key) return cached.solid;
  const solid = clipPolyhedronByPlanes(createStockSolid(document.stock), planes);
  planarCache.set(document.stock, { key, solid });
  return solid;
}

/** Apply the independent tool group to a planar result or preview. This never
 * becomes the source for saved planar constraints, machine depth or history. */
export function applyConcaveCuts(document, planarSolid, { concaveCuts = document.concaveCuts } = {}) {
  const cuts = normalizeConcaveCuts(concaveCuts ?? EMPTY_TOOLS);
  if (!planarSolid.vertices.length || !cuts.some(cut => cut.enabled)) return planarSolid;
  let byTools = booleanCache.get(planarSolid);
  if (!byTools) { byTools = new WeakMap(); booleanCache.set(planarSolid, byTools); }
  const reference = getCuttingReference(document);
  let cached = byTools.get(cuts);
  if (!cached || cached.reference !== reference) {
    const operand = indexedBooleanSource(planarSolid);
    const result = subtractRoundCutters(operand, expandConcaveCuts(cuts, reference.center));
    cached = { reference, solid: result === operand ? planarSolid : result };
    byTools.set(cuts, cached);
  }
  return cached.solid;
}

/** Accept only the bundled worker's fully validated final mesh, not imports.
 * Key by every geometry input so history clones can reuse the same result. */
export function adoptWorkerGeometry(document, solid) {
  adoptValidatedWorkerMesh(solid);
  resultsFor(document.stock).set(document.concaveCuts ?? EMPTY_TOOLS, {
    reference: getCuttingReference(document), key: JSON.stringify(planesOf(document.facets)), solid,
  });
}

/** A concave-only result for callers explicitly evaluating the tool group. */
export function createMachiningStock(document, { concaveCuts = document.concaveCuts } = {}) {
  return evaluateDocument(document, { facets: EMPTY_FACETS, concaveCuts });
}

/** (stock intersected with planar halfspaces) minus all enabled tools.
 * The set result is independent of the order in which parameters were edited. */
export function evaluateDocument(document, { facets = document.facets, concaveCuts = document.concaveCuts } = {}) {
  const cuts = normalizeConcaveCuts(concaveCuts ?? EMPTY_TOOLS);
  const reference = getCuttingReference(document);
  const key = JSON.stringify(planesOf(facets));
  const results = resultsFor(document.stock), cached = results.get(cuts);
  if (cached?.key === key && cached.reference === reference) return cached.solid;
  const solid = applyConcaveCuts(document, evaluatePlanarDocument(document, { facets }), { concaveCuts: cuts });
  results.set(cuts, { key, reference, solid });
  return solid;
}

/** Commit/import/storage boundary: a valid tool and valid planar parameters
 * can still remove all remaining material when combined. */
export function assertValidDocumentGeometry(document) {
  let solid;
  try { solid = evaluateDocument(document); }
  catch (error) { if (error.code !== 'empty-concave-result') throw error; }
  const volume = solid ? polyhedronVolume(solid) : 0;
  if (!solid?.vertices.length || !Number.isFinite(volume) || volume <= 1e-10) {
    throw new PolyhedronError('empty-document-result', '组合加工参数没有保留有效材料；请减小切深、刀具半径或调整位置。');
  }
  return solid;
}
