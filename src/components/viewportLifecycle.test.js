import test from "node:test";
import assert from "node:assert/strict";
import { createViewportLifecycle } from "./viewportLifecycle.js";

function setup({ failCreation = false } = {}) {
  const instances = [], released = [], events = [], timers = new Map();
  let timerId = 0;
  // Camera and scene stand in for GemViewport's refs: shared by every p5 instance.
  const camera = { yaw: 0.62, pitch: -0.42, zoom: 1.8 };
  let scene = { geometry: { id: "original" }, draft: { depth: 0.1 }, assistantPosition: 3 };
  const createCanvas = () => {
    const listeners = new Map();
    return {
      listeners,
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: (name, callback) => { assert.equal(listeners.get(name), callback); listeners.delete(name); },
    };
  };
  const lifecycle = createViewportLifecycle({
    createInstance() {
      if (failCreation) throw new Error("WebGL unavailable");
      const instance = { canvas: createCanvas(), draws: [], redraw() { this.draws.push({ scene, camera }); } };
      instances.push(instance);
      return instance;
    },
    releaseInstance: (instance, { contextLost }) => released.push({ instance, contextLost }),
    onLost: () => events.push("lost"),
    onRestore: () => events.push("restored"),
    onError: () => events.push("failed"),
    setTimer(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimer(id) { timers.delete(id); },
  });
  return { lifecycle, instances, released, events, timers, camera,
    allowCreation() { failCreation = false; },
    changeScene(next) { scene = next; },
    // p5 runs setup asynchronously: it reports the canvas, then draws once.
    finishSetup() {
      const instance = instances.at(-1);
      lifecycle.attach(instance.canvas);
      instance.redraw();
      return instance;
    },
    lose(canvas) {
      let prevented = false;
      canvas.listeners.get("webglcontextlost")({ preventDefault() { prevented = true; } });
      assert.equal(prevented, true, "the lost context must stay restorable");
    },
  };
}

test("lost edit context pauses drawing; restore rebuilds p5 and draws the latest scene with the same camera", () => {
  const harness = setup(), { lifecycle, camera } = harness;
  const original = harness.finishSetup();
  assert.equal(lifecycle.instance, original);
  harness.lose(original.canvas);
  assert.equal(lifecycle.instance, null, "no draws reach a lost context");
  assert.deepEqual(harness.events, ["lost"]);
  // Orbiting and editing continue in the refs while the context is lost.
  camera.yaw = 1.1;
  const latest = { geometry: { id: "latest" }, draft: { depth: 0.24 }, assistantPosition: 4 };
  harness.changeScene(latest);
  original.canvas.listeners.get("webglcontextrestored")();
  assert.equal(harness.timers.size, 0, "a restore cancels the fallback");
  assert.deepEqual(harness.released, [{ instance: original, contextLost: true }]);
  assert.equal(original.canvas.listeners.size, 0);
  assert.equal(harness.instances.length, 2);
  assert.equal(lifecycle.instance, null, "the replacement draws only once its setup has finished");
  const replacement = harness.finishSetup();
  assert.deepEqual(harness.events, ["lost", "restored"]);
  assert.equal(lifecycle.instance, replacement);
  assert.equal(replacement.draws[0].scene, latest);
  assert.equal(replacement.draws[0].camera, camera);
  assert.deepEqual(camera, { yaw: 1.1, pitch: -0.42, zoom: 1.8 }, "the camera is not reset");
  assert.equal(original.draws.length, 1);
  lifecycle.destroy();
  assert.deepEqual(harness.released.at(-1), { instance: replacement, contextLost: false });
  assert.equal(replacement.canvas.listeners.size, 0);
});

test("failed asynchronous replacement setup releases partial p5 and can be retried with the current design", () => {
  const harness = setup();
  const original = harness.finishSetup();
  harness.lose(original.canvas);
  const [{ callback }] = harness.timers.values();
  callback();
  const failed = harness.instances.at(-1);
  // p5's asynchronous setup could not create a WebGL canvas, so attach never runs.
  harness.lifecycle.fail();
  assert.equal(harness.lifecycle.instance, null);
  assert.equal(harness.timers.size, 0, "failure waits for explicit retry, without a GPU allocation loop");
  assert.deepEqual(harness.released.at(-1), { instance: failed, contextLost: true });
  assert.equal(harness.events.at(-1), "failed");
  const latest = { geometry: { id: "retained" }, draft: { depth: 0.32 }, assistantPosition: 5 };
  harness.changeScene(latest);
  harness.lifecycle.retry();
  assert.equal(harness.events.at(-1), "lost");
  const replacement = harness.finishSetup();
  assert.equal(harness.events.at(-1), "restored");
  assert.equal(replacement.draws[0].scene, latest);
  assert.equal(replacement.draws[0].camera, harness.camera);
  harness.lifecycle.destroy();
  const count = harness.instances.length;
  harness.lifecycle.retry();
  harness.lifecycle.fail();
  assert.equal(harness.instances.length, count, "unmounted viewport cannot restart");
  assert.equal(harness.events.at(-1), "restored");
});

test("initial creation failure and repeated failed retries stay recoverable", () => {
  const harness = setup({ failCreation: true });
  assert.equal(harness.lifecycle.instance, null);
  assert.deepEqual(harness.events, ["failed"]);
  harness.lifecycle.retry();
  assert.deepEqual(harness.events, ["failed", "lost", "failed"]);
  assert.equal(harness.timers.size, 0);
  harness.allowCreation();
  harness.lifecycle.retry();
  const replacement = harness.finishSetup();
  assert.equal(harness.lifecycle.instance, replacement);
  assert.equal(harness.events.at(-1), "restored");
  harness.lifecycle.destroy();
});

test("a context the browser never restores is replaced after the fallback delay", () => {
  const harness = setup();
  const original = harness.finishSetup();
  harness.lose(original.canvas);
  assert.equal(harness.timers.size, 1);
  const [{ callback, delay }] = harness.timers.values();
  assert.equal(delay, 3000);
  callback();
  assert.deepEqual(harness.released, [{ instance: original, contextLost: true }]);
  assert.equal(original.canvas.listeners.size, 0, "a late restore of the old canvas is ignored");
  const replacement = harness.finishSetup();
  assert.equal(harness.lifecycle.instance, replacement);
  assert.deepEqual(harness.events, ["lost", "restored"]);
  // The replacement is watched too: a second loss pauses it again.
  harness.lose(replacement.canvas);
  assert.equal(harness.lifecycle.instance, null);
  harness.lifecycle.destroy();
  assert.equal(harness.timers.size, 0);
});

test("normal unmount or unmount during context loss releases the instance, listeners and fallback", () => {
  for (const loseBeforeUnmount of [false, true]) {
    const harness = setup();
    const original = harness.finishSetup();
    if (loseBeforeUnmount) harness.lose(original.canvas);
    harness.lifecycle.destroy();
    assert.deepEqual(harness.released, [{ instance: original, contextLost: loseBeforeUnmount }]);
    assert.equal(original.canvas.listeners.size, 0);
    assert.equal(harness.timers.size, 0);
    assert.equal(harness.lifecycle.instance, null);
    // A p5 setup finishing after unmount is not watched or reported.
    harness.lifecycle.attach(original.canvas);
    assert.equal(original.canvas.listeners.size, 0);
    assert.equal(harness.events.includes("restored"), false);
  }
});
