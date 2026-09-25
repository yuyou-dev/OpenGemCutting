import test from 'node:test';
import assert from 'node:assert/strict';
import { drawConcaveTools, releaseConcaveToolMeshes } from './concaveToolRenderer.js';
import { createRoundCutter } from '../domain/mesh/boolean.js';
import { expandConcaveCuts } from '../domain/concaveCuts.js';

test('tool ghosts batch all repeated surfaces into one draw and release replaced GPU buffers', () => {
  const tools = expandConcaveCuts([{ id: 'ghost', type: 'sphere', repeat: 5, position: [1, 0, 0] }]).map(createRoundCutter);
  let draws = 0, builds = 0;
  const live = new Set(), masks = [], offsets = [];
  let offsetEnabled = false;
  class Geometry {
    constructor() { this.vertices = []; this.faces = []; this.vertexColors = []; builds++; live.add(this); }
    computeNormals() {}
  }
  const p = { constructor: { Geometry }, createVector: (...p) => p,
    freeGeometry: mesh => live.delete(mesh), model: () => { draws++; assert.equal(offsetEnabled, true); assert.deepEqual(offsets.at(-1), [-1, -1]); assert.equal(masks.at(-1), false); },
    drawingContext: {
      DEPTH_WRITEMASK: 'mask', POLYGON_OFFSET_FACTOR: 'factor', POLYGON_OFFSET_UNITS: 'units', POLYGON_OFFSET_FILL: 'offset',
      getParameter: key => ({mask: true, factor: 2, units: 3})[key],
      isEnabled: () => offsetEnabled,
      enable: () => { offsetEnabled = true; }, disable: () => { offsetEnabled = false; },
      polygonOffset: (...values) => offsets.push(values), depthMask: value => masks.push(value)
    }, push() {}, pop() {}, fill() {}, noStroke() {} };
  const transform = (point, scale) => point.map(v => v * scale);
  drawConcaveTools(p, tools, 1, transform);
  const mesh = [...live][0];
  assert.equal(draws, 1);
  assert.equal(offsetEnabled, false);
  assert.deepEqual(offsets.at(-1), [2, 3]);
  assert.equal(mesh.faces.length, tools.reduce((sum, tool) => sum + tool.geometry.polygons.reduce((n, poly) => n + poly.vertices.length - 2, 0), 0));
  assert.equal(mesh.vertexColors.length, mesh.vertices.length * 4);
  drawConcaveTools(p, tools, 1, transform);
  assert.equal(builds, 1, 'camera redraw reuses the uploaded mesh');
  drawConcaveTools(p, tools, 2, transform);
  assert.equal(builds, 2); assert.equal(live.size, 1); assert.ok(!live.has(mesh));
  drawConcaveTools(p, [...tools], 2, transform);
  assert.equal(builds, 3); assert.equal(live.size, 1);
  drawConcaveTools(p, [], 2, transform);
  assert.equal(live.size, 0);
  drawConcaveTools(p, tools, 2, transform);
  releaseConcaveToolMeshes(p);
  assert.equal(live.size, 0); assert.equal(masks.at(-1), true);
});
