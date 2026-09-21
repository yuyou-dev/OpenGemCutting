import test from 'node:test';
import assert from 'node:assert/strict';
import { createAsyncOpticsRenderer } from './opticsAsyncRenderer.js';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const resource = () => ({ draws: [], destroyed: 0, draw(value) { this.draws.push(value); }, destroy() { this.destroyed++; } });

test('initialization replays only latest geometry, settings and camera snapshot', async () => {
  const pending = deferred(), instance = resource();
  const lifecycle = createAsyncOpticsRenderer({ createRenderer: () => pending.promise, onFallback: () => assert.fail() });
  lifecycle.draw({ geometry: {}, camera: { yaw: 0 } });
  const input = { geometry: {}, settings: { ior: 1.7 }, camera: { yaw: 3 } };
  lifecycle.draw(input); input.camera.yaw = 9;
  pending.resolve(instance); await lifecycle.ready;
  assert.equal(instance.draws.length, 1);
  assert.equal(instance.draws[0].geometry, input.geometry);
  assert.equal(instance.draws[0].settings, input.settings);
  assert.equal(instance.draws[0].camera.yaw, 3);
  lifecycle.destroy(); assert.equal(instance.destroyed, 1);
});
test('initialization failure falls back once; unmount suppresses late failures', async () => {
  for (const unmount of [false, true]) {
    const pending = deferred(); let fallbacks = 0;
    const lifecycle = createAsyncOpticsRenderer({ createRenderer: () => pending.promise, onFallback: () => fallbacks++ });
    await Promise.resolve();
    if (unmount) lifecycle.destroy();
    pending.reject(new Error('adapter unavailable')); await lifecycle.ready;
    assert.equal(fallbacks, unmount ? 0 : 1);
  }
});
test('unmount during initialization disposes the late device without drawing', async () => {
  const pending = deferred(), instance = resource();
  const lifecycle = createAsyncOpticsRenderer({ createRenderer: () => pending.promise, onFallback: () => assert.fail() });
  await Promise.resolve(); lifecycle.draw({ camera: {} }); lifecycle.destroy();
  pending.resolve(instance); await lifecycle.ready;
  assert.equal(instance.destroyed, 1); assert.equal(instance.draws.length, 0);
});
test('device loss and validation errors dispose once and cannot submit stale frames', async () => {
  let fail, fallbacks = 0; const instance = resource();
  const lifecycle = createAsyncOpticsRenderer({ createRenderer: callback => { fail = callback; return instance; }, onFallback: () => fallbacks++ });
  await lifecycle.ready; fail(); fail(); lifecycle.draw({ camera: {} }); lifecycle.destroy();
  assert.equal(fallbacks, 1); assert.equal(instance.destroyed, 1); assert.equal(instance.draws.length, 0);
});
test('failure before initialization resolves releases the returned instance', async () => {
  const instance = resource(); let fallbacks = 0;
  const lifecycle = createAsyncOpticsRenderer({ createRenderer: fail => { fail(); return instance; }, onFallback: () => fallbacks++ });
  await lifecycle.ready; assert.equal(fallbacks, 1); assert.equal(instance.destroyed, 1);
});
