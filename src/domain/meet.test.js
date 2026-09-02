import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_STOCK,
  facetNormal,
  facetToClippingPlane,
  resolveFacetPattern,
  rotationalStockSupportOffset,
} from "./faceting.js";
import { clipPolyhedronByPlanes, createCenteredCube } from "./geometry.js";
import {
  angleForVertexTarget,
  collectSolidVertices,
  depthForEdge,
  depthForVertex,
} from "./meet.js";

const EPSILON = 1e-9;
const STOCK = DEFAULT_STOCK;

function approximately(actual, expected, tolerance = EPSILON) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function buildReferenceSolid() {
  const table = resolveFacetPattern(
    { patternId: "t1", region: "crown", industryAngleDeg: 0, baseIndex: 0, repeat: 1, mirror: 0, depth: 0.2 },
    { stock: STOCK },
  );
  const pavilionMains = resolveFacetPattern(
    { patternId: "p8", region: "pavilion", industryAngleDeg: 41, baseIndex: 0, repeat: 8, mirror: 0, depth: 0.42 },
    { stock: STOCK },
  );
  const solid = clipPolyhedronByPlanes(
    createCenteredCube(2),
    [...table, ...pavilionMains].map((facet) => facet.plane),
  );
  return { solid, pavilionMains };
}

function capVertexTowardAzimuth(vertices, plane) {
  const radial = Math.hypot(plane.normal.x, plane.normal.y);
  return vertices
    .filter((vertex) => Math.abs(dot(plane.normal, vertex) - plane.offset) < EPSILON)
    .map((vertex) => ({
      vertex,
      perpendicular: Math.abs(vertex.x * plane.normal.y - vertex.y * plane.normal.x) / radial,
      radius: Math.hypot(vertex.x, vertex.y),
    }))
    .sort((a, b) => a.perpendicular - b.perpendicular || b.radius - a.radius)[0].vertex;
}

const REFERENCE = buildReferenceSolid();

test("collectSolidVertices deduplicates vertices within 1e-9", () => {
  const solid = {
    vertices: [
      { x: 0, y: 0, z: 0 },
      { x: 5e-10, y: 0, z: 0 },
      { x: 0, y: 0, z: -4e-10 },
      { x: 2e-9, y: 0, z: 0 },
    ],
    faces: [],
  };
  const unique = collectSolidVertices(solid);
  assert.equal(unique.length, 2);
  assert.deepEqual(unique[0], { x: 0, y: 0, z: 0 });
  assert.deepEqual(unique[1], { x: 2e-9, y: 0, z: 0 });
});

test("collectSolidVertices preserves the clipped solid's already-unique vertices", () => {
  const unique = collectSolidVertices(REFERENCE.solid);
  assert.equal(unique.length, REFERENCE.solid.vertices.length);
  for (let a = 0; a < unique.length; a += 1) {
    for (let b = a + 1; b < unique.length; b += 1) {
      const separation = Math.hypot(
        unique[a].x - unique[b].x,
        unique[a].y - unique[b].y,
        unique[a].z - unique[b].z,
      );
      assert.ok(separation > EPSILON, `vertices ${a} and ${b} were not deduplicated`);
    }
  }
  assert.throws(() => collectSolidVertices({}), /vertices array/);
  assert.throws(
    () => collectSolidVertices({ vertices: [{ x: Number.NaN, y: 0, z: 0 }] }),
    /finite coordinates/,
  );
});

test("depthForVertex places the resolved clipping plane exactly on the vertex", () => {
  const facet = REFERENCE.pavilionMains.find((candidate) => candidate.index === 0);
  const vertex = capVertexTowardAzimuth(collectSolidVertices(REFERENCE.solid), facet.plane);
  const depth = depthForVertex(facet.plane.normal, vertex, STOCK);
  assert.equal(depth, 0.42);

  const plane = facetToClippingPlane(
    { region: "pavilion", industryAngleDeg: 41, index: 0, depth },
    { stock: STOCK },
  );
  assert.ok(Math.abs(dot(plane.normal, vertex) - plane.offset) < EPSILON);
  assert.equal(depthForVertex({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 2 }, STOCK), -1);
});

test("depthForEdge stops at the shallower endpoint instead of overcutting it", () => {
  const normal = { x: 0, y: 0, z: 1 };
  const edge = { a: { x: 0.2, y: -0.3, z: 0.5 }, b: { x: 0.2, y: -0.3, z: -0.5 } };
  assert.equal(depthForEdge(normal, edge, STOCK), 0.5);
  assert.equal(depthForEdge(normal, { a: edge.b, b: edge.a }, STOCK), 0.5);

  const support = rotationalStockSupportOffset(normal, STOCK);
  assert.equal(dot(normal, edge.a), support - 0.5);
  assert.ok(dot(normal, edge.b) < support - 0.5);
  assert.ok(dot(normal, edge.a) > support - 1.5);
  assert.equal(
    depthForEdge(normal, { a: { x: 0, y: 0, z: 0.25 }, b: { x: 0.75, y: 0.5, z: 0.25 } }, STOCK),
    0.75,
  );
  assert.equal(
    depthForEdge({ x: 1, y: 0, z: 0 }, { a: { x: 0.5, y: 0.25, z: 0 }, b: { x: -0.5, y: 0.9, z: -0.3 } }, STOCK),
    0.5,
  );
  assert.throws(() => depthForEdge(normal, { a: edge.a }), /finite coordinates/);
});

test("angleForVertexTarget recovers the cutting angle of a pavilion vertex meet", () => {
  const facet = REFERENCE.pavilionMains.find((candidate) => candidate.index === 0);
  const vertex = capVertexTowardAzimuth(collectSolidVertices(REFERENCE.solid), facet.plane);
  const depth = depthForVertex(facet.plane.normal, vertex, STOCK);
  const solved = angleForVertexTarget({
    baseIndex: 0,
    region: "pavilion",
    vertex,
    depth,
    stock: STOCK,
  });
  assert.ok(solved);
  approximately(solved.betaDeg, -49, 1e-3);
  approximately(solved.industryAngleDeg, 41, 1e-3);

  const normal = facetNormal(0, solved.betaDeg);
  const offset = rotationalStockSupportOffset(normal, STOCK) - depth;
  assert.ok(Math.abs(dot(normal, vertex) - offset) < 1e-6);
});

test("angleForVertexTarget solves crown angles and rejects invalid targets", () => {
  const normal = facetNormal(0, 55);
  const depth = 0.25;
  const offset = rotationalStockSupportOffset(normal, STOCK) - depth;
  const vertex = { x: normal.x * offset, y: normal.y * offset, z: normal.z * offset };
  const solved = angleForVertexTarget({
    baseIndex: 0,
    region: "crown",
    vertex,
    depth,
    stock: STOCK,
  });
  assert.ok(solved);
  approximately(solved.betaDeg, 55, 1e-3);
  approximately(solved.industryAngleDeg, 35, 1e-3);

  assert.throws(
    () => angleForVertexTarget({ baseIndex: 0, region: "girdle", vertex, depth: 0.5, stock: STOCK }),
    /girdle/,
  );
  assert.throws(
    () => angleForVertexTarget({ baseIndex: 0, region: "pavilion", vertex, depth: Number.NaN, stock: STOCK }),
    /finite number/,
  );
});
