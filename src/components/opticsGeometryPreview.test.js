import test from 'node:test';
import assert from 'node:assert/strict';
import { drawOpticsGeometryPreview } from './opticsGeometryPreview.js';
import { resolveOpticsSettings } from '../domain/optics.js';

test('interaction preview uses optical camera projection and updates geometry without a GPU context', t => {
  const previous = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  t.after(() => { if (previous) globalThis.window = previous; else delete globalThis.window; });
  const points = [], context = { fillRect() {}, beginPath() {}, closePath() {}, fill() {}, stroke() {},
    moveTo: (x, y) => points.push([x, y]), lineTo: (x, y) => points.push([x, y]) };
  const canvas = { clientWidth: 200, clientHeight: 200, getContext(type) { assert.equal(type, '2d'); return context; } };
  const polyhedron = { faces: [{ vertexIndices: [0, 1, 2] }] };
  const geometry = { vertices: [[0, 0, 0], [.5, 0, 0], [0, .5, 0]] };
  const options = { geometry, settings: resolveOpticsSettings(), camera: { yaw: 0, elevation: Math.PI / 2, zoom: 1, panX: 0, panY: 0 }, compact: true };
  drawOpticsGeometryPreview(canvas, polyhedron, options);
  assert.deepEqual(points[0], [100, 100]);
  assert.ok(points[1][0] > 100); assert.ok(points[2][1] < 100);
  geometry.vertices[1] = [1, 0, 0];
  drawOpticsGeometryPreview(canvas, polyhedron, options);
  assert.ok(points[4][0] > points[1][0]);
});
