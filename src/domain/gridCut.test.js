import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbenchDocument } from './document.js';
import { createFacetingDocument, resolveFacet, validateFacetingDocument } from './faceting.js';
import { evaluateDocument } from './documentGeometry.js';
import { summarizeEffectiveFacets } from './meetJump.js';
import {
  gridCutLayout, gridCutFacets, gridCutFromFacets, gridCutMetadata, gridSymmetryAvailable, normalizeGridCut, gridDissolveLevels,
} from './gridCut.js';

const LATTICES = [
  ['square 4-fold 6×6', { symmetry: 4, columns: 6 }],
  ['square 4-fold 5×5 with a table cell', { symmetry: 4, columns: 5 }],
  ['square 2-fold 4×6', { symmetry: 2, columns: 4, rows: 6 }],
  ['square 1-fold 5×3 without mirror', { symmetry: 1, mirror: false, columns: 5, rows: 3 }],
  ['honeycomb 3-fold', { symmetry: 3, lattice: 'hex', rings: 3 }],
  ['honeycomb 6-fold', { symmetry: 6, lattice: 'hex', rings: 3 }],
  ['triangles 3-fold', { symmetry: 3, lattice: 'tri', rings: 3 }],
  ['triangles 6-fold', { symmetry: 6, lattice: 'tri', rings: 3 }],
];

function cutDocument(grid, place = {}) {
  const base = createWorkbenchDocument('grid', 96);
  const options = { reference: base.stock, ...place };
  const facets = gridCutFacets(grid, options).map((cell, ordinal) => resolveFacet({
    id: `grid:${cell.cell}`, patternId: 'grid', ordinal, region: 'crown', baseIndex: cell.index, index: cell.index, repeat: 1, mirror: 0,
    industryAngleDeg: cell.industryAngleDeg, depth: cell.depth, label: 'C1 网格',
    metadata: { patternMode: 'arbitrary', gridCell: cell.cell, grid: gridCutMetadata({ grid: normalizeGridCut(grid), edgeAngle: options.edgeAngle ?? 36, depth: options.depth ?? 0.5, rotation: options.rotation ?? 0 }) },
  }, { stock: base.stock }));
  return { base, facets, document: createFacetingDocument({ ...base, facets: [...base.facets.filter((f) => f.region === 'girdle'), ...facets] }) };
}

