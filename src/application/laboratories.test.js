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
