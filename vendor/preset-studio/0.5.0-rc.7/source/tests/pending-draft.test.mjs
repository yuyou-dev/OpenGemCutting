import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioStore } from '../src/application/studioStore.js';
import { builtinEntries } from '../src/application/viewModels.js';

const pavilion = builtinEntries().find(e => e.part === 'pavilion').id;

test('dirty draft switches are deferred; cancel preserves model and undo history', () => {
    const s = createStudioStore();
    try {
        assert.equal(s.hasPendingDraft(), false);
        s.changeParam('angle', 36);
        const before = s.api.getState(), history = s.getState().session.historySize;
        s.selectGroup('initial-pavilion');
        assert.ok(s.getState().overlay.discard);
        assert.deepEqual(s.api.getState(), before);
        s.cancelDiscard();
        assert.equal(s.getState().session.historySize, history);
        assert.deepEqual(s.api.getState(), before);
        s.selectGroup('initial-pavilion'); s.confirmDiscard();
        assert.equal(s.api.getState().editId, 'initial-pavilion');
        assert.equal(s.hasPendingDraft(), false);
        s.undo(); assert.deepEqual(s.api.getState(), before);
    } finally { s.destroy(); }
});

test('preset callback only closes library after confirmation; current group never reloads', () => {
    const s = createStudioStore(); let selected = 0;
    try {
        s.selectGroup('initial-pavilion');
        s.onTransform({translation:[0,0,-.1]});
        s.selectGroup('initial-pavilion');
        assert.equal(s.getState().overlay.discard, null);
        assert.equal(s.api.getState().transform.translation[2], -.1);
        s.selectPreset(pavilion, () => selected++);
        assert.equal(selected, 0); s.cancelDiscard(); assert.equal(selected, 0);
        s.selectPreset(pavilion, () => selected++); s.confirmDiscard();
        assert.equal(selected, 1); assert.equal(s.hasPendingDraft(), true);
        const before = s.api.getState();
        s.setGenerator('step'); assert.deepEqual(s.api.getState(), before);
        s.cancelDiscard();
    } finally { s.destroy(); }
});

test('undo to the original draft clears pending state; successful apply clears it too', async () => {
    const s = createStudioStore();
    try {
        s.changeParam('angle', 36); s.undo(); assert.equal(s.hasPendingDraft(), false);
        s.start(); s.changeParam('angle', 36);
        await new Promise((resolve,reject) => {
            const timer = setTimeout(()=>{stop();reject(Error('preview timeout'));},2000);
            const stop=s.subscribe(()=>{if(s.api.getPreview()?.valid){clearTimeout(timer);stop();resolve();}});
        });
        assert.equal(await s.apply(), true);
        assert.equal(s.hasPendingDraft(), false);
        s.selectGroup('initial-pavilion'); assert.equal(s.getState().overlay.discard, null);
    } finally { s.destroy(); }
});
