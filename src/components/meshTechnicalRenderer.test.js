import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createCenteredCube } from "../domain/geometry.js";
import { getTechnicalViewBasis } from "../domain/technicalPreview.js";
import { getMeshPreviewBuffers, fillMeshPreviewColors } from "../domain/meshPreviewBuffers.js";

const source = (await readFile(new URL("./meshTechnicalRenderer.js", import.meta.url), "utf8"))
  .replace(/^import[^\n]+\n/gm, "")
  .replace("export function renderTechnicalMesh", "function renderTechnicalMesh");

function rendererHarness({ failSecondProgram = false } = {}) {
  const handles = { Program: new Set(), Shader: new Set(), Buffer: new Set(), VertexArray: new Set() };
  let sequence = 0, programCount = 0, currentError = 0, failUpload = false;
  const calls = { uploads: 0, copies: 0, draws: 0, errorChecks: 0 };
  const implementation = {
    NO_ERROR: 0, OUT_OF_MEMORY: 1285,
    createProgram() { const id = ++sequence; programCount++; handles.Program.add(id); return id; },
    getShaderParameter: () => !(failSecondProgram && programCount === 2),
    getProgramParameter: () => true,
    getShaderInfoLog: () => "injected line shader compilation failure",
    getAttribLocation: () => 0, getUniformLocation: () => 0, isContextLost: () => false,
    bufferData() { calls.uploads++; if (failUpload) currentError = 1285; },
    getError() { calls.errorChecks++; const error = currentError; currentError = 0; return error; },
    drawArrays() { calls.draws++; },
  };
  for (const [type, set] of Object.entries(handles)) {
    implementation[`create${type}`] ??= () => { const id = ++sequence; set.add(id); return id; };
    implementation[`delete${type}`] = id => set.delete(id);
  }
  const gl = new Proxy(implementation, { get(object, key) {
    return object[key] ?? (key === key.toUpperCase() ? 0 : () => {});
  } });
  const canvas = { width: 320, height: 240, getContext: () => gl, addEventListener() {} };
  const target = { width: 320, height: 240, clientWidth: 320,
    getContext: () => ({ drawImage() { calls.copies++; } }) };
  const render = vm.runInNewContext(`${source}\nrenderTechnicalMesh;`, {
    document: { createElement: () => canvas }, getTechnicalViewBasis, getMeshPreviewBuffers, fillMeshPreviewColors,
  });
  return { render: (solid, colors) => render(target, solid, "top", colors), calls, handles,
    failUploads(value) { failUpload = value; } };
}

const mesh = () => ({ ...createCenteredCube(), kind: "mesh" });

test("failed GPU upload never caches or copies stale geometry, and a later draw retries all buffers", () => {
  const harness = rendererHarness(), original = mesh(), replacement = mesh();
  assert.equal(harness.render(original), true);
  assert.equal(harness.calls.uploads, 3);
  assert.equal(harness.calls.copies, 1);
  harness.failUploads(true);
  assert.equal(harness.render(replacement), false);
  assert.equal(harness.calls.uploads, 6);
  assert.equal(harness.calls.copies, 1);
  assert.equal(harness.calls.draws, 2);
  harness.failUploads(false);
  assert.equal(harness.render(replacement), true);
  assert.equal(harness.calls.uploads, 9);
  assert.equal(harness.calls.copies, 2);
  const checks = harness.calls.errorChecks;
  assert.equal(harness.render(replacement), true);
  assert.equal(harness.calls.uploads, 9);
  assert.equal(harness.calls.errorChecks, checks, "cached views need no extra synchronous GPU error query");
});

test("a failed color-only upload also invalidates the cached solid before retry", () => {
  const harness = rendererHarness(), solid = mesh();
  assert.equal(harness.render(solid), true);
  harness.failUploads(true);
  assert.equal(harness.render(solid, { activeOperationId: "selected" }), false);
  assert.equal(harness.calls.uploads, 4);
  harness.failUploads(false);
  assert.equal(harness.render(solid, { activeOperationId: "selected" }), true);
  assert.equal(harness.calls.uploads, 7);
});

test("line shader initialization failure releases both programs and every created shader", () => {
  const harness = rendererHarness({ failSecondProgram: true });
  assert.throws(() => harness.render(mesh()), /injected line shader compilation failure/);
  for (const [type, handles] of Object.entries(harness.handles)) assert.equal(handles.size, 0, type);
  assert.equal(harness.calls.copies, 0);
});