const shortestEdge = (solid) => {
  const P = solid.vertices.map((v) => [v.x, v.y, v.z]);
  let shortest = Infinity;
  for (const face of solid.faces) face.vertexIndices.forEach((a, i, all) => {
    const p = P[a], q = P[all[(i + 1) % all.length]];
    shortest = Math.min(shortest, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
  });
  return shortest;
};

test('every lattice cuts all its cells on whole teeth, and every interior lattice point is one meet', () => {
  for (const [name, grid] of LATTICES) {
    const layout = gridCutLayout(grid);
    assert.ok(layout.report.meetResidual < 1e-12, `${name}: meets ${layout.report.meetResidual}`);
    assert.ok(layout.report.upright, name);
    assert.ok(layout.cells.every((cell) => Number.isInteger(cell.index)), name);
    const { facets, document } = cutDocument(grid);
    assert.equal(validateFacetingDocument(document).valid, true, name);
    const solid = evaluateDocument(document), effective = new Set(summarizeEffectiveFacets(solid).effectiveFacetIds);
    assert.equal(facets.filter((facet) => effective.has(facet.id)).length, facets.length, `${name}: every cell is cut`);
    // A missed meet would leave an edge of rounding size instead of one point.
    assert.ok(shortestEdge(solid) > 1e-3, `${name}: shortest edge ${shortestEdge(solid)}`);
  }
});

test('symmetry: each level is one orbit, closed under the symmetry operations', () => {
  for (const [name, grid] of LATTICES) {
    const layout = gridCutLayout(grid), g = layout.grid, step = 96 / g.symmetry;
    for (const level of layout.levels) {
      const indices = new Set(level.indices);
      if (level.flat) continue;
      for (const index of indices) {
        assert.ok(indices.has((index + step) % 96), `${name}: rotation`);
        if (g.mirror) assert.ok(indices.has((96 - index) % 96), `${name}: mirror`);
      }
    }
  }
});

test('the tool moves rigidly: whole-tooth rotation and depth keep every meet and every cell', () => {
  const grid = { symmetry: 4, columns: 6 };
  const still = gridCutLayout(grid), turned = gridCutLayout(grid, { rotation: 5, depth: 0.42 });
  assert.equal(turned.report.meetResidual, still.report.meetResidual);
  assert.deepEqual(turned.levels.map((level) => level.industryAngleDeg), still.levels.map((level) => level.industryAngleDeg));
  assert.deepEqual(turned.levels.map((level) => level.indices.map((i) => (i - 5 + 96) % 96)), still.levels.map((level) => level.indices));
  const { facets, document } = cutDocument(grid, { rotation: 5, depth: 0.42 });
  const effective = new Set(summarizeEffectiveFacets(evaluateDocument(document)).effectiveFacetIds);
  assert.equal(facets.filter((facet) => effective.has(facet.id)).length, 36);
  assert.throws(() => gridCutLayout(grid, { rotation: 2.5 }), /整齿/);
});

test('a single row: with its symmetric copies, or that row alone with the symmetry that keeps it', () => {
  const copies = gridCutLayout({ symmetry: 4, columns: 6, scope: 'row', row: 1 });
  const alone = gridCutLayout({ symmetry: 4, columns: 6, scope: 'row', row: 1, rowCopies: false });
  assert.equal(copies.cells.length, 20);
  assert.equal(alone.cells.length, 6);
  assert.ok(alone.cells.every((cell) => cell.row === 1));
  // Alone, the row keeps only its own mirror: three mirror pairs.
  assert.equal(alone.levels.length, 3);
  assert.throws(() => gridCutLayout({ symmetry: 4, columns: 6, scope: 'row', row: 9 }), /没有网格单元/);
});

test('wheels: symmetry and mirror axes must sit on whole teeth', () => {
  assert.equal(gridSymmetryAvailable(4, 96), true);
  assert.equal(gridSymmetryAvailable(3, 99, true), false);
  assert.equal(gridSymmetryAvailable(3, 99, false), true);
  assert.throws(() => normalizeGridCut({ symmetry: 2, mirror: true }, 77), /镜像/);
  const layout = gridCutLayout({ symmetry: 3, mirror: false, lattice: 'hex', rings: 2 }, { indexTeeth: 99 });
  assert.ok(layout.cells.every((cell) => Number.isInteger(cell.index) && cell.index < 99));
});

test('a saved grid stays editable only while its facets still match the tool', () => {
  const grid = { symmetry: 4, columns: 4 };
  const { base, facets } = cutDocument(grid, { depth: 0.45, rotation: 3 });
  const saved = gridCutFromFacets(facets, base.stock);
  assert.deepEqual(saved, { grid: normalizeGridCut(grid), edgeAngle: 36, depth: 0.45, rotation: 3 });
  const edited = facets.map((facet, i) => (i === 0 ? { ...facet, depth: facet.depth + 0.01 } : facet));
  assert.equal(gridCutFromFacets(edited, base.stock), null);
  const levels = gridDissolveLevels(saved, { reference: base.stock });
  assert.equal(levels.reduce((sum, level) => sum + level.indices.length, 0) <= facets.length, true);
  assert.ok(levels.every((level) => Number.isFinite(level.industryAngleDeg) && Number.isFinite(level.depth)));
});

test('one solve serves every edge angle: the tool scales with the slope and every meet stays exact', () => {
  const grid = { symmetry: 3, lattice: 'tri', rings: 5 };
  const base = gridCutLayout(grid, { edgeAngle: 30 });
  for (const edgeAngle of [10, 45, 70]) {
    const layout = gridCutLayout(grid, { edgeAngle });
    const ratio = Math.tan(edgeAngle * Math.PI / 180) / Math.tan(30 * Math.PI / 180);
    layout.levels.forEach((level, i) => {
      if (level.flat) return;
      assert.ok(Math.abs(Math.tan(level.industryAngleDeg * Math.PI / 180) / Math.tan(base.levels[i].industryAngleDeg * Math.PI / 180) - ratio) < 1e-9);
      assert.deepEqual(level.indices, base.levels[i].indices);
    });
    assert.ok(layout.report.meetResidual < 1e-12, `edge ${edgeAngle}: ${layout.report.meetResidual}`);
  }
  // Large lattices solve once in well under a second (dense solve only over the orbit planes).
  const started = performance.now();
  gridCutLayout({ symmetry: 4, columns: 12, extent: 0.79 }, { edgeAngle: 40 });
  assert.ok(performance.now() - started < 1000);
});
