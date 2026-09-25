import test from 'node:test';
import assert from 'node:assert/strict';
import { indexCandidates, planeThroughNodes, patternFromPlane, inspectPlane } from './sharedPlanes.js';

test('shared-plane candidates follow the requested gear without silently rounding the exact design', () => {
  assert.deepEqual(indexCandidates(72, 1, 120).map(c => c.index), [24, 23, 25]);
  assert.equal(indexCandidates(72, 1, 96)[0].index, 19);
  assert.ok(indexCandidates(72, 1, 96)[0].errorDegrees > 0);
  assert.equal(indexCandidates(72, 1, 360)[0].errorDegrees, 0);
});

test('shared-node plane and emitted pattern retain continuous direction across different wheels', () => {
  const radians = 72 * Math.PI / 180;
  const a = [Math.cos(radians) * 0.5, Math.sin(radians) * 0.5, 0.5];
  const b = [0, 0, 1];
  const original = planeThroughNodes(24, a, b, 'crown', 120);
  assert.equal(inspectPlane(original, [a, b]).passed, true);
  const continuous = planeThroughNodes(19.2, a, b, 'crown', 96);
  original.normal.forEach((v, i) => assert.ok(Math.abs(v - continuous.normal[i]) < 1e-10));
  const facets = patternFromPlane(original, { id: 'node-cut', region: 'crown', baseIndex: 24, repeat: 5, indexTeeth: 120 });
  assert.equal(facets.length, 5);
  assert.equal(facets[0].indexTeeth, 120);
  assert.throws(() => patternFromPlane(original, { id: 'mismatch', region: 'crown', baseIndex: 24, indexTeeth: 96 }), /azimuth/);
});
