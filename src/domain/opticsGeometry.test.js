import test from "node:test";
import assert from "node:assert/strict";
import { createCenteredCube } from "./geometry.js";
import { normalizedOpticsPlanes, packOpticsPlaneTexture } from "./opticsGeometry.js";

function prism(sides) {
  const vertices = [];
  for (const z of [-1, 1]) {
    for (let index = 0; index < sides; index += 1) {
      const angle = index * 2 * Math.PI / sides;
      vertices.push([Math.cos(angle), Math.sin(angle), z]);
    }
  }
  const faces = Array.from({ length: sides }, (_, index) => {
    const next = (index + 1) % sides;
    const angle = (index + 0.5) * 2 * Math.PI / sides;
    return { normal: [Math.cos(angle), Math.sin(angle), 0], vertexIndices: [index, next, sides + next, sides + index] };
  });
  faces.push({ normal: [0, 0, -1], vertexIndices: Array.from({ length: sides }, (_, index) => sides - 1 - index) });
  faces.push({ normal: [0, 0, 1], vertexIndices: Array.from({ length: sides }, (_, index) => sides + index) });
  return { vertices, faces };
}

test("optics retains all 258 prism boundaries regardless of face traversal order", () => {
  const solid = prism(256);
  const normalized = normalizedOpticsPlanes(solid);
  assert.equal(normalized.faceCount, 258);
  assert.equal(normalized.planes.length, 258);
  assert.deepEqual(normalizedOpticsPlanes({ ...solid, faces: [...solid.faces].reverse() }), normalized);
  assert.ok(normalized.planes.some((plane) => plane[2] === 1 && plane[3] === 1));
  assert.ok(normalized.planes.some((plane) => plane[2] === -1 && plane[3] === 1));
  for (const plane of normalized.planes.filter((plane) => plane[2] === 0)) {
    assert.ok(Math.abs(plane[3] - Math.cos(Math.PI / 256)) < 1e-12);
  }
  const texture = packOpticsPlaneTexture(normalized.planes, 32);
  assert.equal(texture.width, 32);
  assert.equal(texture.height, 9);
  normalized.planes.forEach((plane, index) => {
    const texelOffset = (Math.floor(index / texture.width) * texture.width + index % texture.width) * 4;
    assert.deepEqual(Array.from(texture.data.slice(texelOffset, texelOffset + 4)), plane.map(Math.fround));
  });
});

test("normalization preserves outward half-spaces for translated and scaled geometry", () => {
  const centered = normalizedOpticsPlanes(createCenteredCube());
  const translated = createCenteredCube(8, { center: { x: 20, y: -10, z: 4 } });
  translated.faces.forEach((face) => {
    face.normal = Object.fromEntries(Object.entries(face.normal).map(([axis, value]) => [axis, value * 3]));
  });
  assert.deepEqual(normalizedOpticsPlanes(translated), centered);
});

test("nearby real planes are not discarded by six-decimal deduplication", () => {
  const solid = createCenteredCube();
  solid.vertices.push({ x: 1 - 1e-7, y: 0, z: 0 });
  solid.faces.push({ normal: [1, 0, 0], vertexIndices: [8, 8, 8] });
  const planes = normalizedOpticsPlanes(solid).planes;
  assert.equal(planes.length, 7);
  assert.equal(planes.filter((plane) => plane[0] === 1).length, 2);
});

test("texture capacity rejects an incomplete upload and supports an empty solid", () => {
  assert.throws(() => packOpticsPlaneTexture(Array.from({ length: 257 }, () => [1, 0, 0, 1]), 16), /无法完整显示/);
  assert.deepEqual(packOpticsPlaneTexture([], 16), { width: 1, height: 1, data: new Float32Array(4) });
});

test("mesh optical reset fits tall crystals and leaves the inspector footprint clear", async () => {
  const { normalizedOpticsMesh, opticsMeshFraming } = await import("./opticsGeometry.js");
  const solid = createCenteredCube();
  const mesh = normalizedOpticsMesh({ ...solid, kind: "mesh" });
  for (const [width, height, occludedRight] of [[1567, 964, 324], [960, 700, 324], [480, 800, 0]]) {
    const frame = opticsMeshFraming(mesh, { width, height, occludedRight });
    const radiusPx = mesh.radius / Math.sqrt(4.4 ** 2 - mesh.radius ** 2) / frame.cameraScale * height / 2;
    const centerX = (width - frame.focusOffset * height) / 2;
    assert.ok(centerX - radiusPx > 24);
    assert.ok(centerX + radiusPx < width - occludedRight - 24);
    assert.ok(height / 2 - radiusPx > 64);
    assert.ok(height / 2 + radiusPx < height - 64);
  }
});
