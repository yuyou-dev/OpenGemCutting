import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { clipPolyhedronByPlanes, createCenteredCube } from "./geometry.js";
import {
  createCommandHistory,
  createFacetingDocument,
  createReplaceDocumentCommand,
  executeFacetingCommand,
  exportFacetingJSON,
  importFacetingJSON,
  resolveFacetPattern,
  undoFacetingCommand,
} from "./faceting.js";
import { inspectGemCadAsc, parseGemCadAsc, serializeGemCadAsc } from "./gemcadAsc.js";

const fixtureUrl = new URL("./fixtures/astryx-star.asc", import.meta.url);

function ascFor(gear, indices, { offset = 0, table = true } = {}) {
  return [
    "GemCad 5.0",
    `g ${gear} ${offset}`,
    "y 1 n",
    "I 1.54",
    "H Gear test",
    `a 42.000000 0.50000000 ${indices.join(" ")} n P1`,
    ...(table ? ["a 0.000000 0.30000000"] : []),
  ].join("\n");
}

test("parses GemCad headers, comments, tier names and continued instructions", () => {
  const parsed = parseGemCadAsc([
    "\uFEFFGemCad 5.0",
    "g 96 0.0",
    "y 8 y",
    "I 1.76",
    "H Test design",
    "; retained note",
    "a -42.000000 0.60000000 96 n P1 84 72",
    "60 48",
    "G Meet the girdle",
    "F Public-domain fixture",
  ].join("\r\n"));

  assert.equal(parsed.gear, 96);
  assert.equal(parsed.symmetry, 8);
  assert.equal(parsed.mirrorSymmetry, true);
  assert.equal(parsed.refractiveIndex, 1.76);
  assert.deepEqual(parsed.tiers[0].indexTokens, ["96", "84", "72", "60", "48"]);
  assert.equal(parsed.tiers[0].name, "P1");
  assert.equal(parsed.tiers[0].facetNames["96"], "P1");
  assert.equal(parsed.tiers[0].instructions, "Meet the girdle");
  assert.deepEqual(parsed.comments, ["; retained note"]);
  assert.deepEqual(parsed.footnotes, ["Public-domain fixture"]);
});

test("accepts the canonical compact gear record", () => {
  const parsed = parseGemCadAsc("GemCad 5.0\ng96 0.0\ny 1 n\nI 1.54\na 0 .3\n");
  assert.equal(parsed.gear, 96);
  assert.ok(!parsed.diagnostics.some((item) => item.code === "MISSING_GEAR_PREFIX"));
});

test("replays the real Astryx Star fixture with proportional geometry", async () => {
  const result = inspectGemCadAsc(await readFile(fixtureUrl, "utf8"), { fileName: "Astryx-Star.asc" });
  assert.equal(result.status, "warning");
  assert.ok(result.document);
  assert.equal(result.parsed.tiers.length, 10);
  assert.equal(result.summary.facetCount, 57);
  assert.equal(result.document.facets.length, 57);
  assert.equal(result.document.facets[0].metadata.operationType, "table");
  assert.ok(Math.abs(result.summary.scale - 0.8965754734947321) < 1e-12);
  assert.ok(Math.abs(result.summary.dimensions.lengthToWidth - 1) < 1e-10);
  assert.ok(Math.abs(result.summary.dimensions.heightToWidth - 0.71696825) < 1e-7);

  const solid = clipPolyhedronByPlanes(
    createCenteredCube(2),
    result.document.facets.map((facet) => ({ ...facet.plane, operationId: facet.patternId, faceId: facet.id })),
  );
  assert.equal(solid.faces.filter((face) => face.sourceOperationId).length, 57);
});

