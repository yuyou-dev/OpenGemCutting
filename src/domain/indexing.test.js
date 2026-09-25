import test from "node:test";
import assert from "node:assert/strict";
import { INDEX_GEARS, indexToAzimuth, azimuthToIndex, facetIndexForGear, indexCompatibilityReport } from "./indexing.js";
import { createFacetingDocument, resolveFacetPattern, createCommandHistory, createAddFacetsCommand,
  executeFacetingCommand, undoFacetingCommand, redoFacetingCommand, exportFacetingJSON, importFacetingJSON,
  generateFacetIndices, normalizeIndex, normalizeDocumentSchema, validateFacetingDocument, rotateFacetsByTeeth,
} from "./faceting.js";

function tier(overrides = {}) {
  return resolveFacetPattern({ patternId: "fivefold", region: "crown", industryAngleDeg: 35,
    depth: 0.3, repeat: 5, baseIndex: 0, ...overrides });
}

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("all listed wheels preserve fractional azimuth and true fivefold geometry", () => {
  assert.deepEqual(INDEX_GEARS, [32, 64, 72, 77, 80, 84, 88, 96, 99, 120, 360]);
  const expected = tier();
  for (const teeth of INDEX_GEARS) {
    const facets = tier({ indexTeeth: teeth });
    assert.equal(facets.length, 5);
    facets.forEach((facet, index) => assert.deepEqual(facet.plane, expected[index].plane));
    close(indexToAzimuth(azimuthToIndex(127.123456, teeth), teeth), 127.123456);
    close(normalizeIndex(-0.25, teeth), teeth - 0.25);
    const document = createFacetingDocument({ indexGear: teeth, facets });
    assert.equal(document.schemaVersion, 3);
    assert.deepEqual(importFacetingJSON(exportFacetingJSON(document)), document);
  }
});

test("arbitrary fold counts never gain phantom mirror faces from floating point arithmetic", () => {
  for (const teeth of [77, 96, 120, 360]) {
    for (let repeat = 1; repeat <= 360; repeat += 1) {
      assert.equal(generateFacetIndices({ indexTeeth: teeth, baseIndex: 3.25, repeat }).length, repeat,
        `${teeth}-wheel ${repeat}-fold`);
    }
  }
});

test("compatibility is computed from plane normals and exempts horizontal planes", () => {
  const facets = tier({ indexTeeth: 120 });
  const table = tier({ patternId: "table", repeat: 1, industryAngleDeg: 0, baseIndex: 2.7 });
  const reports = indexCompatibilityReport([...facets, ...table]);
  assert.equal(reports.find((row) => row.teeth === 96).compatible, false);
  for (const teeth of [80, 120, 360]) assert.equal(reports.find((row) => row.teeth === teeth).compatible, true);
  assert.equal(reports[0].exemptCount, 1);
  assert.equal(facetIndexForGear(table[0], 96), null);
  // Deliberately stale index metadata cannot manufacture a false pass.
  assert.equal(indexCompatibilityReport(facets.map((facet) => ({ ...facet, index: 0 })), { gears: [96] })[0].compatible, false);
});

test("final compatibility filters by final facet identities and keeps full plan scope separate", () => {
  const facets = tier();
  const zero = facets.find((facet) => facet.index === 0);
  const all = indexCompatibilityReport(facets, { gears: [96] })[0];
  const final = indexCompatibilityReport(facets, { scope: "final", effectiveFacetIds: [zero.id], gears: [96] })[0];
  assert.equal(all.compatible, false);
  assert.equal(final.compatible, true);
  assert.equal(final.checkedCount, 1);
  assert.throws(() => indexCompatibilityReport(facets, { scope: "final" }), /requires/);
});

test("changing authoring gear leaves existing geometry untouched and mixed layers rotate through one angle", () => {
  const facets = [...tier({ patternId: "first", repeat: 8 }), ...tier({ patternId: "second", indexTeeth: 120 })];
  const doc = createFacetingDocument({ facets });
  const switched = createFacetingDocument({ ...doc, indexGear: 360 });
  assert.deepEqual(switched.facets.map(f => f.plane), doc.facets.map(f => f.plane));
  assert.ok(switched.facets.every(f => f.indexTeeth === 360));
  const rotated = rotateFacetsByTeeth(facets, 1, { indexTeeth: 360 });
  rotated.forEach((facet, index) => close((facet.azimuthDeg - facets[index].azimuthDeg + 360) % 360, 1));
  assert.equal(validateFacetingDocument(createFacetingDocument({ facets: rotated })).valid, true);
});

