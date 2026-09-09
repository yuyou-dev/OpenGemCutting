import test from "node:test";
import assert from "node:assert/strict";
import { createOpticsRendererLifecycle } from "./opticsRendererLifecycle.js";

function setup() {
  const listeners = new Map(), resources = [], errors = [];
  const canvas = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => { assert.equal(listeners.get(name), callback); listeners.delete(name); },
  };
  let current = { geometry: { id: "original" }, camera: { zoom: 1.7 }, settings: { ior: 1.77 } };
  const lifecycle = createOpticsRendererLifecycle(canvas, {
    createRenderer() {
      const resource = { draws: [], destroyed: 0, draw(options) { this.draws.push(options); }, destroy() { this.destroyed++; } };
      resources.push(resource);
      return resource;
    },
    onError: message => errors.push(message),
    onRestore: () => lifecycle.draw(current),
  });
  return { lifecycle, listeners, resources, errors, current,
    changeOptions(options) { current = options; },
    lose() { let prevented = false; listeners.get("webglcontextlost")({ preventDefault() { prevented = true; } }); assert.equal(prevented, true); },
  };
}

test("lost optical context stops drawing; restore uses latest geometry/settings and preserves camera identity", () => {
  const harness = setup(), { lifecycle, resources, listeners, current } = harness;
  lifecycle.draw(current);
  harness.lose();
  lifecycle.draw(current);
  assert.equal(resources[0].draws.length, 1);
  assert.equal(resources[0].destroyed, 1);
  assert.match(harness.errors[0], /恢复后将自动重绘/);
  const latest = { ...current, geometry: { id: "latest" }, settings: { ior: 1.5 } };
  harness.changeOptions(latest);
  listeners.get("webglcontextrestored")();
  assert.equal(resources.length, 2);
  assert.equal(resources[1].draws[0], latest);
  assert.equal(resources[1].draws[0].camera, current.camera);
  lifecycle.destroy();
  assert.equal(resources[1].destroyed, 1, "cleanup destroys the restored renderer");
  assert.equal(resources[0].destroyed, 1, "the original renderer is not destroyed twice");
  assert.equal(listeners.size, 0);
});

test("normal unmount or unmount during context loss releases resources and listeners", () => {
  for (const loseBeforeUnmount of [false, true]) {
    const harness = setup();
    if (loseBeforeUnmount) harness.lose();
    harness.lifecycle.destroy();
    assert.equal(harness.resources[0].destroyed, 1);
    assert.equal(harness.listeners.size, 0);
    harness.lifecycle.draw(harness.current);
    assert.equal(harness.resources[0].draws.length, 0);
  }
});
