import test from "node:test";
import assert from "node:assert/strict";

import { createWorkbenchDocument, ensureTableFacet } from "./document.js";
import { validateFacetingDocument } from "./faceting.js";

test("default document starts from a centered 2.000 cube stock and passes validation", () => {
  const document = createWorkbenchDocument("默认切型");

  assert.equal(document.name, "默认切型");
  assert.equal(document.stock.kind, "cube");
  assert.equal(document.stock.size, 2);
  assert.deepEqual(document.stock.center, [0, 0, 0]);
  assert.deepEqual(validateFacetingDocument(document), { valid: true, errors: [] });
});

test("fixed T1 table leads the stack with a locked 0° angle and table flags", () => {
  const document = createWorkbenchDocument();
  const table = document.facets[0];

  assert.equal(table.patternId, "table-facet");
  assert.equal(table.label, "T1 台面");
  assert.equal(table.region, "crown");
  assert.equal(table.baseIndex, 0);
  assert.equal(table.repeat, 1);
  assert.equal(table.mirror, 0);
  assert.equal(table.industryAngleDeg, 0);
  assert.equal(table.depth, 0.2);
  assert.equal(table.metadata.operationType, "table");
  assert.equal(table.metadata.fixedAngle, true);
  assert.equal(table.metadata.patternMode, "symmetric");
  assert.equal(
    document.facets.filter((facet) => facet.metadata?.operationType === "table").length,
    1,
  );
});

test("default G1 girdle preform resolves 32 facets at 90° and depth 0.2", () => {
  const document = createWorkbenchDocument();
  const girdle = document.facets.filter((facet) => facet.patternId === "girdle-preform");

  assert.equal(document.facets.length, 33);
  assert.equal(girdle.length, 32);
  assert.ok(girdle.every((facet) => facet.region === "girdle"));
  assert.ok(girdle.every((facet) => facet.label === "G1 腰部"));
  assert.ok(girdle.every((facet) => facet.repeat === 32));
  assert.ok(girdle.every((facet) => facet.mirror === 0));
  assert.ok(girdle.every((facet) => facet.industryAngleDeg === 90));
  assert.ok(girdle.every((facet) => facet.depth === 0.2));
  assert.deepEqual(
    [...girdle.map((facet) => facet.index)].sort((a, b) => a - b),
    Array.from({ length: 32 }, (_, ordinal) => ordinal * 3),
  );
});

test("ensureTableFacet restores a missing fixed table at the front exactly once", () => {
  const document = createWorkbenchDocument();
  assert.equal(ensureTableFacet(document), document);

  const withoutTable = {
    ...document,
    facets: document.facets.filter((facet) => facet.patternId !== "table-facet"),
  };
  const restored = ensureTableFacet(withoutTable);

  assert.equal(restored.facets.length, document.facets.length);
  assert.equal(restored.facets[0].metadata.operationType, "table");
  assert.equal(
    restored.facets.filter((facet) => facet.metadata?.operationType === "table").length,
    1,
  );
  assert.deepEqual(restored.facets.slice(1), withoutTable.facets);
});
