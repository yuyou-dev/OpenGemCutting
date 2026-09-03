import assert from "node:assert/strict";
import test from "node:test";
import { createCenteredCube } from "./geometry.js";
import { projectTechnicalPreview, technicalPreviewSvg } from "./technicalPreview.js";

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
