import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gridCutLayout } from './gridCut.js';
import { envelopeMeets, envelopeShortestEdge, solveMeets } from './meetSolver.js';

// Grid layouts recorded with the solver before it moved into meetSolver.js (commit 0d66a84).
const baseline = JSON.parse(readFileSync(new URL('./fixtures/grid-solver-baseline.json', import.meta.url)));

test('grid cuts solve exactly as before the shared meet solver', () => {
  for (const { grid, indexTeeth, edgeAngle, levels, report } of baseline) {
    const layout = gridCutLayout(grid, { indexTeeth, edgeAngle, depth: 0.4, rotation: 3 });
    const label = JSON.stringify([grid, indexTeeth]);
    assert.equal(layout.levels.length, levels.length, label);
    layout.levels.forEach((level, i) => {
      const [angle, depth, indices] = levels[i];
      assert.ok(Math.abs(level.industryAngleDeg - angle) <= 1e-12, `${label}: angle ${i}`);
      assert.ok(Math.abs(level.depth - depth) <= 1e-12, `${label}: depth ${i}`);
      assert.deepEqual(level.indices, indices, `${label}: indices ${i}`);
    });
    assert.equal(layout.report.meets, report.meets, label);
    assert.ok(Math.abs(layout.report.meetResidual - report.meetResidual) <= 1e-12 && Math.abs(layout.report.maxShift - report.maxShift) <= 1e-12, label);
  }
});

test('the envelope finds the corners where four or more planes meet, inside the rim only', () => {
  // A square pyramid: four faces meet at the apex.
  const pyramid = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, y]) => ({ g: [x, y], c: 0 }));
  const meets = envelopeMeets(pyramid);
  assert.equal(meets.length, 1);
  assert.deepEqual(meets[0].planes, [0, 1, 2, 3]);
  assert.ok(Math.hypot(...meets[0].xy) < 1e-12 && Math.abs(meets[0].z) < 1e-12);
  // Three planes are never a meet to solve; a raised plane leaves only three-face corners.
  assert.equal(envelopeMeets(pyramid.slice(0, 3)).length, 0);
  assert.equal(envelopeMeets([...pyramid.slice(0, 3), { g: [0, -1], c: 0.1 }]).length, 0);
  assert.equal(envelopeMeets(pyramid, { radius: 1e-3 }).length, 1);
  assert.ok(envelopeShortestEdge([...pyramid.slice(0, 3), { g: [0, -1], c: 0.1 }]) > 0.09);
});

test('rounded planes are solved back through one point, symmetric groups sharing their values', () => {
  // Four planes of one group (shared slope and height) turned off their ideal azimuths, plus a flat table.
  const turn = [0.02, Math.PI / 2 - 0.01, Math.PI + 0.03, (3 * Math.PI) / 2];
  const planes = turn.map((phi) => ({ group: 0, cos: Math.cos(phi), sin: Math.sin(phi) }));
  planes.push({ group: 1, cos: 1, sin: 0 });
  const solved = solveMeets({
    groups: [{ m: 1, c: 0 }, { m: 0, c: -0.3, fixedSlope: true }],
    planes,
    points: [{ xyz: [0, 0, 0], planes: [0, 1, 2, 3] }, { xyz: [0.3, 0, -0.3], planes: [0, 4, 1] }],
  });
  assert.ok(solved.residual < 1e-15, `residual ${solved.residual}`);
  assert.equal(solved.groups[1].m, 0, 'a flat group keeps its slope');
});
