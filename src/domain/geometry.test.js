import assert from "node:assert/strict";
import test from "node:test";

import {
  clipByPlanes,
  clipPolyhedron,
  createCenteredCube,
  faceArea,
  faceCentroid,
  measurePolyhedron,
  polyhedronCentroid,
  polyhedronSurfaceArea,
  polyhedronVolume,
} from "./geometry.js";

const EPSILON = 1e-9;

function approximately(actual, expected, tolerance = EPSILON) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function approximatelyVector(actual, expected, tolerance = EPSILON) {
  approximately(actual.x, expected.x, tolerance);
  approximately(actual.y, expected.y, tolerance);
  approximately(actual.z, expected.z, tolerance);
}

function assertUniqueVertices(polyhedron, tolerance = 1e-8) {
  for (let a = 0; a < polyhedron.vertices.length; a += 1) {
    for (let b = a + 1; b < polyhedron.vertices.length; b += 1) {
      const first = polyhedron.vertices[a];
      const second = polyhedron.vertices[b];
      const separation = Math.hypot(
        first.x - second.x,
        first.y - second.y,
        first.z - second.z,
      );
      assert.ok(separation > tolerance, `vertices ${a} and ${b} were not deduplicated`);
    }
  }
}

test("centered cube has outward faces and exact base measurements", () => {
  const cube = createCenteredCube(2);

  assert.equal(cube.vertices.length, 8);
  assert.equal(cube.faces.length, 6);
  assert.equal(new Set(cube.faces.map((face) => face.id)).size, 6);
  for (const face of cube.faces) {
    assert.equal(face.vertexIndices.length, 4);
    approximately(faceArea(cube, face), 4);
    approximately(Math.hypot(face.normal.x, face.normal.y, face.normal.z), 1);
  }

  approximately(polyhedronVolume(cube), 8);
  approximately(polyhedronSurfaceArea(cube), 24);
  approximatelyVector(polyhedronCentroid(cube), { x: 0, y: 0, z: 0 });
  approximatelyVector(faceCentroid(cube, "cube:+z"), { x: 0, y: 0, z: 1 });
});

test("axis-aligned clipping creates an outward cap with operation metadata", () => {
  const cube = createCenteredCube();
  const clipped = clipPolyhedron(cube, {
    normal: [2, 0, 0],
    offset: 0,
    id: "operation-17",
    faceId: "facet-17",
    region: "crown",
    keep: "less-than-or-equal",
  });

  assert.equal(clipped.vertices.length, 8);
  assert.equal(clipped.faces.length, 6);
  assert.equal(clipped.faces.some((face) => face.id === "cube:+x"), false);
  approximately(polyhedronVolume(clipped), 4);
  approximatelyVector(polyhedronCentroid(clipped), { x: -0.5, y: 0, z: 0 });

  const cap = clipped.faces.find((face) => face.id === "facet-17");
  assert.ok(cap);
  assert.equal(cap.sourceOperationId, "operation-17");
  assert.equal(cap.region, "crown");
  approximatelyVector(cap.normal, { x: 1, y: 0, z: 0 });
  approximately(faceArea(clipped, cap), 4);
  approximatelyVector(faceCentroid(clipped, cap), { x: 0, y: 0, z: 0 });
  assertUniqueVertices(clipped);

  // Geometry operations are immutable, so undo history can retain the stock.
  assert.equal(cube.vertices.length, 8);
  assert.equal(cube.faces.some((face) => face.id === "cube:+x"), true);
});

test("oblique clipping accepts d and builds a single coplanar convex cap", () => {
  const clipped = clipPolyhedron(createCenteredCube(), {
    normal: { x: 1, y: 1, z: 1 },
    d: 0,
  });

  approximately(polyhedronVolume(clipped), 4);
  assert.equal(clipped.vertices.length, 10);
  assert.equal(clipped.faces.length, 7);

  const cap = clipped.faces.find((face) => face.id.startsWith("cut-"));
  assert.ok(cap);
  assert.equal(cap.vertexIndices.length, 6);
  approximately(faceArea(clipped, cap), 3 * Math.sqrt(3));
  approximatelyVector(cap.normal, {
    x: 1 / Math.sqrt(3),
    y: 1 / Math.sqrt(3),
    z: 1 / Math.sqrt(3),
  });
  for (const index of cap.vertexIndices) {
    const point = clipped.vertices[index];
    approximately(point.x + point.y + point.z, 0);
  }
  assertUniqueVertices(clipped);
});

test("planes are applied sequentially and retain stable face records", () => {
  const octant = clipByPlanes(createCenteredCube(), [
    { normal: [1, 0, 0], constant: 0, operationId: "x" },
    { normal: [0, 1, 0], offset: 0, operationId: "y" },
    { normal: [0, 0, 1], d: 0, operationId: "z" },
  ]);

  assert.equal(octant.vertices.length, 8);
  assert.equal(octant.faces.length, 6);
  approximately(polyhedronVolume(octant), 1);
  approximatelyVector(polyhedronCentroid(octant), { x: -0.5, y: -0.5, z: -0.5 });
  assert.deepEqual(
    new Set(octant.faces.map((face) => face.sourceOperationId).filter(Boolean)),
    new Set(["x", "y", "z"]),
  );
  assertUniqueVertices(octant);
});

test("tolerance makes near-coincident cuts safe and avoids duplicate faces", () => {
  const cube = createCenteredCube();
  const noOp = clipPolyhedron(
    cube,
    { normal: [1, 0, 0], offset: 1 + 1e-10 },
    { tolerance: 1e-8 },
  );

  assert.deepEqual(noOp, cube);
  assert.notEqual(noOp, cube);
  assert.notEqual(noOp.vertices, cube.vertices);

  const half = clipPolyhedron(cube, { normal: [1, 0, 0], offset: 0 });
  const repeated = clipPolyhedron(
    half,
    { normal: [1, 0, 0], offset: -1e-12 },
    { tolerance: 1e-8 },
  );
  assert.equal(repeated.vertices.length, half.vertices.length);
  assert.equal(repeated.faces.length, half.faces.length);
  approximately(polyhedronVolume(repeated), 4);
  assertUniqueVertices(repeated);
});

test("fully rejected and translated solids have well-defined measurements", () => {
  const empty = clipPolyhedron(createCenteredCube(), {
    normal: [1, 0, 0],
    offset: -2,
  });
  assert.deepEqual(empty.vertices, []);
  assert.deepEqual(empty.faces, []);
  assert.equal(polyhedronVolume(empty), 0);
  approximatelyVector(polyhedronCentroid(empty), { x: 0, y: 0, z: 0 });

  const translated = createCenteredCube({ size: 4, center: [10, -3, 7] });
  const measurements = measurePolyhedron(translated);
  approximately(measurements.volume, 64);
  approximately(measurements.surfaceArea, 96);
  approximatelyVector(measurements.centroid, { x: 10, y: -3, z: 7 });
  assert.equal(measurements.faces.length, 6);
  assert.ok(measurements.faces.every((face) => Math.abs(face.area - 16) <= EPSILON));
});

test("invalid half-spaces fail clearly", () => {
  const cube = createCenteredCube();
  assert.throws(
    () => clipPolyhedron(cube, { normal: [0, 0, 0], offset: 0 }),
    /non-zero/,
  );
  assert.throws(
    () => clipPolyhedron(cube, { normal: [1, 0, 0], offset: Number.NaN }),
    /finite/,
  );
  assert.throws(
    () => clipPolyhedron(cube, { normal: [1, 0, 0], offset: 0, keep: "greater" }),
    /only the <= half-space/,
  );
});
