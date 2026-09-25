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

test("reports edge ratios, both Meet sources and preform intent with space for wrapped text", async () => {
  const { enumerateTopologyEdges, createEdgeMeetTarget } = await import("../domain/meetJump.js");
  const input = makeInput();
  const edge = enumerateTopologyEdges(createCenteredCube(2, { sourceOperationId: "rough-cube" }))[0];
  const target = createEdgeMeetTarget(edge, 0.95);
  input.document.facets.filter((facet) => facet.patternId === "c1").forEach((facet) => {
    facet.metadata = { ...facet.metadata, preform: true, construction: {
      type: "dual-meet", solverVersion: 2, primaryIndex: 6, target,
      secondTarget: { ...edge.endpoints[0], sourceGeometrySignature: "v1:stale" },
    } };
  });
  const model = createFacetReportModel(input);
  const group = model.regions.flatMap((region) => region.groups).find((item) => item.id === "c1");
  assert.match(group.construction.text, /预形 · 双 Meet · A 棱点 95.00%/);
  assert.match(group.construction.text, /B 顶点/);
  assert.match(group.construction.text, /来源已失效/);
  assert.equal(group.preform, true);
  group.rows = Array.from({ length: 40 }, (_, index) => ({ index }));
  const pages = buildFacetReportPages(model).filter((page) => page.group?.id === "c1");
  assert.equal(pages.flatMap((page) => page.rows).length, 40);
  assert.ok(pages.every((page) => page.rows.length < 18));
});

test("mesh reports count one CUT with multiple surface patches once and span every table patch", async () => {
  const { readFile } = await import("node:fs/promises");
  const { inspectCrystalOBJ } = await import("../domain/stockGeometry.js");
  const { document: imported, solid: rough } = inspectCrystalOBJ(await readFile(new URL("../../docs/manual/examples/08-concave-crystal.obj", import.meta.url),"utf8"),{fileName:"L.obj"});
  assert.equal(findTableFace(rough),undefined,"natural horizontal patches are not a saved table");
  const table = resolveFacetPattern({patternId:"table-facet",label:"T1 台面",region:"crown",repeat:1,industryAngleDeg:0,depth:1,stock:imported.stock});
  const document = createFacetingDocument({...imported,facets:table});
  const solid = clipPolyhedronByPlanes(rough,table.map(facet=>({...facet.plane,operationId:facet.patternId,faceId:facet.id,region:facet.region})));
  const patches=solid.faces.filter(face=>face.facetId===table[0].id);
  assert.ok(patches.length>1);
  const model=createFacetReportModel({document,solid,metrics:measurePolyhedron(solid)});
  assert.equal(model.effectiveFacetCount,1);
  assert.equal(model.regions.find(region=>region.id==="crown").rows.length,1);
  const tableFace=findTableFace(solid);
  assert.deepEqual(new Set(tableFace.vertexIndices),new Set(patches.flatMap(face=>face.vertexIndices)));
  assert.equal(Math.max(...tableFace.vertexIndices.map(index=>solid.vertices[index].x))-Math.min(...tableFace.vertexIndices.map(index=>solid.vertices[index].x)),2);
});

test('PDF renders Chinese-only operation labels with embedded CJK fonts', async () => {
  const { readFile } = await import('node:fs/promises');
  const { createFacetReportPdfBytes } = await import('./pdfReport.js');
  const input = makeInput();
  input.document = createFacetingDocument({ ...input.document, facets: input.document.facets.map(f => ({ ...f, label: '台面与亭部' })) });
  const [regularBytes, boldBytes] = await Promise.all([
    readFile(new URL('../../public/fonts/NotoSerifSC-Light.ttf', import.meta.url)),
    readFile(new URL('../../public/fonts/NotoSerifSC-SemiBold.ttf', import.meta.url)),
  ]);
  const bytes = await createFacetReportPdfBytes(input, { regularBytes, boldBytes });
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
});


