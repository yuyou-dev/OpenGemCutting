import test from "node:test";
import assert from "node:assert/strict";

import { createFacetingDocument, resolveFacetPattern } from "../domain/faceting.js";
import { clipPolyhedronByPlanes, createCenteredCube, measurePolyhedron } from "../domain/geometry.js";
import { enumerateTopologyVertices, solveVertexMeet } from "../domain/meetJump.js";
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

function makeCoveredInput({ partial }) {
  const facets = [
    ...resolveFacetPattern({
      patternId: "old", label: "OLD", region: "crown", baseIndex: 0,
      repeat: partial ? 4 : 1, mirror: 0, industryAngleDeg: 32, depth: 0.2,
    }),
    ...resolveFacetPattern({
      patternId: "new", label: "NEW", region: "crown", baseIndex: 0,
      repeat: 1, mirror: 0, industryAngleDeg: 32, depth: 0.4,
    }),
  ];
  const document = createFacetingDocument({ facets });
  const solid = clipPolyhedronByPlanes(
    createCenteredCube(2),
    facets.map((facet) => ({ ...facet.plane, operationId: facet.patternId, faceId: facet.id, region: facet.region })),
  );
  return { document, solid, metrics: measurePolyhedron(solid) };
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

test("reports stored and effective counts while omitting overwritten facet records", () => {
  const partial = createFacetReportModel(makeCoveredInput({ partial: true }));
  const partialGroups = partial.regions.flatMap((region) => region.groups);

  assert.equal(partial.facetCount, 5);
  assert.equal(partial.storedFacetCount, 5);
  assert.equal(partial.effectiveFacetCount, 4);
  assert.equal(partial.omittedFacetCount, 1);
  assert.equal(partial.exportedFacetCount, 4);
  assert.deepEqual(partialGroups.find((group) => group.id === "old").facets.map((facet) => facet.index), [24, 48, 72]);
  assert.deepEqual(partialGroups.find((group) => group.id === "new").facets.map((facet) => facet.index), [0]);

  const fullyCovered = createFacetReportModel(makeCoveredInput({ partial: false }));
  assert.equal(fullyCovered.storedFacetCount, 2);
  assert.equal(fullyCovered.effectiveFacetCount, 1);
  assert.deepEqual(fullyCovered.regions.flatMap((region) => region.groups).map((group) => group.id), ["new"]);
});

test("marks stale Meet construction intent explicitly in the report model", () => {
  const input = makeInput();
  input.document.facets
    .filter((facet) => facet.patternId === "c1")
    .forEach((facet) => {
      facet.metadata = {
        patternMode: "symmetric",
        construction: {
          type: "vertex-meet",
          solverVersion: 1,
          target: {
            topologyKey: "vertex:missing",
            sourceFaceIds: ["missing"],
            sourceOperationIds: ["p1"],
            sourceGeometrySignature: "v1:missing",
            fallbackWorldPoint: [0, 0, 0],
          },
        },
      };
    });
  const model = createFacetReportModel(input);
  const group = model.regions.flatMap((region) => region.groups).find((item) => item.id === "c1");
  assert.equal(group.construction.status, "stale");
  assert.match(group.construction.text, /来源已失效/);
});

test("reports a valid Meet source and marks it stale when that source is hidden", () => {
  const baseFacets = [
    ...resolveFacetPattern({ patternId: "p1", label: "P1 亭部", region: "pavilion", baseIndex: 0, repeat: 4, mirror: 0, industryAngleDeg: 41, depth: 0.42 }),
    ...resolveFacetPattern({ patternId: "g1", label: "G1 腰部", region: "girdle", baseIndex: 0, repeat: 16, mirror: 0, industryAngleDeg: 90, depth: 0.1 }),
  ];
  const stockSolid = createCenteredCube(2, { center: [0, 0, 0], sourceOperationId: "rough-cube", region: "rough" });
  const baseSolid = clipPolyhedronByPlanes(stockSolid, baseFacets.map((facet) => ({
    ...facet.plane, operationId: facet.patternId, faceId: facet.id, region: facet.region,
  })));
  const target = enumerateTopologyVertices(baseSolid).find((item) => (
    item.sourceOperationIds.includes("p1") && item.sourceOperationIds.includes("g1")
  ));
  const provisional = resolveFacetPattern({ patternId: "c1", region: "crown", baseIndex: 6, repeat: 4, mirror: 0, industryAngleDeg: 32, depth: 0.1 });
  const primary = provisional.find((facet) => facet.index === facet.baseIndex);
  const solved = solveVertexMeet({ normal: primary.plane.normal, target, stock: { kind: "cube", size: 2, center: [0, 0, 0] } });
  const construction = { type: "vertex-meet", solverVersion: 1, target };
  const crown = resolveFacetPattern({
    patternId: "c1", label: "C1 冠部", region: "crown", baseIndex: 6, repeat: 4, mirror: 0,
    industryAngleDeg: 32, depth: solved.depth, metadata: { patternMode: "symmetric", construction },
  });
  const document = createFacetingDocument({ facets: [...baseFacets, ...crown] });
  const solid = clipPolyhedronByPlanes(stockSolid, document.facets.map((facet) => ({
    ...facet.plane, operationId: facet.patternId, faceId: facet.id, region: facet.region,
  })));
  const input = { document, solid, metrics: measurePolyhedron(solid) };
  const valid = createFacetReportModel(input).regions.flatMap((region) => region.groups).find((group) => group.id === "c1");
  const stale = createFacetReportModel({ ...input, hiddenPatternIds: ["p1"] }).regions.flatMap((region) => region.groups).find((group) => group.id === "c1");
  assert.equal(valid.construction.status, "valid");
  assert.match(valid.construction.text, /来源 G1 × P1/);
  assert.equal(stale.construction.status, "stale");
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
