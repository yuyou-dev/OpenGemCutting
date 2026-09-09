import test from "node:test";
import assert from "node:assert/strict";
import { buildMeshBvh, getMeshBvh, raycastMesh, intersectMeshSegment } from "./meshRaycast.js";
import { normalizedOpticsMesh, packOpticsMeshTextures, traceMeshOpticalPaths } from "./opticsGeometry.js";

// Boundary of occupied unit cells. Omitting their shared faces gives actual
// closed U/ring solids rather than overlapping boxes or convex hulls.
function voxelBoundary(cells) {
  const occupied = new Set(cells.map((cell) => cell.join(",")));
  const vertices = [];
  const faces = [];
  const sides = [
    [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
    [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
    [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]],
    [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
    [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
    [[0, 0, -1], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
  ];
  for (const cell of cells) {
    for (const [normal, corners] of sides) {
      if (occupied.has(cell.map((value, axis) => value + normal[axis]).join(","))) continue;
      const vertexIndices = corners.map((corner) => {
        const point = corner.map((value, axis) => value + cell[axis]);
        vertices.push({ x: point[0], y: point[1], z: point[2] });
        return vertices.length - 1;
      });
      faces.push({ id: `patch-${faces.length}`, facetId: "rough", normal, vertexIndices });
    }
  }
  return { kind: "mesh", vertices, faces };
}
const uShape = () => voxelBoundary([[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0], [2, 1, 0], [0, 2, 0], [2, 2, 0]]);

test("shared BVH queries real U boundaries, air gaps, normals and segment endpoints", () => {
  const mesh = uShape();
  assert.equal(getMeshBvh(mesh), getMeshBvh(mesh));
  assert.equal(raycastMesh(mesh, [1.5, 2.5, 2], [0, 0, -1]), null);
  const entry = raycastMesh(mesh, [-1, 2.5, 0.5], [3, 0, 0]);
  assert.equal(entry.distance, 1);
  assert.deepEqual(entry.normal, [-1, 0, 0]);
  assert.equal(entry.face.id, mesh.faces[entry.faceIndex].id);
  const exit = raycastMesh(mesh, [0.1, 2.5, 0.5], [1, 0, 0]);
  assert.ok(Math.abs(exit.distance - 0.9) < 1e-12);
  assert.deepEqual(exit.normal, [1, 0, 0]);
  assert.equal(intersectMeshSegment(mesh, [1, 2.5, 0.5], [2, 2.5, 0.5]), null);
  assert.ok(intersectMeshSegment(mesh, [0.5, 2.5, 0.5], [2.5, 2.5, 0.5]));
});

test("optical transmission crosses both U arms with an air gap and absorbs only crystal distance", () => {
  const mesh = uShape();
  const paths = traceMeshOpticalPaths(mesh, [-1, 2.5, 0.5], [1, 0, 0], { ior: 1, absorption: 0.5 });
  assert.equal(paths.unresolved.length, 0);
  assert.equal(paths.escaped.length, 1);
  const path = paths.escaped[0];
  assert.deepEqual(path.boundaries.map((hit) => hit.entering), [true, false, true, false]);
  assert.deepEqual(path.boundaries.map((hit) => hit.point[0]), [0, 1, 2, 3]);
  assert.ok(Math.abs(path.weight - Math.exp(-1)) < 2e-6);
});

test("a through-hole remains empty in optical normalization and has outward inner-wall normals", () => {
  const cells = [];
  for (let x = 0; x < 3; x += 1) for (let y = 0; y < 3; y += 1) if (x !== 1 || y !== 1) cells.push([x, y, 0]);
  const mesh = voxelBoundary(cells);
  assert.equal(raycastMesh(mesh, [1.5, 1.5, 2], [0, 0, -1]), null);
  const normalized = normalizedOpticsMesh(mesh);
  assert.equal(raycastMesh(normalized, [0, 0, 2], [0, 0, -1]), null);
  const wall = raycastMesh(mesh, [1.5, 1.5, 0.5], [1, 0, 0]);
  assert.deepEqual(wall.normal, [-1, 0, 0]);
  assert.equal(wall.distance, 0.5);
});

test("Fresnel transmission re-enters disconnected components and respects the bounce budget", () => {
  const mesh = voxelBoundary([[0, 0, 0], [3, 0, 0]]);
  const paths = traceMeshOpticalPaths(mesh, [-1, 0.5, 0.5], [1, 0, 0], { ior: 1.5 });
  const transmitted = paths.escaped.find((path) => path.boundaries.length === 4 && path.direction[0] > 0.99);
  assert.ok(transmitted);
  assert.deepEqual(transmitted.boundaries.map((hit) => hit.point[0]), [0, 1, 3, 4]);
  assert.ok(Math.abs(transmitted.weight - 0.96 ** 4) < 1e-10);
  assert.ok(paths.escaped.some((path) => path.direction[0] < 0));
  const limited = traceMeshOpticalPaths(mesh, [-1, 0.5, 0.5], [1, 0, 0], { ior: 1.5, maxBounces: 2 });
  assert.ok(limited.unresolved.some((path) => path.direction[0] > 0));
  assert.ok(!limited.escaped.some((path) => path.direction[0] > 0));
});

test("triangle texture packs every boundary and BVH escape link, and rejects insufficient capacity", () => {
  const mesh = voxelBoundary(Array.from({ length: 100 }, (_, index) => [index * 2, 0, 0]));
  const bvh = buildMeshBvh(mesh);
  assert.equal(bvh.triangles.length, 1200);
  const packed = packOpticsMeshTextures(bvh, 128);
  assert.equal(bvh.nodes[0].escape, bvh.nodes.length);
  assert.ok(packed.triangles.width * packed.triangles.height >= 4800);
  bvh.nodes.forEach((node, index) => assert.equal(packed.nodes.data[index * 12 + 3], node.escape));
  bvh.triangles.forEach((triangle, index) => assert.deepEqual(Array.from(packed.triangles.data.slice(index * 16, index * 16 + 3)), triangle.a.map(Math.fround)));
  assert.throws(() => packOpticsMeshTextures(bvh, 16), /未省略任何面片/);
  assert.equal(raycastMesh(bvh, [-1, 0.5, 0.5], [1, 0, 0]).distance, 1);
});

test("total internal reflection remains inside until the next actual exit", () => {
  const mesh = voxelBoundary([[0, 0, 0]]);
  const paths = traceMeshOpticalPaths(mesh, [-1, -0.5, 0.5], [1, 1, 0], { ior: 1.5 });
  const internallyReflected = paths.escaped.find((path) => path.boundaries.length === 3 && path.weight > 0.8);
  assert.ok(internallyReflected);
  assert.deepEqual(internallyReflected.boundaries.map((hit) => hit.normal), [[-1, 0, 0], [0, 1, 0], [1, 0, 0]]);
  assert.deepEqual(internallyReflected.boundaries.map((hit) => hit.entering), [true, false, false]);
  assert.ok(internallyReflected.direction[0] > 0 && internallyReflected.direction[1] < 0);
  assert.ok(!paths.escaped.some((path) => path.boundaries.length === 2 && path.direction[1] > 0));
});

test("helper material occupancy keeps concavities and disconnected air gaps available", async () => {
  const { isPointInsideMesh } = await import("./meshRaycast.js");
  const mesh = uShape();
  assert.equal(isPointInsideMesh(mesh, [0.5, 2.5, 0.5]), true);
  assert.equal(isPointInsideMesh(mesh, [1.5, 2.5, 0.5]), false);
  assert.equal(isPointInsideMesh(mesh, [1.5, 0.5, 0.5]), true);
  assert.equal(isPointInsideMesh(mesh, [1, 2.5, 0.5]), false);
  assert.equal(isPointInsideMesh(mesh, [0, 2.5, 0.5]), false);
  assert.equal(isPointInsideMesh(mesh, [1.5, 2.5, -0.5]), false);
  const separate = voxelBoundary([[0, 0, 0], [3, 0, 0]]);
  assert.equal(isPointInsideMesh(separate, [2, 0.5, 0.5]), false);
  assert.equal(isPointInsideMesh(separate, [3.5, 0.5, 0.5]), true);
});

test("BVH excludes floating-point collinear fan remnants but retains real small and thin triangles", () => {
  const face = { vertexIndices: [0, 1, 2], normal: [0, 0, 1] };
  for (const scale of [1e-6, 1, 1e6]) {
    const bvhFor = (vertices) => buildMeshBvh({ kind: "mesh", faces: [face],
      vertices: vertices.map(point => point.map(value => value * scale)) });
    // These exact collinear points leave a nonzero double cross-product residue.
    assert.equal(bvhFor([[0, 0, 0], [.1, .2, .3], [.3, .6, .9]]).triangles.length, 0);
    assert.equal(bvhFor([[0, 0, 0], [1, 1, 0], [1, 1 + 1e-12, 0]]).triangles.length, 1);
    assert.equal(bvhFor([[0, 0, 0], [1e-12, 0, 0], [0, 1e-12, 0]]).triangles.length, 1);
  }
});
