import assert from "node:assert/strict";
import test from "node:test";
import { clipPolyhedron, createCenteredCube } from "./geometry.js";
import { projectTechnicalPreview, technicalPreviewSvg, TECHNICAL_PREVIEW_VIEWS } from "./technicalPreview.js";

test("projects visible cube edges inside the requested technical frame", () => {
  const projection = projectTechnicalPreview(createCenteredCube(2), "top", { width: 200, height: 120, padding: 10 });
  assert.ok(projection.edges.length >= 4);
  projection.points.forEach((point) => {
    assert.ok(point.x >= 10 && point.x <= 190);
    assert.ok(point.y >= 10 && point.y <= 110);
  });
  projection.edges.forEach(([start, end]) => {
    const a = projection.points[start]; const b = projection.points[end];
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 0.08);
  });
});

test("renders deterministic white-background line SVGs for all preset views", () => {
  const solid = createCenteredCube(2);
  for (const view of ["isometric", "top", "bottom", "front"]) {
    const svg = technicalPreviewSvg(solid, view, { width: 160, height: 120 });
    assert.match(svg, /^<svg/);
    assert.match(svg, /fill="#fff"/);
    assert.match(svg, /<line /);
  }
});

test("keeps edge-on faces in orthographic views so the stone silhouette stays complete", () => {
  const solid = {
    vertices: [
      { x: -1, y: -1, z: 0 },
      { x: 1, y: -1, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: -1, y: 1, z: 0 },
    ],
    faces: [
      { normal: { x: 0, y: 0, z: -1 }, vertexIndices: [0, 1, 3] },
      { normal: { x: 1, y: 0, z: 0 }, vertexIndices: [1, 2, 3] },
    ],
  };

  const projection = projectTechnicalPreview(solid, "bottom");
  assert.ok(projection.edges.some(([start, end]) => start === 1 && end === 2));
});

test("side previews observe +X with Y horizontal and crown +Z above the pavilion", () => {
  const solid = createCenteredCube(2);
  const projection = projectTechnicalPreview(solid, "side");
  assert.deepEqual(projection.faces.map((face) => face.id), ["cube:+x"]);
  assert.equal(projection.points[0].x, projection.points[1].x);
  assert.equal(projection.points[0].y, projection.points[1].y);
  assert.ok(projection.points[2].x > projection.points[1].x);
  assert.ok(projection.points[5].y < projection.points[1].y);
  assert.deepEqual(TECHNICAL_PREVIEW_VIEWS, ["isometric", "top", "bottom", "front"]);
});

test("side previews hide rear bevel faces and edges while keeping operation identity", () => {
  const cube = createCenteredCube(2);
  cube.faces.find((face) => face.id === "cube:+x").sourceOperationId = "visible-layer";
  const solid = clipPolyhedron(cube, { normal: { x: -1, y: 0, z: 0.5 }, offset: 1 });
  const projection = projectTechnicalPreview(solid, "side");
  assert.equal(projection.faces.length, 1);
  assert.equal(projection.faces[0].sourceOperationId, "visible-layer");
  const minX = Math.min(...projection.points.map((point) => point.x));
  const maxX = Math.max(...projection.points.map((point) => point.x));
  const minY = Math.min(...projection.points.map((point) => point.y));
  const maxY = Math.max(...projection.points.map((point) => point.y));
  for (const [start, end] of projection.edges) {
    const a = projection.points[start]; const b = projection.points[end];
    assert.ok(
      (a.x === b.x && (a.x === minX || a.x === maxX))
      || (a.y === b.y && (a.y === minY || a.y === maxY)),
      "rear bevel must not draw any line inside the front silhouette",
    );
  }
  assert.deepEqual(projectTechnicalPreview(solid, "top").faces.map((face) => face.id),
    solid.faces.filter((face) => face.normal.z > 1e-6).map((face) => face.id));
});
