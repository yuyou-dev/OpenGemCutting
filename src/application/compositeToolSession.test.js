import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbenchDocument } from '../domain/document.js';
import { DEFAULT_GRID_CUT } from '../domain/gridCut.js';
import { toolParamsPatch, toolReport } from './compositeToolSession.js';

test('a grid symmetry the wheel cannot mirror on whole teeth drops the mirror', () => {
  const draft = { grid: { ...DEFAULT_GRID_CUT, symmetry: 4, mirror: true }, indexTeeth: 80, patternMode: 'grid' };
  assert.equal(toolParamsPatch(draft, { symmetry: 6, lattice: 'hex' }).grid.mirror, false, '80 teeth cannot mirror six-fold');
  assert.equal(toolParamsPatch({ ...draft, indexTeeth: 96 }, { symmetry: 6, lattice: 'hex' }).grid.mirror, true);
  assert.equal(toolParamsPatch(draft, { columns: 5 }).grid.mirror, true, 'other changes keep a valid mirror');
});

test('the tool report carries the ring warnings the old composer panel showed', () => {
  const ring = { kind: 'arc', symmetry: 2, subdivisions: 2, bulge: 0.05, rotation: 0 };
  const draft = { ring, indexTeeth: 32, industryAngle: 40, depth: 0.2, baseIndex: 0, patternMode: 'arbitrary' };
  const { warnings } = toolReport(draft, { document: createWorkbenchDocument(), region: 'crown', facets: [] });
  assert.ok(warnings.some((text) => text.includes('已合并')), 'merged facets are reported');
  assert.ok(warnings.some((text) => text.includes('不足以围成外形')), 'a ring that rounds to too few facets is reported');
});

test('the tool report says how tooth snapping kept the meets, and warns where it could not', () => {
  const document = createWorkbenchDocument();
  const report = (tool, snap = 'tooth') => toolReport({
    composite: { tool, params: {}, extent: 1, snap }, indexTeeth: 96, industryAngle: 34, depth: 0.2, baseIndex: 0, patternMode: 'composite',
  }, { document, region: 'crown', facets: [] });
  const asanoha = report('asanoha');
  assert.ok(asanoha.notes.some((text) => text.includes('个多面交点已联合求解')), 'solved meets are named');
  assert.ok(!asanoha.notes.some((text) => text.includes('可能不再精确')) && asanoha.warnings.length === 0, asanoha.warnings.join(' / '));
  const pentagrid = report('pentagrid');
  assert.ok(pentagrid.warnings.some((text) => text.includes('被相邻刻面切开') && text.includes('精确小数')), 'cut-off corners are an amber warning');
  // Exact indexing is unchanged: fractional indices and the wheels that can cut them.
  assert.ok(report('pentagrid', 'exact').warnings.some((text) => text.includes('小数分度')));
});