test("reports real directions on the chosen wheel across mixed authored wheels", () => {
  const facets = [
    ...resolveFacetPattern({ patternId: "n96", label: "N96", region: "crown", baseIndex: 1, indexTeeth: 96, repeat: 1, industryAngleDeg: 32, depth: 0.2 }),
    ...resolveFacetPattern({ patternId: "n120", label: "N120", region: "pavilion", baseIndex: 1, indexTeeth: 120, repeat: 1, industryAngleDeg: 41, depth: 0.2 }),
  ];
  const model = createFacetReportModel({ document: createFacetingDocument({ facets, indexGear: 360 }) });
  assert.equal(model.indexTeeth, 360);
  assert.equal(model.regions.find((region) => region.id === "crown").rows[0].index, "3.75");
  assert.equal(model.regions.find((region) => region.id === "pavilion").rows[0].index, "03");
  assert.equal(model.compatibility.compatible, false);
  assert.equal(model.compatibility.incompatibleCount, 1);
});

test("evaluates the committed concave solid and separates curved surfaces from flat instructions", () => {
  const input = makeInput();
  const plain = createFacetReportModel(input);
  const document = createFacetingDocument({ ...input.document, concaveCuts: [
    { id: "five", type: "sphere", position: [0.8, 0, 0], radius: 0.3, repeat: 5, segments: 12 },
    { id: "disabled", type: "cylinder", position: [0, 0, 0], radius: 0.2, length: 1, enabled: false },
  ] });
  const model = createFacetReportModel({ ...input, document });
  assert.ok(model.volume < plain.volume, "stale supplied solid and metrics cannot hide active concave cuts");
  assert.equal(model.concaveOperations.length, 2);
  assert.equal(model.activeConcaveCount, 1);
  assert.ok(model.concaveOperations[0].surfacePatchCount > 0);
  assert.ok(model.regions.every((region) => region.groups.every((group) => group.id !== "five")));
  const pages = buildFacetReportPages(model);
  assert.equal(pages.at(-1).kind, "concave");
  assert.equal(pages.at(-1).operations.length, 2);
  assert.match(model.hardwareNote, /平面工序/);
});

function withFrostedPavilion(input) {
  const frosted = { version: 1, model: "ggx-dielectric", state: "frosted", alpha: 0.28 };
  const document = createFacetingDocument({ ...input.document,
    facets: input.document.facets.map((facet) => facet.patternId === "p1" && facet.index % 24 === 0
      ? { ...facet, metadata: { ...(facet.metadata ?? {}), surfaceFinish: frosted } } : facet) });
  return { ...input, document };
}

test("surface finishes export as polished by default and are annotated only on request", async () => {
  const { REPORT_SURFACE_MODES } = await import("./pdfReport.js");
  assert.deepEqual(REPORT_SURFACE_MODES, ["polished", "annotated"]);
  const input = withFrostedPavilion(makeInput());
  const polished = createFacetReportModel(input);
  assert.equal(polished.surface.frostedCount, 4);
  assert.equal(polished.surface.annotate, false, "the default report is all polished");
  assert.ok(polished.regions.flatMap((region) => region.rows).every((row) => row.finish === undefined && row.frosted === false));

  const annotated = createFacetReportModel({ ...input, surfaceFinish: "annotated" });
  const pavilion = annotated.regions.find((region) => region.id === "pavilion");
  assert.equal(annotated.surface.annotate, true);
  assert.equal(pavilion.frostedCount, 4);
  assert.equal(pavilion.groups[0].frostedCount, 4);
  const finishes = pavilion.rows.map((row) => row.finish);
  assert.equal(finishes.filter((finish) => finish === "磨砂 α 0.28").length, 4);
  assert.equal(finishes.filter((finish) => finish === "抛光").length, 4);
  assert.ok(pavilion.rows.every((row) => row.frosted === (row.finish !== "抛光")));
  const english = createFacetReportModel({ ...input, surfaceFinish: "annotated", locale: "en" });
  assert.deepEqual([...new Set(english.regions.find((region) => region.id === "pavilion").rows.map((row) => row.finish))].sort(), ["Frosted α 0.28", "Polished"]);
  // Annotation without any frosted face changes nothing.
  assert.equal(createFacetReportModel({ ...makeInput(), surfaceFinish: "annotated" }).surface.annotate, false);
  assert.throws(() => createFacetReportModel({ ...input, surfaceFinish: "matte" }), /表面处理/);
});

