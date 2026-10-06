import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebglOpticsRenderer } from './opticsWebglRenderer.js';
import { resolveOpticsSettings } from '../domain/optics.js';

test('optical loading ends after drawing, not shader initialization, and stays covered on upload failure', t => {
  const globals = ['window', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const saved = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  t.after(() => globals.forEach((key, index) => {
    if (saved[index]) Object.defineProperty(globalThis, key, saved[index]);
    else delete globalThis[key];
  }));
  for (const uploadFails of [false, true]) {
    let frame, submitted = 0, presented = 0;
    const errors = [];
    globalThis.window = { devicePixelRatio: 1 };
    globalThis.requestAnimationFrame = callback => { frame = callback; return 1; };
    globalThis.cancelAnimationFrame = () => { frame = null; };
    const gl = new Proxy({
      getShaderParameter: () => true, getProgramParameter: () => true,
      getParameter: () => 4096, getError: () => uploadFails ? 'UPLOAD_FAILED' : 'NO_ERROR',
      drawArrays: () => submitted++,
    }, { get(object, name) {
      if (name in object) return object[name];
      if (name.startsWith('create')) return () => ({});
      return name.toUpperCase() === name ? name : () => {};
    } });
    const canvas = { dataset: {}, width: 300, height: 150, clientWidth: 800, clientHeight: 600, getContext: () => gl };
    const renderer = createWebglOpticsRenderer(canvas, error => { if (error) errors.push(error); });
    assert.equal(presented, 0);
    renderer.draw({ geometry: { planes: [[0, 0, 1, 1]] }, settings: resolveOpticsSettings(),
      camera: { yaw: .6, pitch: -.4, zoom: 1, panX: 0, panY: 0 }, onFrame: () => presented++ });
    assert.equal(presented, 0, 'a queued draw cannot uncover the canvas');
    frame();
    assert.equal(presented, uploadFails ? 0 : 1);
    assert.equal(submitted, uploadFails ? 0 : 1);
    assert.equal(errors.length, uploadFails ? 1 : 0);
    assert.equal(canvas.width / canvas.height, 800 / 600);
    renderer.destroy();
  }
});
