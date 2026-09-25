import test from 'node:test';
import assert from 'node:assert/strict';
import { createLabContractSamples } from './labContractSamples.js';
import { readLabDocument } from './labDocuments.js';
import { createProjectStore } from '../domain/projectLibrary.js';
import { createCommandHistory, executeFacetingCommand, undoFacetingCommand, redoFacetingCommand, createRemoveFacetsCommand,
  exportFacetingJSON, importFacetingJSON, withDocumentIndexGear, validateFacetingDocument } from '../domain/faceting.js';
import * as shared from '../domain/labsContract/index.js';
import * as hostIndex from '../domain/indexing.js';

const samples = createLabContractSamples();
const sample = id => samples.find(s => s.id === id).document;

test('host fixtures cover legacy/current planes and reject unsupported input without mutation', () => {
  for (const { id, document, reject } of samples) {
    const before = JSON.stringify(document);
    if (reject) assert.throws(() => readLabDocument(document), reject === 'validation' ? /Invalid Facet/ : { code: reject }, id);
    else {
      const result = readLabDocument(document);
      assert.ok(result.summary.volumeModelUnits > 0, id);
      assert.deepEqual(readLabDocument(exportFacetingJSON(result.document)), result, id);
      assert.equal(shared.inspectLabDocument(result.document).supported, true, id);
    }
    assert.equal(JSON.stringify(document), before, id);
  }
  assert.equal(sample('v2-mesh-rejected').schemaVersion, 2);
  assert.equal(sample('96-legacy').schemaVersion, 1);
  assert.equal(sample('99-ninefold').schemaVersion, 3);
});

test('shared rules use real normals, count fine planes, separate covered operations and effective faces', () => {
  assert.equal(hostIndex.indexCompatibilityReport, shared.indexCompatibilityReport);
  const surface = readLabDocument(sample('surface-scale-source'));
  assert.ok(surface.summary.effectiveFacetIds.includes('fine-face:0'));
  assert.equal(surface.summary.millimetersPerModelUnit, 7.125);
  const covered = readLabDocument(sample('covered-operation'));
  assert.equal(covered.summary.all.find(r => r.teeth === 96).compatible, false);
  assert.equal(covered.summary.final.find(r => r.teeth === 96).compatible, true);
  const forgedReadout = structuredClone(surface.document.facets);
  forgedReadout.forEach(f => { f.index = 0; });
  assert.deepEqual(shared.indexCompatibilityReport(forgedReadout), surface.summary.all);
  assert.throws(() => shared.indexCompatibilityReport(surface.document, { scope: 'final' }), /final scope requires/);
});

test('wheel changes retain every exact plane, identity, ordering, scale and recipe; 360 is not a universal superset', () => {
  const original = sample('surface-scale-source');
  for (const teeth of [96, 99, 120, 360, 77]) {
    const changed = withDocumentIndexGear(original, teeth);
    assert.deepEqual(changed.facets.map(f => [f.id, f.patternId, f.ordinal, f.plane]), original.facets.map(f => [f.id, f.patternId, f.ordinal, f.plane]));
    assert.deepEqual(changed.metadata, original.metadata);
    assert.deepEqual(changed.extensions, original.extensions);
    assert.equal(shared.inspectLabRecipe(changed).status, 'current');
    assert.deepEqual(readLabDocument(changed).summary.vertices, readLabDocument(original).summary.vertices);
    assert.deepEqual(importFacetingJSON(exportFacetingJSON(changed)).facets.map(f => f.plane), original.facets.map(f => f.plane));
  }
  const plane = { normal: { x: Math.cos(Math.PI / 48), y: Math.sin(Math.PI / 48), z: 0 } };
  assert.equal(shared.indexCompatibilityReport([plane], { gears: [96, 360] })[0].compatible, true);
  assert.equal(shared.indexCompatibilityReport([plane], { gears: [96, 360] })[1].compatible, false);
});

test('cold project storage retains surface, recipe, source and opaque extensions; failed reads leave source bytes intact', () => {
  const data = new Map();
  const storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k),
    get length() { return data.size; }, key: i => [...data.keys()][i] };
  const source = sample('surface-scale-source');
  createProjectStore(storage).create(source, { id: 'surface', now: 1 });
  assert.deepEqual(createProjectStore(storage).read('surface').document, source);
  const bytes = data.get('facet96:project:v1:surface');
  const invalid = JSON.parse(bytes); invalid.document = sample('required-extension-rejected');
  data.set('facet96:project:v1:blocked', JSON.stringify(invalid));
  const all = [...data];
  assert.throws(() => createProjectStore(storage).read('blocked'));
  assert.deepEqual([...data], all);
});

test('geometry edits stale the saved recipe, undo restores it, and Meet validity uses real source diagnostics', () => {
  const source = sample('surface-scale-source');
  const history = executeFacetingCommand(createCommandHistory(source), createRemoveFacetsCommand(['fine-face:0']));
  assert.equal(history.present.metadata.labRecipe.status, 'stale');
  assert.deepEqual(history.present.metadata.labRecipe.data, source.metadata.labRecipe.data);
  assert.equal(undoFacetingCommand(history).present.metadata.labRecipe.status, 'current');
  assert.equal(redoFacetingCommand(undoFacetingCommand(history)).present.metadata.labRecipe.status, 'stale');
  assert.equal(readLabDocument(sample('meet-current')).summary.construction[0].status, 'valid');
  assert.equal(readLabDocument(sample('meet-stale')).summary.construction[0].status, 'stale');
});

test('extension validation rejects unsafe data, critical features and invalid physical/surface parameters', () => {
  for (const mutate of [
    d => { d.extensions['future.curve'] = { version: 1, required: true }; },
    d => { d.metadata.extra = JSON.parse('{"__proto__":{"polluted":true}}'); },
    d => { d.metadata.physicalScale.millimetersPerModelUnit = 0; },
    d => { d.facets.at(-1).metadata.surfaceFinish.alpha = NaN; },
    d => { d.metadata.self = d.metadata; },
  ]) {
    const doc = structuredClone(sample('surface-scale-source')); mutate(doc);
    assert.equal(validateFacetingDocument(doc).valid, false);
    assert.equal(shared.inspectLabDocument(doc).supported, false);
  }
});