test("face codes never overlap, skip slivers and leave the view box", async () => {
  const { layoutFaceLabels } = await import("./pdfReport.js");
  const face = (x, y, area) => ({ area, center: { x, y } });
  const { placed, skipped } = layoutFaceLabels([
    { label: "SMALL", total: 5, largest: face(50, 50, 400) },
    { label: "BIG", total: 90, largest: face(52, 51, 900) },
    { label: "SLIVER", total: 40, largest: face(20, 20, 3) },
    { label: "OUT", total: 30, largest: face(400, 50, 900) },
    { label: "FREE", total: 20, largest: face(80, 20, 400) },
  ], { measure: (label) => label.length * 4, height: 7, box: { x: 0, y: 0, width: 120, height: 100 } });
  assert.deepEqual(placed.map((item) => item.label), ["BIG", "FREE"]);
  assert.equal(skipped, 3);
  for (const [index, { rect }] of placed.entries()) for (const { rect: other } of placed.slice(index + 1)) {
    assert.ok(rect.x + rect.width <= other.x || other.x + other.width <= rect.x || rect.y + rect.height <= other.y || other.y + other.height <= rect.y);
  }
});

test("CJK report fonts keep digits and punctuation at their true advance", async () => {
  const { readFile } = await import("node:fs/promises");
  const { PDFDocument } = await import("pdf-lib");
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  const { CJK_FONT_FEATURES } = await import("./pdfReport.js");
  const bytes = await readFile(new URL("../../public/fonts/NotoSerifSC-Light.ttf", import.meta.url));
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(bytes, { features: { ...CJK_FONT_FEATURES } });
  const raw = fontkit.create(bytes);
  // Localized forms would swap in full-width glyphs narrowed only by GPOS, which
  // pdf-lib ignores; every Latin character must keep its default glyph and advance.
  for (const text of ["Cut 04", "45° · P1:15", "32 FACES"]) {
    const run = raw.layout(text, { ...CJK_FONT_FEATURES });
    assert.deepEqual(run.glyphs.map((glyph) => glyph.id), [...text].map((character) => raw.glyphForCodePoint(character.codePointAt(0)).id), text);
    assert.ok(run.glyphs.every((glyph) => glyph.advanceWidth < 800), text);
    const expected = run.glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0) / raw.unitsPerEm * 10;
    assert.ok(Math.abs(font.widthOfTextAtSize(text, 10) - expected) < 1e-6, text);
  }
  assert.notDeepEqual(raw.layout("Cut 04").glyphs.map((glyph) => glyph.id), raw.layout("Cut 04", { ...CJK_FONT_FEATURES }).glyphs.map((glyph) => glyph.id), "the font does substitute digits by default");
  const chinese = "台面与亭部磨砂边";
  assert.deepEqual(raw.layout(chinese, { ...CJK_FONT_FEATURES }).glyphs.map((glyph) => glyph.id), raw.layout(chinese).glyphs.map((glyph) => glyph.id));
});

test("report fonts and logo resolve against the deployment base", async () => {
  const { reportAssetUrl } = await import("./pdfReport.js");
  assert.equal(reportAssetUrl("fonts/NotoSerifSC-Light.ttf", "/"), "/fonts/NotoSerifSC-Light.ttf");
  assert.equal(reportAssetUrl("fonts/NotoSerifSC-Light.ttf", "/OpenGemCutting/"), "/OpenGemCutting/fonts/NotoSerifSC-Light.ttf");
  assert.equal(reportAssetUrl("brand/logo-report.png", "/nested"), "/nested/brand/logo-report.png");
  assert.equal(reportAssetUrl("brand/logo-report.png"), "/brand/logo-report.png");
});
