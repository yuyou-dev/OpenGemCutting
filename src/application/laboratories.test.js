import test from 'node:test';
import assert from 'node:assert/strict';
import { LABORATORIES, labEntryState } from './laboratories.js';
import { createLabContractSamples } from './labContractSamples.js';
const preset = LABORATORIES.find(l => l.id === 'preset');
const pattern = LABORATORIES.find(l => l.id === 'pattern');

test('no source still allows a new experiment; unavailable or pending entries explain both gates', () => {
  assert.deepEqual(labEntryState(preset, null), { source: null, canCreate: true, canBring: false, reason: '请先选择来源设计' });
  for (const [lab, options] of [[{...preset,status:'disabled'},{}],[preset,{busy:true}],[preset,{hasPreview:true}]]) {
    const state=labEntryState(lab,null,options);
    assert.equal(state.canCreate,false);assert.equal(state.canBring,false);assert.ok(state.reason);
  }
});

test('the selected lab independently gates convex mesh sources without modifying the design', () => {
  const document=createLabContractSamples('preset').find(s => s.id === 'v3-mesh-rejected').document;
  const before=structuredClone(document);
  assert.equal(labEntryState(preset,document).canBring,true);
  assert.equal(labEntryState(pattern,document).canBring,false);
  assert.equal(labEntryState(pattern,document).canCreate,true);
  assert.deepEqual(document,before);
});

test('a blocked entry names what in the design blocks it, including each laboratory budget', async () => {
  const { createWorkbenchDocument } = await import('../domain/document.js');
  const { LAB_PROFILES } = await import('../domain/labsContract/index.js');
  const { createTranslator } = await import('../i18n/format.js');
  const samples = createLabContractSamples('preset');
  const mesh = samples.find(s => s.id === 'v3-mesh-rejected').document;
  assert.match(labEntryState(pattern, mesh).reason, /异形底胚或原石/);
  const concave = samples.find(s => s.id === 'v3-concave-rejected').document;
  assert.match(labEntryState(pattern, concave).reason, /凹切/);
  const base = createWorkbenchDocument('budget');
  const many = { ...base, facets: Array.from({ length: LAB_PROFILES.pattern.maxFacets + 1 }, (_, i) => ({ ...base.facets[1], id: `g:${i}` })) };
  const reason = labEntryState(pattern, many).reason;
  assert.match(reason, new RegExp(`${many.facets.length} 道平切.*上限 ${LAB_PROFILES.pattern.maxFacets} 道`));
  assert.equal(labEntryState(preset, many).canBring, true);
  assert.match(createTranslator('en')(reason), /^This design cannot be brought in yet: it has \d+ planar cuts .* limit of 600\. The original/);
});
