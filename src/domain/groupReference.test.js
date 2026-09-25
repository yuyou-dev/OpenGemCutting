import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { importFacetingJSON, createFacetingDocument } from './faceting.js';
import { resolveGroupReference } from './groupReference.js';
import { prepareConcaveTool, transformGroup } from '../application/designOperations.js';
import { normalizeMeshStock } from './meshStock.js';
import { createCenteredCube } from './geometry.js';
const original = importFacetingJSON(await readFile(new URL('../../public/presets/documents/100058-pc-07-001c-square-emerald-1-4.json', import.meta.url), 'utf8'));

test('group height and transform parameters ignore concave tools and physical blank boundaries', () => {
  const concave = prepareConcaveTool(original, { toolId: 'v', preset: 'v-groove', toolDepth: .65, phaseDeg: 17.5 }).document;
  const blank = createFacetingDocument({ ...original, cuttingReference: original.stock,
    stock: normalizeMeshStock({ kind: 'mesh', size: 1.8, center: [0, 0, 0], mesh: createCenteredCube(1.8) }) });
  const reference = resolveGroupReference(original);
  assert.ok(reference.crownHeight > .1);
  for (const document of [concave, blank]) {
    assert.deepEqual(resolveGroupReference(document), reference);
    for (const region of ['crown', 'pavilion']) {
      const operation = { scale: .8, deltaZ: .02, rotationTeeth: 2 };
      assert.deepEqual(transformGroup(document, region, operation).facets, transformGroup(original, region, operation).facets);
    }
  }
});

test('missing planar girdle uses the machine equator, not the top of the blank', () => {
  const document = createFacetingDocument({ ...original, facets: original.facets.filter(f => f.region !== 'girdle') });
  const reference = resolveGroupReference(document);
  assert.equal(reference.hasGirdle, false);
  assert.equal(reference.top, 0); assert.equal(reference.bottom, 0);
  assert.ok(reference.crownHeight > .1); assert.ok(reference.pavilionHeight > .1);
});
