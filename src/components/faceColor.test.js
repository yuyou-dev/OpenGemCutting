import test from 'node:test';
import assert from 'node:assert/strict';
import { faceColor } from './faceColor.js';
test('coplanar Boolean triangles have identical monochrome fill at every height', () => {
  for (const mode of ['solid', 'xray']) {
    const faces = [-1, -.2, .3, 1].map(z => ({ center: [0, 0, z], normal: [.6, .8, 0], operationId: 'girdle' }));
    const colors = faces.map(face => faceColor(face, mode));
    assert.ok(colors.every(color => JSON.stringify(color) === JSON.stringify(colors[0])));
    assert.equal(colors[0][0], colors[0][1]);
    assert.equal(colors[0][1], colors[0][2]);
    const selected = faces.map(face => faceColor(face, mode, null, 'girdle'));
    assert.ok(selected.every(color => JSON.stringify(color) === JSON.stringify(selected[0])));
    assert.notDeepEqual(selected[0], colors[0]);
  }
});

test('surface cue follows the facet, including Boolean patches, while selection takes priority', () => {
  const frosted = new Set(['matte']);
  const face = { id: 'matte:patch:1', facetId: 'matte', normal: [0, 0, 1], operationId: 'same-layer' };
  const polished = { ...face, id: 'polished', facetId: 'polished' };
  for (const mode of ['solid', 'xray']) {
    const plain = faceColor(face, mode);
    const matte = faceColor(face, mode, null, null, null, frosted);
    assert.notDeepEqual(matte, plain);
    assert.equal(matte[3], plain[3], 'surface cue preserves the view transparency');
    assert.deepEqual(faceColor(polished, mode, null, null, null, frosted), plain, 'other faces in the same layer stay polished');
    assert.deepEqual(faceColor({ ...face, id: 'matte:patch:2' }, mode, null, null, null, frosted), matte);
    assert.deepEqual(faceColor({ ...face, id: 'matte', facetId: undefined }, mode, null, null, null, frosted), matte);
    for (const priority of [['same-layer', null, null], [null, 'same-layer', null], [null, null, 'same-layer']])
      assert.deepEqual(faceColor(face, mode, ...priority, frosted), faceColor(face, mode, ...priority));
  }
});
