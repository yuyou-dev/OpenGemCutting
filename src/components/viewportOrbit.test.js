import test from 'node:test';
import assert from 'node:assert/strict';
import { editorOrbitAfterInput, opticsOrbitAfterInput, opticsCameraFrame } from './viewportOrbit.js';

// Independently project a front-facing marker through p5's Rx(pitch) Ry(yaw).
function editorMarker({ yaw, pitch }) {
  return [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
}
function editorScreen([x, y, z], { yaw, pitch }) {
  const depth = -Math.sin(yaw) * x + Math.cos(yaw) * z;
  return [Math.cos(yaw) * x + Math.sin(yaw) * z, Math.cos(pitch) * y - Math.sin(pitch) * depth];
}
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
function opticsScreen(point, orbit) {
  const frame = opticsCameraFrame(orbit);
  const relative = point.map((value, i) => value - frame.position[i]);
  const depth = dot(relative, frame.forward);
  return [dot(relative, frame.right) / depth, -dot(relative, frame.up) / depth];
}

for (const yaw of [0, -0.72, Math.PI / 2, Math.PI]) {
  test(`editor front marker follows four screen directions at yaw ${yaw}`, () => {
    for (const pitch of [-1.4, -0.52, 0, 0.52, 1.4]) {
      const orbit = Object.freeze({ yaw, pitch });
      for (const [h, v, axis, sign] of [[0.01, 0, 0, 1], [-0.01, 0, 0, -1], [0, 0.01, 1, 1], [0, -0.01, 1, -1]]) {
        const marker = editorMarker(orbit);
        const before = editorScreen(marker, orbit);
        const after = editorScreen(marker, editorOrbitAfterInput(orbit, h, v));
        assert.ok((after[axis] - before[axis]) * sign > 0);
      }
    }
  });
  test(`optics front marker follows four screen directions, within the shared cutting limits, at yaw ${yaw}`, () => {
    for (const elevation of [-1.4, -0.42, 0, 0.42, 1.4]) {
      const orbit = Object.freeze({ yaw, elevation });
      const marker = opticsCameraFrame(orbit).position.map(value => value / 4.4);
      for (const [h, v, axis, sign] of [[0.01, 0, 0, 1], [-0.01, 0, 0, -1], [0, 0.01, 1, 1], [0, -0.01, 1, -1]]) {
        const before = opticsScreen(marker, orbit);
        const after = opticsScreen(marker, opticsOrbitAfterInput(orbit, h, v));
        assert.ok((after[axis] - before[axis]) * sign > 0);
      }
    }
  });
}

test('editor exact axial view stays put on outward drag and departs smoothly on inward drag', () => {
  for (const sign of [-1, 1]) {
    const pitch = sign * Math.PI / 2;
    assert.equal(editorOrbitAfterInput({ yaw: 0, pitch }, 0, -sign * 0.001).pitch, pitch);
    assert.ok(Math.abs(editorOrbitAfterInput({ yaw: 0, pitch }, 0, sign * 0.001).pitch - pitch) < 0.002);
  }
});

test('optics uses the cutting view pole limits without mutating its input', () => {
  for (const sign of [-1, 1]) {
    const orbit = Object.freeze({ yaw: .6, elevation: sign * (Math.PI / 2 - .01) });
    const next = opticsOrbitAfterInput(orbit, 0, sign * .02);
    assert.equal(next.yaw, orbit.yaw);
    assert.equal(next.elevation, sign * Math.PI / 2);
    const inward = opticsOrbitAfterInput(next, 0, -sign * .01);
    assert.ok(Math.abs(inward.elevation) < Math.PI / 2);
  }
});

test('optical pan converts CSS pixels independently of DPR, zoom and viewport width', async () => {
 const { opticsCameraFromViewport } = await import('./viewportOrbit.js');
 const { createViewportCamera, dragViewport, advanceViewportCamera } = await import('./viewportNavigation.js');
 for (const height of [360,720,1000]) {
  const camera=createViewportCamera({panY:0,zoom:1.7});dragViewport(camera,24,12,true);
  while(advanceViewportCamera(camera)) {}
  const optical=opticsCameraFromViewport(camera,height);
  assert.equal(optical.panX*height/2,24);assert.equal(-optical.panY*height/2,12);
  assert.equal(optical.zoom,1.7);
 }
});

test('shared navigation comes from the locked laboratory module', async () => {
  const { readFile } = await import('node:fs/promises');
  const lock = JSON.parse(await readFile(new URL('../application/labsModuleLock.json', import.meta.url)));
  const source = await readFile(new URL('./viewportNavigation.js', import.meta.url), 'utf8');
  assert.ok(source.includes(`../../${lock.directory}/navigation.js`), 'module updates must also move the navigation reference');
});