test("maps compatible gears exactly and refuses every inexact source index", () => {
  for (const [gear, indices, expected] of [
    [64, [16, 32, 64], [24, 48, 0]],
    [72, [18, 36, 72], [24, 48, 0]],
    [80, [20, 40, 80], [24, 48, 0]],
    [120, [25, 50, 120], [20, 40, 0]],
  ]) {
    const result = inspectGemCadAsc(ascFor(gear, indices));
    assert.notEqual(result.status, "error", `${gear}-tooth exact mapping should pass`);
    const tier = result.document.facets.filter((facet) => facet.patternId === "asc-tier-1");
    assert.deepEqual(tier.map((facet) => facet.index), expected);
  }

  for (const gear of [64, 72, 80, 120]) {
    const result = inspectGemCadAsc(ascFor(gear, [1]));
    assert.equal(result.status, "error");
    assert.ok(result.diagnostics.some((item) => item.code === "INEXACT_INDEX_MAPPING" && item.line === 6));
  }
});

test("applies integer and fractional gear locations before exact mapping", () => {
  const integerOffset = inspectGemCadAsc(ascFor(64, [17, 33], { offset: 1 }));
  assert.notEqual(integerOffset.status, "error");
  assert.deepEqual(
    integerOffset.document.facets.filter((facet) => facet.patternId === "asc-tier-1").map((facet) => facet.index),
    [24, 48],
  );
  assert.ok(integerOffset.diagnostics.some((item) => item.code === "GEAR_OFFSET_APPLIED"));

  const fractionalOffset = inspectGemCadAsc(ascFor(96, ["0.5", "24.5"], { offset: 0.5 }));
  assert.notEqual(fractionalOffset.status, "error");
  assert.deepEqual(
    fractionalOffset.document.facets.filter((facet) => facet.patternId === "asc-tier-1").map((facet) => facet.index),
    [0, 24],
  );
});

test("classifies signed angles when the required table is present", () => {
  const result = inspectGemCadAsc([
    "GemCad 5.0",
    "g 96 0.0",
    "y 1 n",
    "I 1.54",
    "a -0.000000 -0.20000000 96 n CU",
    "a -90.000000 0.80000000 96 48 n G",
    "a 30.000000 0.70000000 24 72 n C",
    "a 0.000000 0.40000000 96 n T",
  ].join("\n"));
  assert.notEqual(result.status, "error");
  assert.equal(result.document.facets[0].metadata.operationType, "table");
  assert.ok(result.document.facets.some((facet) => facet.metadata?.asc?.name === "CU" && facet.region === "pavilion"));
  assert.ok(result.document.facets.some((facet) => facet.metadata?.asc?.name === "G" && facet.region === "girdle"));
  assert.ok(result.document.facets.some((facet) => facet.metadata?.asc?.name === "C" && facet.region === "crown"));
});

test("blocks tableless ASC rather than inventing document geometry", () => {
  const result = inspectGemCadAsc(ascFor(96, [24, 48], { table: false }));
  assert.equal(result.status, "error");
  assert.equal(result.document, null);
  assert.ok(result.diagnostics.some((item) => item.code === "MISSING_TABLE"));
});

test("blocks multiple horizontal tiers rather than guessing the fixed T1", () => {
  const result = inspectGemCadAsc(`GemCad 5.0
g 96 0
y 1 n
a 0 .4 0 n T
a 0 .3 0 n T2
a -42 .5 0 12 24 36 n P1
`);

  assert.equal(result.status, "error");
  assert.equal(result.document, null);
  assert.ok(result.diagnostics.some((item) => item.code === "AMBIGUOUS_TABLE" && item.line === 5));
});

test("accepts a horizontal table without an explicit index", () => {
  const result = inspectGemCadAsc([
    "GemCad 5.0",
    "g 96 0.0",
    "y 1 n",
    "I 1.54",
    "a 90 0.8 96 48 n G",
    "a 0 0.3",
  ].join("\n"));
  assert.notEqual(result.status, "error");
  assert.equal(result.document.facets[0].index, 0);
  assert.equal(result.document.facets[0].metadata.operationType, "table");
});

