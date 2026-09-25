import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgressiveOpticsRenderer, SAMPLING_STAGES } from './opticsProgressiveRenderer.js';
test('motion renders fewer pixels, only the latest camera refines, and optics stay unchanged', () => {
  let timer, destroyed = false;
  const draws = [], renderer = createProgressiveOpticsRenderer({ draw: value => draws.push(value), destroy: () => { destroyed = true; } },
    { setTimer: fn => { timer = fn; return 1; }, clearTimer: () => { timer = null; } });
  const step = () => { const fn = timer; timer = null; fn?.(); };
  const settings = { maxBounces: 8, ior: 1.54 }, geometry = {};
  const input = { camera: { yaw: 1 }, settings, geometry, interactive: true };
  renderer.draw(input); input.camera.yaw = 2;
  assert.equal(draws[0].camera.yaw, 1); assert.equal(draws[0].renderScale, .45);
  renderer.draw({ ...input, camera: { yaw: 3 } }); step(); step();
  assert.deepEqual(draws.map(d => d.renderScale), [.45, .45, .7, 1]);
  assert.equal(draws.at(-1).camera.yaw, 3);
  assert.ok(draws.every(d => d.settings === settings && d.geometry === geometry));
  assert.equal(timer, null);
  renderer.draw(input); renderer.destroy(); step();
  assert.equal(destroyed, true); assert.equal(draws.at(-1).renderScale, .45);
});
test('a sampling backend refines straight to full resolution, never restarting at an intermediate scale', () => {
  let timer;
  const draws = [], renderer = createProgressiveOpticsRenderer({ draw: value => draws.push(value), destroy() {} },
    { setTimer: fn => { timer = fn; return 1; }, clearTimer: () => { timer = null; }, stages: SAMPLING_STAGES });
  const input = { camera: { yaw: 1 }, settings: {}, geometry: {}, interactive: true };
  renderer.draw(input);
  renderer.draw({ ...input, interactive: false });
  assert.deepEqual(draws.map(d => [d.renderScale, d.interactive]), [[.5, true], [1, false]]);
  assert.equal(timer, null);
  renderer.draw(input); timer();
  assert.deepEqual(draws.slice(2).map(d => d.renderScale), [.5, 1]);
  renderer.destroy();
});
