import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuOpticsScheduler } from './opticsWebgpuScheduler.js';
function setup() {
  let callback, finish, reject;
  const draws = [], errors = [];
  const scheduler = createWebgpuOpticsScheduler({
    render: options => { draws.push(options); return new Promise((yes, no) => { finish = yes; reject = no; }); },
    onError: error => errors.push(error),
    requestFrame: fn => { assert.equal(callback, undefined); callback = fn; return 1; },
    cancelFrame: () => { callback = undefined; },
  });
  return { scheduler, draws, errors, pending: () => Boolean(callback),
    step() { const fn = callback; callback = undefined; return fn?.(); },
    finish: () => finish(), fail: () => reject(new Error('device lost')) };
}
const options = yaw => ({ geometry: {}, settings: { quality: 1 }, camera: { yaw } });
test('one submission in flight; input coalesces with no idle redraw or polling', async () => {
  const h = setup(); h.scheduler.draw(options(1)); const first = h.step();
  for (let yaw = 2; yaw <= 100; yaw++) h.scheduler.draw(options(yaw));
  assert.equal(h.pending(), false); assert.equal(h.draws.length, 1);
  h.finish(); await first; assert.equal(h.pending(), true);
  const second = h.step(); assert.equal(h.draws[1].camera.yaw, 100);
  h.finish(); await second; assert.equal(h.pending(), false); h.scheduler.destroy();
});
test('snapshot camera and stop pending work on unmount during a submission', async () => {
  const h = setup(), input = options(2); h.scheduler.draw(input); input.camera.yaw = 9;
  const first = h.step(); assert.equal(h.draws[0].camera.yaw, 2);
  h.scheduler.draw(options(3)); h.scheduler.destroy(); h.finish(); await first;
  assert.equal(h.pending(), false); assert.equal(h.draws.length, 1);
});
test('rejected submission fails once; unmounted rejection is ignored', async () => {
  for (const unmount of [false, true]) {
    const h = setup(); h.scheduler.draw(options(1)); const first = h.step();
    h.scheduler.draw(options(2)); if (unmount) h.scheduler.destroy();
    h.fail(); await first; h.scheduler.draw(options(3));
    assert.equal(h.errors.length, unmount ? 0 : 1); assert.equal(h.pending(), false);
  }
});