test("supports negative gears as reversed index direction", () => {
  const result = inspectGemCadAsc(ascFor(-64, [16, 32, 64]));
  assert.notEqual(result.status, "error");
  assert.deepEqual(
    result.document.facets.filter((facet) => facet.patternId === "asc-tier-1").map((facet) => facet.index),
    [72, 48, 0],
  );
});

test("reports unsupported preforms and malformed files without constructing a document", () => {
  const result = inspectGemCadAsc([
    "GemCad 5.0",
    "g 96 0.0",
    "y 1 n",
    "I 1.54",
    "p CAM unsupported",
    "a 0 0.2 96 n T",
  ].join("\n"));
  assert.equal(result.status, "error");
  assert.equal(result.document, null);
  assert.ok(result.diagnostics.some((item) => item.code === "UNSUPPORTED_PREFORM" && item.line === 5));
});

test("serializes 96-tooth explicit planes and imports them back equivalently", async () => {
  const imported = inspectGemCadAsc(await readFile(fixtureUrl, "utf8")).document;
  const exported = serializeGemCadAsc(imported);
  assert.equal(exported.status, "warning");
  assert.match(exported.text, /^GemCad 5\.0\ng96 0\.0\ny 8 n\nI 1\.54\n/);
  const restored = inspectGemCadAsc(exported.text);
  assert.notEqual(restored.status, "error");
  assert.equal(restored.document.facets.length, imported.facets.length);
  const left = imported.facets.map((facet) => [facet.region, facet.index, facet.industryAngleDeg, facet.plane.offset]);
  const right = restored.document.facets.map((facet) => [facet.region, facet.index, facet.industryAngleDeg, facet.plane.offset]);
  left.sort((a, b) => String(a).localeCompare(String(b)));
  right.sort((a, b) => String(a).localeCompare(String(b)));
  left.forEach((row, index) => {
    assert.deepEqual(row.slice(0, 3), right[index].slice(0, 3));
    assert.ok(Math.abs(row[3] - right[index][3]) < 1e-8);
  });
});

test("warns when native repeat, mirror and JSON-only optics are flattened", () => {
  const facets = resolveFacetPattern({
    patternId: "native-crown",
    region: "crown",
    baseIndex: 6,
    repeat: 8,
    mirror: 2,
    industryAngleDeg: 32,
    depth: 0.42,
    label: "C1 冠部",
    metadata: {
      patternMode: "symmetric",
      construction: {
        type: "vertex-meet",
        solverVersion: 1,
        target: {
          topologyKey: "vertex:a|b|c",
          sourceFaceIds: ["a", "b", "c"],
          sourceOperationIds: ["pavilion-1"],
          sourceGeometrySignature: "v1:0123456789abcdef",
          fallbackWorldPoint: [0, 0, 0],
        },
      },
    },
  });
  const document = createFacetingDocument({
    name: "原生测试",
    facets,
    metadata: { optics: { refractiveIndex: 2.417, dispersion: 0.044 } },
  });
  const result = serializeGemCadAsc(document);
  assert.equal(result.status, "warning");
  assert.ok(result.diagnostics.some((item) => item.code === "PARAMETRIC_RELATIONSHIP_FLATTENED"));
  assert.ok(result.diagnostics.some((item) => item.code === "OPTICS_METADATA_OMITTED"));
  assert.ok(result.diagnostics.some((item) => item.code === "UNICODE_TEXT"));
  assert.ok(result.diagnostics.some((item) => item.code === "MEET_CONSTRUCTION_OMITTED"));
  assert.match(result.text, /I 2\.417/);
});

