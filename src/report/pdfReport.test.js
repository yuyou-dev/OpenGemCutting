import test from "node:test";
import assert from "node:assert/strict";

import { createFacetingDocument, resolveFacetPattern } from "../domain/faceting.js";
import { clipPolyhedronByPlanes, createCenteredCube, measurePolyhedron } from "../domain/geometry.js";
import { buildFacetReportPages, createFacetReportModel, findTableFace } from "./pdfReport.js";

function makeInput() {
  const facets = [
    ...resolveFacetPattern({ patternId: "p1", label: "P1 亭部", region: "pavilion", baseIndex: 0, repeat: 8, mirror: 0, industryAngleDeg: 41, depth: 0.42 }),
    ...resolveFacetPattern({ patternId: "c1", label: "C1 冠部", region: "crown", baseIndex: 6, repeat: 8, mirror: 0, industryAngleDeg: 32, depth: 0.3 }),
    ...resolveFacetPattern({ patternId: "c2", label: "C2 冠部", region: "crown", baseIndex: 12, repeat: 8, mirror: 0, industryAngleDeg: 15, depth: 0.3 }),
    ...resolveFacetPattern({ patternId: "g1", label: "G1 腰部", region: "girdle", baseIndex: 0, repeat: 16, mirror: 0, industryAngleDeg: 90, depth: 0.1 }),
  ];
  const document = createFacetingDocument({ name: "报告测试", facets });
  const solid = clipPolyhedronByPlanes(
    createCenteredCube(2),
    facets.map((facet) => ({ ...facet.plane, operationId: facet.patternId, faceId: facet.id, region: facet.region })),
  );
  return { document, solid, metrics: measurePolyhedron(solid), generatedAt: new Date("2026-08-30T12:00:00+08:00") };
}

test("excludes girdle facet tables by default when includeGirdle is false", () => {
  const model = createFacetReportModel({ ...makeInput(), includeGirdle: false });
  assert.equal(model.facetCount, 40);
  assert.equal(model.exportedFacetCount, 24);
  assert.deepEqual(model.girdleSummary, { groupCount: 1, facetCount: 16 });
  const pages = buildFacetReportPages(model);
  assert.equal(pages.length, 4);
  assert.deepEqual(pages.slice(1).map((page) => page.group.id), ["p1", "c1", "c2"]);
});

test("builds grouped report data with dimensions and every facet value", () => {
  const model = createFacetReportModel(makeInput());
  assert.equal(model.facetCount, 40);
  assert.equal(model.operationCount, 4);
  assert.ok(model.bounds.size.x > 0);
  assert.deepEqual(model.regions.map((region) => region.facetCount), [8, 16, 16]);
  assert.match(model.regions[0].rows[0].plane, /^n\(.+\) d=/);
  assert.match(model.regions[0].rows[0].industryAngle, /°$/);
  assert.deepEqual(model.regions[2].groups.map((group) => group.id), ["c1", "c2"]);
});

test("builds one illustrated schedule per facet group", () => {
  const pages = buildFacetReportPages(createFacetReportModel(makeInput()));
  assert.equal(pages.length, 5);
  assert.equal(pages[0].kind, "cover");
  assert.deepEqual(pages.slice(1).map((page) => page.region.label), [
    "亭部 PAVILION",
    "腰部 GIRDLE",
    "冠部 CROWN",
    "冠部 CROWN",
  ]);
  assert.deepEqual(pages.slice(1).map((page) => page.group.id), ["p1", "g1", "c1", "c2"]);
  assert.ok(pages.slice(1).every((page) => page.kind === "group" && page.rows.length <= 18));
});

test("findTableFace locates the topmost horizontal face after a table cut", () => {
  const tableFacets = resolveFacetPattern({
    patternId: "table-facet", label: "T1 台面", region: "crown",
    baseIndex: 0, repeat: 1, mirror: 0, industryAngleDeg: 0, depth: 0.2,
  });
  const facets = [
    ...tableFacets,
    ...resolveFacetPattern({ patternId: "p1", label: "P1 亭部", region: "pavilion", baseIndex: 0, repeat: 8, mirror: 0, industryAngleDeg: 41, depth: 0.42 }),
  ];
  const solid = clipPolyhedronByPlanes(
    createCenteredCube(2),
    facets.map((facet) => ({ ...facet.plane, operationId: facet.patternId, faceId: facet.id, region: facet.region })),
  );
  const tableFace = findTableFace(solid);
  assert.ok(tableFace, "a real document with a table layer must expose a table face");
  assert.equal(tableFace.sourceOperationId, "table-facet");
  assert.ok(tableFace.normal.z > 0.999);
  const zValues = tableFace.vertexIndices.map((index) => solid.vertices[index].z);
  assert.ok(Math.min(...zValues) > 0.7, "table face sits near the crown top");
});
