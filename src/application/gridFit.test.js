import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbenchDocument } from '../domain/document.js';
test('fit to girdle finds the nearest extent without short edges at the outline', async () => {
  const { fitGridExtent } = await import('./gridFit.js');
  const { toolDraftPatch, defaultDraftForRegion } = await import('../domain/cutSession.js');
  const document = createWorkbenchDocument('fit', 96);
  const base = defaultDraftForRegion('crown');
  const draft = { ...base, ...toolDraftPatch(base, { grid: { symmetry: 3, lattice: 'hex', rings: 3 }, ring: null, patternMode: 'grid', industryAngle: 36, depth: 0.5, baseIndex: 0 }) };
  const best = fitGridExtent({ document, draft, region: 'crown' });
  assert.ok(best && best.shortest >= 0.01, `shortest ${best?.shortest}`);
  assert.ok(Math.abs(best.extent - 0.8) <= 0.16);
});

test('fit searches nearest first but returns what a full scan returns', async () => {
  const { fitGridExtent } = await import('./gridFit.js');
  const { toolDraftPatch, defaultDraftForRegion } = await import('../domain/cutSession.js');
  const document = createWorkbenchDocument('fit', 96);
  const fit = (grid) => {
    const base = defaultDraftForRegion('crown');
    return fitGridExtent({ document, region: 'crown', draft: { ...base, ...toolDraftPatch(base, { grid, ring: null, patternMode: 'grid', industryAngle: 36, depth: 0.5, baseIndex: 0 }) } });
  };
  const core = ({ extent, missing, shortest }) => ({ extent, missing, shortest });
  // Values recorded from the full ±20% scan before the search stopped early.
  assert.deepEqual(core(fit({ symmetry: 4, columns: 6, extent: 0.7 })), { extent: 0.696, missing: 0, shortest: 0.01079316782645143 });
  assert.deepEqual(core(fit({ symmetry: 4, columns: 6, extent: 1.2 })), { extent: 1.184, missing: 12, shortest: 0.012904521133306214 });
  assert.deepEqual(core(fit({ symmetry: 2, columns: 4, rows: 6, extent: 0.5 })), { extent: 0.5, missing: 0, shortest: 0.023589554996787825 });
});

test('a fit that cuts no grid face never reports success', async () => {
  const { fitGridExtent } = await import('./gridFit.js');
  const { toolDraftPatch, defaultDraftForRegion } = await import('../domain/cutSession.js');
  const document = createWorkbenchDocument('fit', 96);
  const base = defaultDraftForRegion('crown');
  // Edge angle 1° with the apex on the reference top: the tool hovers above the stone.
  const draft = { ...base, ...toolDraftPatch(base, { grid: { symmetry: 4, columns: 6 }, ring: null, patternMode: 'grid', industryAngle: 1, depth: 0, baseIndex: 0 }) };
  const best = fitGridExtent({ document, draft, region: 'crown' });
  assert.equal(best.touches, false);
  assert.equal(best.clean, false);
  assert.equal(best.missing, best.total);
});
