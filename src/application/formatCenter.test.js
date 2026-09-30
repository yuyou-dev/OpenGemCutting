import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFormatFile, inspectFormatFile, inspectProjectSource, planTarget, planTargets, targetsFor } from "./formatCenter.js";
import { IMPORT_BUDGET } from "../domain/importBudget.js";
import { createFacetingDocument, exportFacetingJSON, importFacetingJSON, resolveFacetPattern } from "../domain/faceting.js";
import { assertValidDocumentGeometry } from "../domain/documentGeometry.js";
import { createCenteredCube } from "../domain/geometry.js";
import { createMeshDocument } from "../domain/stockGeometry.js";

const bytes = (text) => new TextEncoder().encode(text);
const fixture = async (name) => new Uint8Array(await readFile(new URL(`../domain/formats/fixtures/${name}`, import.meta.url)));
const preset = async () => importFacetingJSON(await readFile(new URL("../../public/presets/documents/100058-pc-07-001c-square-emerald-1-4.json", import.meta.url), "utf8"));
const labels = (items) => items.map((item) => item.id);

test("source counts use final CUT faces even when mesh exports are blocked or frosted cuts are covered", () => {
  const cut = (id, depth, frosted = false) => resolveFacetPattern({ patternId: id, region: 'crown',
    industryAngleDeg: 0, depth, repeat: 1, baseIndex: 0,
    ...(frosted ? { metadata: { surfaceFinish: { version: 1, model: 'ggx-dielectric', state: 'frosted', alpha: 0.25 } } } : {}),
  });
  const mesh = createFacetingDocument({ ...createMeshDocument({ mesh: createCenteredCube(2) }), facets: cut('top', 0.3, true) });
  const source = inspectProjectSource(mesh);
  assert.equal(source.summary.effectiveFacetCount, 1);
  assert.equal(source.summary.tierCount, 1);
  assert.equal(source.summary.frostedCount, 1);
  assert.equal(planTarget(source, 'gcs').outcome, 'blocked');
  const covered = inspectProjectSource(createFacetingDocument({ facets: [...cut('old', 0.2, true), ...cut('new', 0.4)] }));
  assert.equal(covered.summary.storedFacetCount, 2);
  assert.equal(covered.summary.effectiveFacetCount, 1);
  assert.equal(covered.summary.frostedCount, 0);
});

test("file reading checks the byte budget before I/O and reports read failures without a destination", async () => {
  let reads = 0;
  const oversized = await readFormatFile({ name: "large.gcs", size: IMPORT_BUDGET.bytes + 1,
    arrayBuffer() { reads++; throw new Error("must not read"); } });
  assert.equal(reads, 0);
  assert.equal(oversized.status, "error");
  assert.match(oversized.diagnostics[0].message, /20 MiB/);
  assert.deepEqual(targetsFor(oversized), []);
  const failed = await readFormatFile({ name: "unreadable.gcs", size: 10,
    async arrayBuffer() { throw new Error("read denied"); } });
  assert.equal(failed.status, "error");
  assert.match(failed.diagnostics[0].message, /read denied/);
  assert.deepEqual(targetsFor(failed), []);
  const data = await fixture("gcs-1.1-resaved.gcs");
  const valid = await readFormatFile(new File([data], "square.gcs"));
  assert.equal(valid.format, "gcs");
  assert.notEqual(valid.status, "error");
});

test("files are recognised by content, and each offers only real destinations", async () => {
  const gcs = inspectFormatFile(await fixture("gcs-1.1-resaved.gcs"), "square.asc");
  assert.equal(gcs.format, "gcs");
  assert.ok(gcs.diagnostics.some((item) => item.code === "EXTENSION_MISMATCH"));
  assert.deepEqual(targetsFor(gcs), ["workbench", "asc", "json"]);
  const unknown = inspectFormatFile(bytes("hello"), "notes.txt");
  assert.equal(unknown.status, "error");
  assert.deepEqual(targetsFor(unknown), []);
  const hostile = inspectFormatFile(bytes("<!DOCTYPE GemCutStudio><GemCutStudio/>"), "x.gcs");
  assert.equal(hostile.diagnostics[0].code, "XML_DTD_FORBIDDEN");
  const project = inspectProjectSource(await preset());
  assert.deepEqual(targetsFor(project), ["asc", "gcs"]);
});

