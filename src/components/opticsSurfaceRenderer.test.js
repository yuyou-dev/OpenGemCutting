import test from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createSurfaceAccumulation, SURFACE_TARGET_SAMPLES } from './opticsSurfaceRenderer.js';
import { surfaceFragmentShader, LAB_RANDOM_SOURCE, LAB_BSDF_SOURCE, ENVIRONMENT_PANELS } from './opticsSurfaceShader.js';
import { FRAGMENT_SHADER } from './opticsWebglRenderer.js';
import { traceShader } from '../../vendor/pattern-lab/0.6.0-rc.3.main.b88db469903c/source/src/render/shaders.js';

function harness() {
  const uniforms = [], deleted = [], drawBuffers = [];
  let next = 0;
  const gl = new Proxy({
    FRAMEBUFFER_COMPLETE: 1,
    getExtension: () => true,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    checkFramebufferStatus: () => 1,
    getUniformLocation: (_, name) => name,
    uniform1i: (name, value) => uniforms.push([name, value]),
    drawBuffers: value => drawBuffers.push(value),
  }, { get(object, name) {
    if (name in object) return object[name];
    if (name.startsWith('create')) return () => ++next;
    if (name.startsWith('delete')) return value => deleted.push([name, value]);
    return name.toUpperCase() === name ? name : () => {};
  } });
  const canvas = { dataset: {} };
  const last = name => uniforms.filter(([key]) => key === name).at(-1)?.[1];
  return { gl, canvas, uniforms, deleted, drawBuffers, last };
}

const options = { geometry: { framing: 'convex', planes: [[0, 0, 1, 1]], materials: [[.3, 0, 1, 0]] },
  camera: { yaw: .6 }, settings: { view: { exposure: 0 } } };

test('surface accumulation grows measured batches, stops at the target and never samples ahead of motion', () => {
  const h = harness();
  const renderer = createSurfaceAccumulation(h.gl, {}, h.canvas);
  let batches = 0;
  while (renderer.begin(100, 80, options)) {
    assert.equal(h.last('uAccumulatedSamples'), Number(h.canvas.dataset.samples ?? 0));
    const more = renderer.end();
    batches += 1;
    if (more) renderer.completed(8); // completed within one frame: grow
  }
  assert.equal(h.canvas.dataset.samples, String(SURFACE_TARGET_SAMPLES));
  assert.ok(batches < SURFACE_TARGET_SAMPLES / 2, 'fast batches carry several samples');
  assert.equal(renderer.batchSamples, 16);
  // The camera-ray guide is written once per view, then left in place.
  assert.deepEqual(h.drawBuffers[0], ['COLOR_ATTACHMENT0', 'COLOR_ATTACHMENT1']);
  assert.ok(h.drawBuffers.slice(1).every(([, guide]) => guide === 'NONE'));
  assert.equal(h.last('uPlaneMode'), 1);
  assert.equal(h.last('uConvex'), 1);

  assert.equal(renderer.begin(100, 80, { ...options, camera: { yaw: .7 }, interactive: true }), true);
  assert.equal(h.last('uAccumulatedSamples'), 0, 'a new camera restarts accumulation');
  assert.equal(h.last('uBatchSamples'), 1, 'motion shows one sample per frame');
  assert.equal(renderer.end(), false, 'interactive motion never starts autonomous sampling');

  renderer.begin(100, 80, { ...options, camera: { yaw: .7 } });
  renderer.end();
  renderer.completed(80); // a slow batch shrinks proportionally
  assert.equal(renderer.batchSamples, 4);
  for (const changed of [{ ...options, geometry: { ...options.geometry } }, { ...options, settings: { view: { exposure: 1 } } }]) {
    renderer.begin(100, 80, changed);
    assert.equal(h.last('uAccumulatedSamples'), 0);
    renderer.end();
  }
  renderer.begin(90, 70, options);
  assert.equal(h.last('uAccumulatedSamples'), 0, 'a new size restarts accumulation');
});

test('surface accumulation releases every texture, framebuffer, program and uniform block', () => {
  const h = harness();
  const renderer = createSurfaceAccumulation(h.gl, {}, h.canvas);
  renderer.begin(100, 80, options);
  renderer.end();
  renderer.destroy();
  const count = kind => h.deleted.filter(([name]) => name === kind).length;
  assert.equal(count('deleteTexture'), 5);
  assert.equal(count('deleteFramebuffer'), 4);
  assert.equal(count('deleteProgram'), 2);
  assert.equal(count('deleteBuffer'), 1);
});

test('missing float capability reports a real failure before allocating accumulation targets', () => {
  const h = harness();
  h.gl.getExtension = () => false;
  assert.throws(() => createSurfaceAccumulation(h.gl, {}, h.canvas), /全抛光/);
});

test('host adapter consumes the fixed laboratory GGX, VNDF and random dimensions verbatim', async () => {
  const lock = JSON.parse(await readFile(new URL('../application/labsModuleLock.json', import.meta.url)));
  const adapter = await readFile(new URL('./opticsSurfaceShader.js', import.meta.url), 'utf8');
  assert.ok(adapter.includes('../../' + lock.directory + '/source/src/render/shaders.js'), 'module updates must also review and update the host BSDF source reference');
  for (const [source, start] of [[LAB_BSDF_SOURCE, 'float fresnel('], [LAB_RANDOM_SOURCE, 'uint mixbits(']]) {
    assert.ok(source.startsWith(start) && source.length > 200);
    assert.ok(traceShader.includes(source));
    assert.ok(surfaceFragmentShader.includes(source));
  }
  for (const name of ['evalBSDF(', 'visibleNormal(', 'powerHeuristic(']) assert.ok(surfaceFragmentShader.includes(name));
  assert.ok(surfaceFragmentShader.includes('materialSlot = index;'));
  assert.ok(surfaceFragmentShader.includes('layout(location = 1) out vec4 outGuide;'));
});

test('environment sampling uses the same light panels as the host environment radiance', () => {
  const panels = [...FRAGMENT_SHADER.matchAll(/pow\(max\(0\.0, dot\(direction, normalize\(vec3\(([^)]+)\)\)\)\), ([\d.]+)\)/g)]
    .map(([, axis, power]) => ({ axis: axis.split(',').map(Number), power: Number(power) }))
    .filter(({ power }) => power > 10); // dark cards are broad and subtract light
  assert.deepEqual(panels, ENVIRONMENT_PANELS.map(({ axis, power }) => ({ axis, power })));
  const picks = ENVIRONMENT_PANELS.reduce((sum, { pick }) => sum + pick, 0);
  assert.ok(picks > 0 && picks < 1, 'a uniform term keeps every direction sampleable');
});
