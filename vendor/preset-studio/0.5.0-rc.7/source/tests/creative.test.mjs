import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePreset, componentPreview } from '../src/domain/generators.js';
import { creativeEdit, editTier, rhythmWidths } from '../src/domain/creative.js';
import { validateComponent, planesEquivalent, importNativeDocument } from '../src/domain/io.js';
import { createStudioStore } from '../src/application/studioStore.js';
import { buildCreativeChoices } from '../src/application/creativeCandidates.js';
import { makeNativeDocument } from '../src/adapters/opengemcutting.js';

const waitPreview = async s => {
    for (let i = 0; i < 100; i++) { if (s.api.getPreview()?.valid) return; await new Promise(r => setTimeout(r, 10)); }
    throw Error('preview timeout');
};

test('tier rotation keeps angles and waist, blocks a waist-breaking step and fractional steps', () => {
    for (const part of ['crown', 'pavilion']) {
        const c = generatePreset({ family: 'step', part });
        const next = editTier(c, 1, { teethOffset: 1 }, {}, 96);
        assert.equal(next.recipe.version, 2);
        const rim = componentPreview(c).find(f => f.role === 'interface').v;
        const nextRim = componentPreview(next).find(f => f.role === 'interface').v;
        assert.equal(rim.length, nextRim.length);
        rim.forEach((v, i) => assert.ok(Math.hypot(...v.map((x,k) => x-nextRim[i][k])) < 1e-8));
        next.planes.forEach((p, i) => {
            assert.ok(Math.abs(p.n[2] - c.planes[i].n[2]) < 1e-12);
            assert.ok(Math.abs(p.d - c.planes[i].d) < 1e-12);
            if (p.tier !== 'tier-2') assert.deepEqual(p, c.planes[i]);
        });
        assert.throws(() => editTier(c, 1, { teethOffset: .5 }, {}, 96), /整数齿/);
        assert.equal(validateComponent(JSON.parse(JSON.stringify(next))).recipe.version, 2);
    }
    assert.throws(() => editTier(generatePreset({ family: 'step' }), 1, { teethOffset: 3 }, {}, 96), /腰口/);
    const once = editTier(generatePreset({ family: 'step' }), 1, { teethOffset: 1 }, {}, 96);
    assert.throws(() => editTier(once, 1, { teethOffset: 2 }, {}, 96), /相邻关系/);
    assert.throws(() => editTier(generatePreset({ family: 'step' }), 1, { teethOffset: 1 }, { scale: [2, 1, 1] }, 96), /改变切角/);
    assert.throws(() => editTier(generatePreset({ family: 'step', params: { aspect: 2 } }), 1, { teethOffset: 1 }, {}, 96), /圆形/);
});

test('width rhythm produces distinct closed faces and stable roundtrip; old recipes stay v1', () => {
    const c = generatePreset({ family: 'step' });
    const variants = ['outer','inner'].map(r => creativeEdit(c, { tierWidths: rhythmWidths(3,r) }, {},96));
    assert.equal(c.recipe.version, 1);
    assert.ok(!planesEquivalent(variants[0].planes, variants[1].planes));
    for (const v of variants) {
        assert.equal(componentPreview(v).length, c.planes.length + 1);
        assert.ok(planesEquivalent(validateComponent(v).planes, v.planes));
    }
    assert.throws(() => creativeEdit(c, { tierWidths: [0,1,1] }, {},96));
    assert.throws(() => creativeEdit(c, { tierWidths: [NaN] }, {},96));
    assert.throws(() => creativeEdit(c, { tierWidths: [1,1,1] }, {scale:[1.3,1,1]},96), /分度/);
    const unknown = structuredClone(variants[0]); unknown.recipe.version = 999;
    assert.equal(validateComponent(unknown).recipe, undefined);
});

test('creative edits and a continuous drag undo atomically, and discard protection remains active', () => {
    const s=createStudioStore();
    try {
        const before=s.api.getState(), history=s.getState().session.historySize;
        s.previewCreative({table:.5}); s.previewCreative({table:.48}); s.endParamDrag();
        assert.equal(s.getState().session.historySize,history+1);
        s.selectGroup('initial-pavilion'); assert.ok(s.getState().overlay.discard); s.cancelDiscard();
        s.undo(); assert.deepEqual(s.api.getState(),before);
        s.redo(); assert.equal(s.api.getState().draft.recipe.params.table,.48);
    } finally { s.destroy(); }
});

test('comparison is non-destructive until choosing; rejects stale selections and preserves undo', async () => {
    const s=createStudioStore();
    try {
        s.start(); await waitPreview(s);
        const before=s.api.getState(), history=s.getState().session.historySize;
        await s.openComparison('variation');
        assert.equal(s.getState().overlay.dialog.choices.filter(c=>!c.reason).length,4);
        s.closeDialog(); assert.deepEqual(s.api.getState(),before); assert.equal(s.getState().session.historySize,history);
        await s.openComparison('variation'); s.acceptComparison(1); s.closeDialog();
        assert.equal(s.hasPendingDraft(),true); s.undo(); assert.deepEqual(s.api.getState(),before);
        await s.openComparison('variation'); s.changeCreative({table:.5});
        assert.throws(()=>s.acceptComparison(1),/已变化/);
    } finally { s.destroy(); }
});

test('pairing applies and pins current half, previews only opposite group, and preserves geometry in native transfer', async () => {
    const s=createStudioStore();
    try {
        s.start(); await waitPreview(s); s.changeCreative({table:.5}); await waitPreview(s);
        await s.openComparison('pair');
        const pinned=s.api.getState(), choices=s.getState().overlay.dialog.choices;
        assert.equal(pinned.groups.length,2);
        assert.ok(choices.every(c=>!c.reason));
        s.acceptComparison(1); s.closeDialog();
        const selected=s.api.getState();
        assert.equal(selected.draft.part,'pavilion'); assert.equal(selected.editId,'initial-pavilion');
        assert.deepEqual(selected.groups,pinned.groups);
        assert.equal(s.hasPendingDraft(),true);
        s.undo(); assert.deepEqual(s.api.getState(),pinned); s.redo(); await waitPreview(s);
        assert.equal(await s.apply(),true); await waitPreview(s);
        assert.equal(s.api.getState().groups.length,2);
        const doc=s.candidateDocument(), imported=importNativeDocument(doc);
        assert.equal(imported.groups.length,2);
        const crown=imported.groups.find(g=>g.component.part==='crown');
        assert.ok(planesEquivalent(crown.component.planes,pinned.draft.planes));
    } finally { s.destroy(); }
});

test('tier recipe survives native export/import and legacy bridge cannot batch pair', async () => {
    const s=createStudioStore();
    try {
        const c=editTier(generatePreset({family:'step'}),1,{teethOffset:1},{},96);
        const model=s.api.getState();
        const doc=makeNativeDocument(model.stock,null,[{id:'tier-crown',component:c,transform:model.transform}],[],{teeth:96});
        const imported=importNativeDocument(doc);
        assert.equal(imported.groups[0].component.recipe.version,2);
        assert.ok(planesEquivalent(imported.groups[0].component.planes,c.planes));
    } finally { s.destroy(); }
    const legacy=createStudioStore({onApply:()=>{throw Error('unexpected apply');}});
    try { await assert.rejects(()=>legacy.openComparison('pair'),/逐组提交桥/); } finally {legacy.destroy();}
});
