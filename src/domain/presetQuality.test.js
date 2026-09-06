import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inspectGemCadAsc } from "./gemcadAsc.js";
import { createCenteredCube } from "./geometry.js";
import { inspectPresetPolyhedron, inspectPresetSolid } from "./presetQuality.js";

function cutCube(size = 1) {
  const solid = createCenteredCube(size);
  solid.faces.forEach((face, index) => { face.id = `cut-${index}`; face.sourceOperationId = `tier-${index}`; });
  return solid;
}
function cubeDocument(size = 1) {
  return {
    stock: { size: 2, center: [0, 0, 0] },
    facets: cutCube(size).faces.map((face) => ({
      id: face.id, patternId: face.sourceOperationId, region: "crown",
      plane: { normal: face.normal, offset: size / 2 },
    })),
  };
}
const codes = (result) => result.issues.map((issue) => issue.code);

test("accepts the real Astryx ASC solid and counts only final faces", async () => {
  const source = await readFile(new URL("./fixtures/astryx-star.asc", import.meta.url), "utf8");
  const { document } = inspectGemCadAsc(source);
  const result = inspectPresetSolid(document);
  assert.deepEqual(result.issues, []);
  assert.equal(result.facetCount, 57);
  assert.equal(result.metrics.eulerCharacteristic, 2);
  assert.ok(result.fingerprint);
});

test("accepts a small positive-volume solid without an arbitrary volume cutoff", () => {
  const result = inspectPresetSolid(cubeDocument(0.01));
  assert.deepEqual(result.issues, []);
  assert.ok(result.metrics.volume > 0 && result.metrics.volume < 0.01);
});

test("fingerprint ignores tier order, metadata, redundant and covered cuts", () => {
  const document = cubeDocument();
  const expected = inspectPresetSolid(document);
  const changed = {
    ...document, name: "Another name",
    facets: [
      { ...document.facets[0], id: "covered", patternId: "covered", plane: { ...document.facets[0].plane, offset: 0.75 } },
      ...document.facets.toReversed(),
      { ...document.facets[0], id: "redundant", patternId: "redundant" },
    ],
  };
  const result = inspectPresetSolid(changed);
  assert.deepEqual(result.issues, []);
  assert.equal(result.fingerprint, expected.fingerprint);
  assert.equal(result.facetCount, 6);
  assert.equal(result.tierCount, 6);
  assert.notEqual(inspectPresetSolid(cubeDocument(0.9)).fingerprint, expected.fingerprint);
});

test("splits a legitimate T junction before manifold and Euler checks", () => {
  const solid = cutCube();
  const face = solid.faces[0];
  const a = solid.vertices[face.vertexIndices[0]];
  const b = solid.vertices[face.vertexIndices[1]];
  solid.vertices.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
  face.vertexIndices.splice(1, 0, solid.vertices.length - 1);
  assert.deepEqual(inspectPresetPolyhedron(solid).issues, []);
});

test("rejects actual holes and duplicate faces", () => {
  const hole = cutCube();
  hole.faces.pop();
  assert.ok(codes(inspectPresetPolyhedron(hole)).includes("NON_MANIFOLD_EDGES"));
  assert.ok(codes(inspectPresetPolyhedron(hole)).includes("EULER_MISMATCH"));
  const duplicate = cutCube();
  duplicate.faces.push(structuredClone(duplicate.faces[0]));
  assert.ok(codes(inspectPresetPolyhedron(duplicate)).includes("NON_MANIFOLD_EDGES"));
});

test("rejects nonplanar, reversed, degenerate and nonfinite mesh data", () => {
  const warped = cutCube();
  warped.vertices[0].x += 0.1;
  assert.ok(codes(inspectPresetPolyhedron(warped)).includes("NON_PLANAR_FACE"));
  const reversed = cutCube();
  reversed.faces[0].vertexIndices.reverse();
  assert.ok(codes(inspectPresetPolyhedron(reversed)).includes("NON_MANIFOLD_EDGES"));
  const degenerate = cutCube();
  degenerate.faces[0].vertexIndices = [0, 0, 1];
  assert.ok(codes(inspectPresetPolyhedron(degenerate)).includes("DEGENERATE_FACE"));
  const nonfinite = cutCube();
  nonfinite.vertices[0].x = NaN;
  assert.deepEqual(codes(inspectPresetPolyhedron(nonfinite)), ["NONFINITE_GEOMETRY"]);
});

test("rejects an empty solid and retained rough faces without inventing cut facets", () => {
  const document = cubeDocument();
  document.facets[0].plane.offset = -2;
  const empty = inspectPresetSolid(document);
  assert.deepEqual(codes(empty), ["EMPTY_SOLID"]);
  assert.equal(empty.facetCount, 0);
  assert.equal(empty.fingerprint, null);
  const rough = inspectPresetSolid({ ...cubeDocument(), facets: [] });
  assert.ok(codes(rough).includes("ROUGH_STOCK_REMAINS"));
  assert.equal(rough.facetCount, 0);
});

test("fingerprint normalizes equivalent plane equations and preserves direction", () => {
  const document = cubeDocument();
  document.facets[2].plane.offset = 0.4;
  const fingerprint = inspectPresetSolid(document).fingerprint;
  const scaled = structuredClone(document);
  for (const facet of scaled.facets) {
    facet.plane.normal = Object.fromEntries(Object.entries(facet.plane.normal).map(([axis, value]) => [axis, value * 3]));
    facet.plane.offset *= 3;
  }
  assert.equal(inspectPresetSolid(scaled).fingerprint, fingerprint);
  const rotated = structuredClone(document);
  for (const facet of rotated.facets) {
    const { x, y, z } = facet.plane.normal;
    facet.plane.normal = { x: -y, y: x, z };
  }
  assert.notEqual(inspectPresetSolid(rotated).fingerprint, fingerprint);
});

test("numerical topology repair does not accept an actual open seam", () => {
  const solid = cutCube();
  const face = solid.faces[0];
  const original = solid.vertices[face.vertexIndices[0]];
  solid.vertices.push({ ...original, x: original.x + 0.001 });
  face.vertexIndices[0] = solid.vertices.length - 1;
  assert.ok(codes(inspectPresetPolyhedron(solid)).includes("NON_MANIFOLD_EDGES"));
});
