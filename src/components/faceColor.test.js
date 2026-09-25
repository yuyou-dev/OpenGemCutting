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
