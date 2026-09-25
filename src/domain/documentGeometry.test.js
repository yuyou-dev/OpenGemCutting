import assert from 'node:assert/strict';
import test from 'node:test';
import { createFacetingDocument, resolveFacetPattern } from './faceting.js';
import { assertValidDocumentGeometry, createMachiningStock } from './documentGeometry.js';
import { summarizeEffectiveFacets, evaluateDraftImpact } from './meetJump.js';
import { planeEntry } from './cutConstruction.js';
import { polyhedronVolume } from './geometry.js';

const drill = { id: 'drill', type: 'cylinder', position: [0, 0, 0], axis: [0, 0, 1], radius: 0.3, length: 4, segments: 16 };

test('the import boundary rejects a material-free combination even when both parameter groups work independently', () => {
  const facets = resolveFacetPattern({ patternId: 'central-prism', region: 'girdle', industryAngleDeg: 90, depth: 0.9, repeat: 4 });
  const planar = createFacetingDocument({ facets });
  const concave = createFacetingDocument({ concaveCuts: [drill] });
  assert.ok(polyhedronVolume(assertValidDocumentGeometry(planar)) > 0);
  assert.ok(polyhedronVolume(assertValidDocumentGeometry(concave)) > 0);
  const combined = createFacetingDocument({ facets, concaveCuts: [drill] });
  assert.throws(() => assertValidDocumentGeometry(combined), { code: 'empty-document-result' });
});

test('logical planar counts exclude hundreds of curved tool patches in final solids and CUT previews', () => {
  const doc = createFacetingDocument({ concaveCuts: [{ id: 'scoop', type: 'sphere', position: [1, 0, 0], radius: 0.5, segments: 32 }] });
  const source = createMachiningStock(doc);
  assert.ok(source.faces.filter((face) => face.region === 'concave').length > 100);
  assert.deepEqual(summarizeEffectiveFacets(source), { effectiveFacetIds: [], operations: [] });
  const facets = resolveFacetPattern({ patternId: 'table', region: 'crown', industryAngleDeg: 0, depth: 0.5, repeat: 1 });
  const impact = evaluateDraftImpact({ baseSolid: source, planes: facets.map(planeEntry) });
  const final = assertValidDocumentGeometry(createFacetingDocument({ ...doc, facets }));
  assert.deepEqual(summarizeEffectiveFacets(final).effectiveFacetIds, facets.map((facet) => facet.id));
  assert.equal(summarizeEffectiveFacets(impact.resultSolid).effectiveFacetIds.length, 1);
  assert.equal(impact.generatedFaceCount, 1);
});
