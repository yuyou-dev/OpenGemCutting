import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { INDEX_GEARS } from './indexing.js';
import { createFacetingDocument, resolveFacetPattern, validateFacetingDocument, exportFacetingJSON, importFacetingJSON } from './faceting.js';
import { createCenteredCube } from './geometry.js';

const schema = JSON.parse(readFileSync(new URL('../../public/schemas/document-v3.schema.json', import.meta.url)));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const checkSchema = ajv.compile(schema);
const diagnostic = () => ajv.errorsText(checkSchema.errors);

function fixture(teeth = 120) {
  return createFacetingDocument({ indexGear: teeth, facets: resolveFacetPattern({ patternId: 'pentagon',
    region: 'crown', industryAngleDeg: 35, depth: 0.3, repeat: 5, baseIndex: 0, indexTeeth: teeth }),
  concaveCuts: [{ id: 'star', type: 'sphere', repeat: 5 }] });
}

test('public v3 schema accepts canonical cube/mesh documents and every supported wheel', () => {
  for (const teeth of INDEX_GEARS) {
    const document = fixture(teeth);
    assert.equal(checkSchema(document), true, diagnostic());
    assert.equal(validateFacetingDocument(document).valid, true);
    assert.equal(checkSchema(importFacetingJSON(exportFacetingJSON(document))), true, diagnostic());
  }
  const cube = createCenteredCube(2);
  const mesh = createFacetingDocument({ stock: { kind: 'mesh', size: 2, center: [0, 0, 0],
    mesh: { vertices: cube.vertices, faces: cube.faces.map(face => face.vertexIndices) } }, concaveCuts: [] });
  assert.equal(checkSchema(mesh), true, diagnostic());
});

test('schema and runtime both reject malformed parameters before geometric replay', () => {
  const cases = [
    d => { delete d.facets[0].plane; },
    d => { d.indexGear.teeth = 0; },
    d => { d.facets[0].indexTeeth = 120.5; },
    d => { d.facets[0].repeat = 361; },
    d => { d.facets[0].depth = -0.1; },
    d => { d.facets[0].index = -1; },
    d => { d.facets[0].metadata = { preform: 'yes' }; },
    d => { d.facets = {}; },
    d => { d.concaveCuts = null; },
    d => { d.concaveCuts[0].radius = 0; },
    d => { d.concaveCuts[0].repeat = 121; },
    d => { d.concaveCuts[0].segments = 13; },
    d => { d.concaveCuts[0].position = [0, 0]; },
    d => { d.concaveCuts[0].id = 'rough-cube'; },
    d => { d.schemaVersion = 2; },
  ];
  cases.forEach((mutate, index) => {
    const doc = structuredClone(fixture());
    mutate(doc);
    assert.equal(checkSchema(doc), false, `schema invalid case ${index}`);
    assert.equal(validateFacetingDocument(doc).valid, false, `runtime invalid case ${index}`);
  });
});

test('cross-field geometry and provenance remain runtime gates beyond the portable schema', () => {
  const cases = [
    d => { d.indexGear.zeroAlias = 96; },
    d => { d.facets[0].plane.normal.x += 0.1; },
    d => { d.facets[0].index = 200; }, // Bounded by this tier's 120-wheel, not global360.
    d => { d.concaveCuts[0].axis = [0, 0, 0]; },
    d => { d.concaveCuts[0].id = d.facets[0].patternId; },
    d => { d.concaveCuts.push(structuredClone(d.concaveCuts[0])); },
  ];
  for (const mutate of cases) {
    const doc = structuredClone(fixture()); mutate(doc);
    assert.equal(checkSchema(doc), true, diagnostic());
    assert.equal(validateFacetingDocument(doc).valid, false);
  }
});

test('extension metadata stays permitted while original legacy schema versions stay distinct', () => {
  const doc = fixture();
  doc.vendor = { version: 7 };
  doc.facets[0].metadata = { vendor: { custom: true } };
  assert.equal(checkSchema(doc), true, diagnostic());
  assert.equal(validateFacetingDocument(doc).valid, true);
  assert.deepEqual(importFacetingJSON(exportFacetingJSON(doc)).vendor, doc.vendor);
  const legacy = createFacetingDocument();
  assert.equal(legacy.schemaVersion, 1);
  assert.equal(checkSchema(legacy), false);
  assert.equal(validateFacetingDocument(legacy).valid, true);
});
