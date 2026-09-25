import test from 'node:test';
import assert from 'node:assert/strict';
import { INDEX_GEARS, indexCompatibilityReport } from '../domain/indexing.js';
import { createWorkbenchDocument } from '../domain/document.js';
import { createFacetingDocument, withDocumentIndexGear, createCommandHistory, executeFacetingCommand, createReplaceDocumentCommand, undoFacetingCommand, redoFacetingCommand, importFacetingJSON, resolveFacetPattern } from '../domain/faceting.js';
import { prepareConcaveTool, planDesign } from './designOperations.js';
import { CONCAVE_PRESETS, concaveToolDepth } from './concaveTools.js';
import { evaluateDocument } from '../domain/documentGeometry.js';
import { measurePolyhedron } from '../domain/geometry.js';
import { projectDesign } from './projectDesign.js';
const volume = document => measurePolyhedron(evaluateDocument(document)).volume;

test('every equipment wheel creates an integer-tooth girdle, including 120/30 and odd wheels', async () => {
  for (const teeth of INDEX_GEARS) {
    const document = await projectDesign({ name: '设备测试', indexTeeth: teeth });
    assert.ok(document.facets.every(f => (f.indexTeeth ?? 96) === teeth));
    assert.ok(indexCompatibilityReport(document, { gears: [teeth] })[0].compatible);
    assert.ok(volume(document) > 0);
  }
  assert.equal(createWorkbenchDocument('120', 120).facets[1].repeat, 30);
});

test('legacy mixed layers use one project wheel without moving geometry or changing face IDs', () => {
  const base = createWorkbenchDocument('legacy');
  const mixed = { ...createFacetingDocument({ ...base, indexGear: 120 }), facets: [...base.facets,
    ...resolveFacetPattern({ patternId: 'five', indexTeeth: 120, region: 'crown', baseIndex: 12, repeat: 5, industryAngleDeg: 35, depth: .3 })] };
  const migrated = importFacetingJSON(JSON.stringify(mixed));
  assert.ok(migrated.facets.every(f => f.indexTeeth === 120));
  assert.deepEqual(migrated.facets.map(f => f.id), mixed.facets.map(f => f.id));
  assert.deepEqual(migrated.facets.map(f => f.plane), mixed.facets.map(f => f.plane));
  assert.ok(Math.abs(volume(mixed) - volume(migrated)) < 1e-10);
  assert.equal(indexCompatibilityReport(migrated, { gears: [120] })[0].compatible, false);
  const history = executeFacetingCommand(createCommandHistory(migrated), createReplaceDocumentCommand(withDocumentIndexGear(migrated, 96)));
  assert.equal(undoFacetingCommand(history).present.indexGear.teeth, 120);
  assert.deepEqual(redoFacetingCommand(undoFacetingCommand(history)).present, history.present);
});

test('preset concave tools reduce material independently of planar wheel and are undoable', () => {
  const original = createWorkbenchDocument('120', 120);
  for (const preset of CONCAVE_PRESETS) {
    const result = prepareConcaveTool(original, { toolId: preset.id, preset: preset.id });
    assert.ok(volume(result.document) < volume(original));
    assert.deepEqual(result.document.facets, original.facets);
    assert.deepEqual(result.document.stock, original.stock);
    assert.ok(indexCompatibilityReport(result.document, { gears: [120] })[0].compatible);
    const initialDepth = concaveToolDepth(result.document, result.document.concaveCuts[0]);
    const deeper = prepareConcaveTool(result.document, { toolId: preset.id, toolDepth: initialDepth + .04, repeat: 6 });
    assert.equal(deeper.document.concaveCuts[0].repeat, 6);
    assert.ok(volume(deeper.document) < volume(result.document));
    const history = executeFacetingCommand(createCommandHistory(original), result.command);
    assert.deepEqual(undoFacetingCommand(history).present, original);
  }
});

test('simple depth editing preserves imported custom cutter radius, axis, height and phase', () => {
  const doc = createFacetingDocument({ ...createWorkbenchDocument('custom', 120), concaveCuts: [{ id: 'custom', type: 'cylinder', radius: .22, position: [.86, .2, .1], axis: [.1, 0, 1], length: 2.8, phaseDeg: 18, repeat: 3 }] });
  const cut = doc.concaveCuts[0];
  const result = prepareConcaveTool(doc, { toolId: cut.id, toolDepth: concaveToolDepth(doc, cut) + .01 });
  const changed = result.document.concaveCuts[0];
  for (const key of ['radius', 'axis', 'length', 'phaseDeg', 'segments', 'repeat']) assert.deepEqual(changed[key], cut[key]);
  assert.equal(changed.position[2], cut.position[2]);
});

test('MCP uses the same preset operation and rejects a second equipment wheel for planar authoring', () => {
  const doc = createWorkbenchDocument('shared', 120);
  const result = planDesign(doc, [{ kind: 'concave-tool', toolId: 'groove', preset: 'flute', repeat: 5, toolDepth: .14 }]);
  assert.equal(result.document.concaveCuts[0].repeat, 5);
  assert.throws(() => planDesign(doc, [{ kind: 'cut', patternId: 'wrong-wheel', region: 'crown', draft: { indexTeeth: 96 } }]), /项目分度盘/);
});