test("a Gem Cut Studio file reports frost and render losses for ASC and opens in the workbench", async () => {
  const source = inspectFormatFile(await fixture("gcs-1.1-resaved.gcs"), "square.gcs");
  const plans = planTargets(source);
  assert.equal(plans.asc.outcome, "lossy");
  assert.deepEqual(labels(plans.asc.report.lost), ["frost", "gcsRender"]);
  assert.equal(plans.asc.verified, true);
  assert.match(plans.asc.text, /^GemCad 5\.0/);
  assert.equal(plans.workbench.outcome, "complete");
  assertValidDocumentGeometry(plans.workbench.document);
  const frosted = plans.workbench.document.facets.filter((facet) => facet.metadata.surfaceFinish?.state === "frosted");
  assert.equal(frosted.length, 1);
  assert.deepEqual(frosted[0].metadata.gcs, { frosting: "0.5" });
  assert.equal(JSON.parse(plans.json.text).facets.length, 57);

  // Round trip through the workbench document back to GCS keeps the file's frost value.
  const reopened = planTarget(inspectProjectSource(plans.workbench.document), "gcs");
  assert.equal(reopened.verified, true);
  assert.match(reopened.text, /frosting="0.5"/);
});

test("a tableless GemCad design converts directly but cannot open in the workbench", async () => {
  const source = inspectFormatFile(await fixture("smallest-square.asc"), "smallest-square.asc");
  assert.ok(source.present.has("tableless"));
  const plans = planTargets(source);
  assert.equal(plans.workbench.outcome, "blocked");
  assert.equal(plans.json.outcome, "blocked");
  assert.equal(plans.gcs.verified, true);
  assert.notEqual(plans.gcs.outcome, "blocked");
});

test("project exports name frost as lost in ASC and simplified in GCS, and block concave cuts", async () => {
  const document = await preset();
  document.facets = document.facets.map((facet, index) => (index === 5
    ? { ...facet, metadata: { ...facet.metadata, surfaceFinish: { version: 1, model: "ggx-dielectric", state: "frosted", alpha: 0.4 } } }
    : facet));
  const plans = planTargets(inspectProjectSource(createFacetingDocument(document)));
  assert.ok(labels(plans.asc.report.lost).includes("frost"));
  assert.ok(labels(plans.gcs.report.approximate).includes("frost"));
  assert.ok(plans.asc.verified && plans.gcs.verified);
  assert.ok(!plans.asc.diagnostics.some((item) => item.code === "EDITOR_STATE_OMITTED"), "editor-state notices stay out of the designer report");

  const tool = { id: "dimple", type: "sphere", position: [0.9, 0, 0], radius: 0.3 };
  const concave = planTargets(inspectProjectSource(createFacetingDocument({ ...document, concaveCuts: [tool] })));
  for (const plan of [concave.asc, concave.gcs]) {
    assert.equal(plan.outcome, "blocked");
    assert.deepEqual(labels(plan.report.blocked), ["concave"]);
    assert.equal(plan.text, "");
  }
});

test("a saved project file is a source like the open project", async () => {
  const source = inspectFormatFile(bytes(exportFacetingJSON(await preset())), "emerald.json");
  assert.equal(source.format, "json");
  assert.deepEqual(targetsFor(source), ["workbench", "asc", "gcs"]);
  assert.equal(planTarget(source, "workbench").outcome, "complete");
});

test("an arc ring layer with several depths exports as consecutive tiers that read back to the same stone", async () => {
  const { planDesign } = await import("./designOperations.js");
  const ring = { kind: "arc", symmetry: 4, subdivisions: 3, bulge: 0.6, rotation: 0 };
  const { document } = planDesign(await preset(), [{ kind: "cut", patternId: "arc", label: "A1 弧切", region: "girdle", draft: { industryAngle: 90, depth: 0.5, ring } }]);
  const plans = planTargets(inspectProjectSource(document));
  for (const plan of [plans.asc, plans.gcs]) {
    assert.equal(plan.verified, true);
    assert.ok(labels(plan.report.approximate).includes("ringLevels"));
    assert.ok(plan.diagnostics.some((item) => item.code === "LAYER_SPLIT_BY_DEPTH"));
  }
  const tiers = plans.asc.text.split("\r\n").filter((line) => /^a 90\.0+ /.test(line));
  assert.equal(tiers.length, 2, tiers.join("\n"));
  assert.ok(Number(tiers[0].split(" ")[2]) > Number(tiers[1].split(" ")[2]), "the primary level is written first");
});
