import assert from "node:assert/strict";
import test from "node:test";
import { advanceViewportCamera, createViewportFrames } from "./viewportFrames.js";

function frameQueue(draw) {
  const queued = new Map();
  let id = 0;
  const frames = createViewportFrames({
    draw,
    requestFrame(callback) { queued.set(++id, callback); return id; },
    cancelFrame(key) { queued.delete(key); },
  });
  return {
    frames,
    queued,
    flush() {
      const [key, callback] = queued.entries().next().value;
      queued.delete(key);
      return callback();
    },
  };
}

test("viewport merges rapid updates and performs no work after a static frame", async () => {
  let draws = 0;
  const queue = frameQueue(() => { draws++; return false; });
  for (let index = 0; index < 100; index++) queue.frames.invalidate();
  assert.equal(queue.queued.size, 1);
  await queue.flush();
  assert.equal(draws, 1);
  assert.equal(queue.queued.size, 0);
  queue.frames.invalidate();
  await queue.flush();
  assert.equal(draws, 2);
});

test("viewport retains updates during asynchronous p5 drawing without overlapping draws", async () => {
  let finish;
  let draws = 0;
  const queue = frameQueue(() => {
    draws++;
    return new Promise((resolve) => { finish = resolve; });
  });
  queue.frames.invalidate();
  const first = queue.flush();
  queue.frames.invalidate();
  queue.frames.invalidate();
  assert.equal(queue.queued.size, 0);
  finish(false);
  await first;
  assert.equal(queue.queued.size, 1);
  const second = queue.flush();
  assert.equal(draws, 2);
  finish(false);
  await second;
  assert.equal(queue.queued.size, 0);
});

test("viewport suspends pending work, restores the latest scene and stops after disposal", async () => {
  let draws = 0;
  const queue = frameQueue(() => { draws++; return true; });
  queue.frames.invalidate();
  queue.frames.setSuspended(true);
  assert.equal(queue.queued.size, 0);
  queue.frames.invalidate();
  assert.equal(queue.queued.size, 0);
  queue.frames.setSuspended(false);
  assert.equal(queue.queued.size, 1);
  await queue.flush();
  assert.equal(draws, 1);
  assert.equal(queue.queued.size, 1);
  queue.frames.dispose();
  assert.equal(queue.queued.size, 0);
  queue.frames.invalidate();
  queue.frames.setSuspended(false);
  assert.equal(queue.queued.size, 0);
});

test("viewport camera keeps the existing easing then settles exactly and wakes for a new target", async () => {
  const camera = {
    yaw: 0, targetYaw: 1, pitch: 0, targetPitch: -0.5,
    zoom: 1, targetZoom: 2, panX: 0, targetPanX: 100, panY: 8, targetPanY: -100,
  };
  let draws = 0;
  const queue = frameQueue(() => { draws++; return advanceViewportCamera(camera); });
  queue.frames.invalidate();
  await queue.flush();
  assert.equal(camera.yaw, 0.16);
  assert.equal(camera.panX, 18);
  while (queue.queued.size && draws < 200) await queue.flush();
  assert.ok(draws < 100);
  for (const key of ["yaw", "pitch", "zoom", "panX", "panY"]) {
    assert.equal(camera[key], camera[`target${key[0].toUpperCase()}${key.slice(1)}`]);
  }
  camera.targetYaw = 2;
  queue.frames.invalidate();
  await queue.flush();
  assert.ok(camera.yaw > 1 && camera.yaw < 2);
  assert.equal(queue.queued.size, 1);
  queue.frames.dispose();
});

test("cutting camera keeps each cut oblique and the gem upright with shortest rotation", async () => {
  const { cuttingCameraPose } = await import("./viewportFrames.js");
  for (const region of ["crown", "pavilion", "girdle"]) for (let i = 0; i < 96; i++) {
    const a = i * Math.PI / 48;
    const n = {x: Math.cos(a) * .7, y: Math.sin(a) * .7, z: region === "pavilion" ? -.7 : region === "crown" ? .7 : 0};
    const pose = cuttingCameraPose({region, plane:{normal:n}}, 12);
    const depth = Math.sin(pose.pitch) * -n.z + Math.cos(pose.pitch) * (-Math.sin(pose.yaw)*n.x + Math.cos(pose.yaw)*n.y);
    assert.ok(depth > 0);
    const lateral = Math.cos(pose.yaw) * n.x + Math.sin(pose.yaw) * n.y;
    assert.ok(Math.abs(lateral) > .49, "cut must remain visibly oblique");
    assert.equal(pose.pitch, region === "pavilion" ? -Math.PI / 36 : -Math.PI / 12);
    assert.ok(Math.abs(pose.yaw - 12) <= Math.PI);
  }
});

test("cutting transition honors elapsed time, reaches its exact target and supports reduced motion", async () => {
  const { startCameraTransition } = await import("./viewportFrames.js");
  const camera = {yaw:0,pitch:0,zoom:1,targetZoom:1,panX:0,targetPanX:0,panY:0,targetPanY:0};
  let completions = 0;
  startCameraTransition(camera,{yaw:1,pitch:-1},600,100, () => completions++);
  assert.equal(advanceViewportCamera(camera,400),true);
  assert.equal(camera.yaw,.5);
  assert.equal(completions, 0);
  assert.equal(advanceViewportCamera(camera,700),false);
  assert.equal(camera.yaw,1); assert.equal(camera.pitch,-1);
  advanceViewportCamera(camera,750);
  assert.equal(completions, 1);
  startCameraTransition(camera,{yaw:2,pitch:1},0,800);
  assert.equal(advanceViewportCamera(camera,800),false);
  assert.equal(camera.yaw,2);
});
