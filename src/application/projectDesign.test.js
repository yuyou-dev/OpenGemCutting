import assert from 'node:assert/strict';
import test from 'node:test';
import { projectDesign } from './projectDesign.js';
import { createFacetingDocument, exportFacetingJSON, resolveFacetPattern } from '../domain/faceting.js';

test('external JSON and preset creation run the same complete machining geometry preflight', async () => {
  const invalid = createFacetingDocument({
    facets: resolveFacetPattern({ patternId: 'core', region: 'girdle', industryAngleDeg: 90, depth: 0.9, repeat: 4 }),
    concaveCuts: [{ id: 'drill', type: 'cylinder', position: [0, 0, 0], axis: [0, 0, 1], radius: 0.3, length: 4, segments: 16 }],
  });
  const json = exportFacetingJSON(invalid);
  await assert.rejects(projectDesign({ name: 'bad JSON', json }), { code: 'empty-document-result' });
  await assert.rejects(projectDesign({ name: 'bad preset', presetId: 'bad' }, {
    list: async () => [{ id: 'bad' }], load: async () => invalid,
  }), { code: 'empty-document-result' });
  assert.equal(exportFacetingJSON(invalid), json);
  const valid = createFacetingDocument({ ...invalid, facets: [] });
  const imported = await projectDesign({ name: 'valid tools', json: exportFacetingJSON(valid) });
  assert.equal(imported.facets.length, 0, 'v3 parameter groups are not supplemented with a hidden default table');
  assert.deepEqual(imported.concaveCuts, valid.concaveCuts);
});
