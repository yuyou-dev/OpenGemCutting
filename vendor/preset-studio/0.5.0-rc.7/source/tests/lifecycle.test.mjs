import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioStore } from '../src/application/studioStore.js';
import { cameraFromPose, poseFromCamera, advanceViewportCamera } from '../src/viewport/navigation.js';
import { SolidViewport } from '../src/viewport/viewport.js';

function previewReady(store) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { unsubscribe(); reject(new Error('Preview did not recover')); }, 2000);
        const unsubscribe = store.subscribe(() => {
            if (store.api.getPreview()?.valid) { clearTimeout(timer); unsubscribe(); resolve(); }
        });
    });
}

test('effect cleanup and restart restores preview without resetting draft or history', async () => {
    const store = createStudioStore();
    try {
        let ready = previewReady(store); store.start(); await ready;
        store.onTransform({ translation: [0, 0, .08] });
        const before = store.api.getState();
        store.destroy();
        ready = previewReady(store); store.start(); await ready;
        assert.equal(store.unlocked(), true);
        assert.deepEqual(store.api.getState(), before);
        const version = store.getVersion(); store.start();
        assert.equal(store.getVersion(), version, 'a repeated start does not launch another preview');
        store.undo();
        assert.equal(store.api.getState().transform.translation[2], .045);
    } finally { store.destroy(); }
});

test('main canvas orbit and pan only change camera; cancellation restores its origin', () => {
    const view = { callbacks: {}, overlay: { focus(){}, setPointerCapture(){} }, yaw: -55, elevation: 28, pan: [0, 0], zoom: 1, draw(){ while(advanceViewportCamera(this.camera)) {} Object.assign(this, poseFromCamera(this.camera)); } };
    view.camera = cameraFromPose(view);
    const event = { preventDefault(){}, clientX: 100, clientY: 100, pointerId: 1, button: 0 };
    SolidViewport.prototype.down.call(view, event);
    SolidViewport.prototype.move.call(view, { clientX: 120, clientY: 110 });
    assert.ok(view.yaw < -55); assert.ok(view.elevation > 28);
    SolidViewport.prototype.cancelDrag.call(view);
    assert.ok(Math.abs(view.yaw + 55) < 1e-9); assert.ok(Math.abs(view.elevation - 28) < 1e-9);
    SolidViewport.prototype.down.call(view, { ...event, shiftKey: true });
    SolidViewport.prototype.move.call(view, { clientX: 115, clientY: 125 });
    assert.deepEqual(view.pan, [15, 25]);
    SolidViewport.prototype.up.call(view);
    assert.equal(view.drag, null); assert.equal(view.transform, undefined);
});
