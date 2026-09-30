import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { projectDesign } from './projectDesign.js';
import { planDesign } from './designOperations.js';
import { indexCompatibilityReport } from '../domain/indexing.js';
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

test('the documented 120-wheel example executes on one project wheel and survives JSON exchange', async () => {
  const examples = await readFile(new URL('../../docs/mcp/examples.md', import.meta.url), 'utf8');
  const section = examples.split('## 120 分度与五次对称')[1].split('\n## ')[0];
  const operations = JSON.parse(section.match(/```json\n([\s\S]*?)\n```/)[1]);
  const document = await projectDesign({ name: '120 分度五折练习', indexTeeth: 120 });
  const result = planDesign(document, operations).document;
  const restored = await projectDesign({ name: result.name, json: exportFacetingJSON(result) });
  assert.equal(restored.indexGear.teeth, 120);
  assert.ok(restored.facets.every(facet => facet.indexTeeth === 120));
  assert.deepEqual(restored.facets.filter(facet => facet.patternId === 'five-crown').map(facet => facet.index).sort((a, b) => a - b), [0, 24, 48, 72, 96]);
  assert.ok(indexCompatibilityReport(restored, { gears: [120] })[0].compatible);
});

test('the default start takes the same outline and girdle choices over MCP', async () => {
  const girdle = (document) => document.facets.filter((facet) => facet.region === 'girdle');
  const square = await projectDesign({ name: 'square', outline: 'square' });
  assert.deepEqual(girdle(square).map((facet) => facet.index).sort((a, b) => a - b), [0, 24, 48, 72]);
  assert.equal(girdle(await projectDesign({ name: 'twelve', indexTeeth: 72, girdleFacets: 12 })).length, 12);
  await assert.rejects(projectDesign({ name: 'odd', indexTeeth: 99, outline: 'square' }), { code: 'INVALID_START' });
  await assert.rejects(projectDesign({ name: 'ten', girdleFacets: 10 }), (error) => error.code === 'INVALID_START' && error.details.choices.includes(12));
  await assert.rejects(projectDesign({ name: 'mixed', outline: 'square', stockPresetId: 'heart' }), { code: 'INVALID_START' });
});
