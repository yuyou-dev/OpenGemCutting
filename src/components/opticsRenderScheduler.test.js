import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpticsRenderScheduler } from './opticsRenderScheduler.js';
function setup() {
  let callback, status = 1, fences = 0;
  const draws = [], errors = [], deleted = [];
  const gl = {
    TIMEOUT_EXPIRED: 0, WAIT_FAILED: 2, SYNC_GPU_COMMANDS_COMPLETE: 3,
    clientWaitSync(_fence, flags, timeout) { assert.equal(flags, 0); assert.equal(timeout, 0); return status; },
    fenceSync() { return ++fences; }, flush() {}, deleteSync(fence) { deleted.push(fence); },
  };
  const scheduler = createOpticsRenderScheduler({ gl, render: options => draws.push(options), onError: error => errors.push(error),
    requestFrame: fn => { assert.equal(callback, undefined); callback = fn; return 1; }, cancelFrame: () => { callback = undefined; },
  });
  return { scheduler, draws, errors, deleted, busy: () => { status = 0; }, ready: () => { status = 1; }, fail: () => { status = 2; },
    step() { const fn = callback; callback = undefined; fn?.(); }, pending: () => Boolean(callback),
  };
}
const options = yaw => ({ camera: { yaw }, settings: { advanced: { maxBounces: 8 } }, geometry: {} });
test('busy GPU accepts no additional draws; latest camera replaces intermediate input', () => {
  const h = setup(); h.scheduler.draw(options(1)); h.step(); h.busy();
  for (let yaw = 2; yaw <= 100; yaw++) { h.scheduler.draw(options(yaw)); h.step(); }
  assert.equal(h.draws.length, 1);
  h.ready(); h.step(); assert.equal(h.draws.length, 2); assert.equal(h.draws[1].camera.yaw, 100);
  assert.equal(h.draws[1].settings.advanced.maxBounces, 8);
  assert.equal(h.pending(), false); h.scheduler.destroy();
});
test('a settled update renders once at unchanged quality without idle refinement or polling', () => {
  const h = setup(), input = options(1);
  h.scheduler.draw(input); h.step();
  assert.equal(h.draws.length, 1); assert.equal(h.pending(), false);
  assert.deepEqual(h.draws[0], input);
  h.step(); assert.equal(h.draws.length, 1);
});
test('camera snapshots coalesce before a frame; unmount releases the fence and pending callback', () => {
  const h = setup(), input = options(2);
  h.scheduler.draw(input); input.camera.yaw = 99; h.step();
  assert.equal(h.draws[0].camera.yaw, 2);
  h.scheduler.draw(options(3)); h.scheduler.draw(options(4)); h.step();
  assert.equal(h.draws.at(-1).camera.yaw, 4);
  h.scheduler.draw(options(5)); h.scheduler.destroy();
  assert.equal(h.pending(), false); assert.equal(h.deleted.length, 2);
  h.scheduler.draw(options(6)); assert.equal(h.pending(), false);
});
test('failed GPU wait reports an error and stops submissions', () => {
  const h = setup(); h.scheduler.draw(options(1)); h.step(); h.fail(); h.scheduler.draw(options(2)); h.step();
  assert.equal(h.draws.length, 1); assert.equal(h.errors.length, 1); assert.equal(h.pending(), false);
  h.scheduler.destroy();
});