test("exports only surviving facet records and reports overwritten omissions", () => {
  const partialDocument = createFacetingDocument({
    name: "Surviving facets",
    facets: [
      ...resolveFacetPattern({
        patternId: "partial-old", label: "OLD", region: "crown", baseIndex: 0,
        repeat: 4, mirror: 0, industryAngleDeg: 32, depth: 0.2,
      }),
      ...resolveFacetPattern({
        patternId: "partial-new", label: "NEW", region: "crown", baseIndex: 0,
        repeat: 1, mirror: 0, industryAngleDeg: 32, depth: 0.4,
      }),
    ],
  });
  const partial = serializeGemCadAsc(partialDocument);
  const partialTiers = parseGemCadAsc(partial.text).tiers;

  assert.equal(partial.summary.storedFacetCount, 5);
  assert.equal(partial.summary.effectiveFacetCount, 4);
  assert.equal(partial.summary.omittedFacetCount, 1);
  assert.equal(partial.summary.facetCount, 4);
  assert.deepEqual(partialTiers.find((tier) => tier.name === "OLD").indexTokens, ["24", "48", "72"]);
  assert.deepEqual(partialTiers.find((tier) => tier.name === "NEW").indexTokens, ["96"]);
  assert.match(
    partial.diagnostics.find((item) => item.code === "OVERWRITTEN_FACETS_OMITTED").message,
    /1 条刻面记录/,
  );
  assert.equal(JSON.parse(exportFacetingJSON(partialDocument)).facets.length, 5);

  const fullyCoveredDocument = createFacetingDocument({
    name: "Covered operation",
    facets: [
      ...resolveFacetPattern({
        patternId: "fully-old", label: "OLD", region: "crown", baseIndex: 0,
        repeat: 1, mirror: 0, industryAngleDeg: 32, depth: 0.2,
      }),
      ...resolveFacetPattern({
        patternId: "fully-new", label: "NEW", region: "crown", baseIndex: 0,
        repeat: 1, mirror: 0, industryAngleDeg: 32, depth: 0.4,
      }),
    ],
  });
  const fullyCovered = serializeGemCadAsc(fullyCoveredDocument);

  assert.equal(fullyCovered.summary.tierCount, 1);
  assert.deepEqual(parseGemCadAsc(fullyCovered.text).tiers.map((tier) => tier.name), ["NEW"]);
});

test("ASC document replacement is one undoable command and remains JSON-compatible", async () => {
  const imported = inspectGemCadAsc(await readFile(fixtureUrl, "utf8")).document;
  const initial = createFacetingDocument({ name: "Before ASC" });
  const history = executeFacetingCommand(
    createCommandHistory(initial),
    createReplaceDocumentCommand(imported, { description: "Import ASC fixture" }),
  );
  assert.equal(history.commands.length, 1);
  assert.equal(history.present.name, "Astryx Star- Gautam Popli");
  assert.deepEqual(undoFacetingCommand(history).present, initial);
  assert.deepEqual(importFacetingJSON(exportFacetingJSON(imported)), imported);
});

test("ASC preflight warns about edge and dual intent and preform labels while preserving explicit planes", async () => {
  const { enumerateTopologyEdges, createEdgeMeetTarget } = await import("./meetJump.js");
  const edge = enumerateTopologyEdges(createCenteredCube(2, { sourceOperationId: "rough-cube" }))[0];
  for (const type of ["edge-meet", "dual-meet"]) {
    const construction = { type, solverVersion: 2, primaryIndex: 6, target: createEdgeMeetTarget(edge, 0.5),
      ...(type === "dual-meet" ? { secondTarget: edge.endpoints[0] } : {}) };
    const facets = resolveFacetPattern({ patternId: "meet", region: "crown", baseIndex: 6, repeat: 4, industryAngleDeg: 32, depth: 0.42,
      metadata: { patternMode: "symmetric", construction, preform: true } });
    const result = serializeGemCadAsc(createFacetingDocument({ facets }));
    assert.ok(result.diagnostics.some((item) => item.code === "MEET_CONSTRUCTION_OMITTED"));
    assert.ok(result.diagnostics.some((item) => item.code === "PREFORM_PURPOSE_OMITTED"));
  }
});