test("legacy document schema stays unchanged; adding extended geometry promotes undoable history", () => {
  const legacy = createFacetingDocument({ facets: tier({ repeat: 8 }) });
  assert.equal(legacy.schemaVersion, 1);
  assert.equal(legacy.concaveCuts, undefined);
  assert.equal(legacy.facets[0].indexTeeth, undefined);
  const history = executeFacetingCommand(createCommandHistory(legacy), createAddFacetsCommand(tier({ patternId: "five" })));
  assert.equal(history.present.schemaVersion, 3);
  assert.deepEqual(history.present.concaveCuts, []);
  assert.deepEqual(undoFacetingCommand(history).present, legacy);
  assert.deepEqual(redoFacetingCommand(undoFacetingCommand(history)).present, history.present);
  const downgraded = { ...history.present, schemaVersion: 1, $schema: legacy.$schema };
  assert.equal(validateFacetingDocument(downgraded).valid, false);
});

test("v3 schema validates one wheel per tier and checks derived normals, aliases and azimuth", () => {
  const document = createFacetingDocument({ indexGear: 120, facets: tier({ indexTeeth: 120 }) });
  for (const key of ["indexTeeth", "index", "azimuthDeg", "displayIndex"]) {
    const corrupt = structuredClone(document);
    corrupt.facets[0][key] += 1;
    assert.equal(validateFacetingDocument(corrupt).valid, false, key);
  }
  for (const value of [null, {}, "bad"]) {
    assert.equal(validateFacetingDocument({ ...document, facets: value }).valid, false);
  }
  assert.equal(normalizeDocumentSchema({ ...document }).schemaVersion, 3);
});

test("independent concave parameters validate and round-trip while legacy cuts remain identical", () => {
  const facets = tier({ repeat: 8 });
  const doc = createFacetingDocument({ facets, concaveCuts: [{ id: "star", type: "sphere", repeat: 5 }] });
  assert.equal(doc.schemaVersion, 3);
  assert.equal(doc.concaveCuts[0].repeat, 5);
  assert.deepEqual(doc.facets, facets);
  assert.deepEqual(importFacetingJSON(exportFacetingJSON(doc)), doc);
  assert.equal(validateFacetingDocument({ ...doc, concaveCuts: [{ id: "invalid", radius: -1 }] }).valid, false);
  assert.equal(validateFacetingDocument({ ...doc, concaveCuts: [doc.concaveCuts[0], doc.concaveCuts[0]] }).valid, false);
});

test("history retains immutable stock and concave references across planar changes", () => {
  const document = createFacetingDocument({ concaveCuts: [{ id: "sphere" }] });
  const initial = createCommandHistory(document);
  const next = executeFacetingCommand(initial, createAddFacetsCommand(tier()));
  assert.equal(initial.present.stock, document.stock);
  assert.equal(initial.present.concaveCuts, document.concaveCuts);
  assert.equal(next.present.stock, initial.present.stock);
  assert.equal(next.present.concaveCuts, initial.present.concaveCuts);
  assert.equal(Object.isFrozen(next.present.concaveCuts), true);
  assert.equal(Object.isFrozen(next.present.stock), true);
  assert.equal(undoFacetingCommand(next).present.concaveCuts, document.concaveCuts);
});

test("immutable geometry sharing preserves exact serialized field order on JSON import and history replay", () => {
  const document = createFacetingDocument({ indexGear: 120, facets: tier({ indexTeeth: 120 }),
    concaveCuts: [{ id: "tool" }], metadata: { source: "field-order-regression" } });
  for (const input of [document, { facets: document.facets, ...document }]) {
    const serialized = exportFacetingJSON(input);
    assert.equal(exportFacetingJSON(importFacetingJSON(serialized)), serialized);
    assert.equal(exportFacetingJSON(createCommandHistory(input).present), serialized);
    const history = executeFacetingCommand(createCommandHistory(input), createAddFacetsCommand(tier({ patternId: "added" })));
    assert.equal(exportFacetingJSON(undoFacetingCommand(history).present), serialized);
  }
});
