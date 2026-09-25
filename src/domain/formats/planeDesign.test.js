import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { designFromDocument, documentFromDesign, planeDesignSolid, sameShape } from "./planeDesign.js";
import { CONCEPTS } from "./capabilities.js";
import { readAscDesign } from "../gemcadAsc.js";
import { evaluateDocument } from "../documentGeometry.js";
import { summarizeEffectiveFacets } from "../meetJump.js";

const asc = (...tiers) => readAscDesign(["GemCad 5.0", "g96 0.0", "y 1 n", "I 1.54", ...tiers].join("\n")).design;
const sixteen = "3 9 15 21 27 33 39 45 51 57 63 69 75 81 87 93";

test("opening a design keeps the whole stone inside the stock, with every facet a real cut", () => {
  // A 16-sided girdle at the stock radius: its corners reach past the cube.
  const design = asc(`a -41 0.6 ${sixteen} n P`, `a 90 1 ${sixteen} n G`, `a 35 0.78 ${sixteen} n C`, "a 0 0.52 96 n T");
  const opened = documentFromDesign(design);
  assert.ok(!opened.diagnostics.some((item) => item.code === "ROUGH_STOCK_REMAINS"));
  const solid = evaluateDocument(opened.document);
  assert.equal(summarizeEffectiveFacets(solid).effectiveFacetIds.length, 49);
  assert.ok(sameShape(design, designFromDocument(opened.document).design));

  // Gem Cut Studio stores girdles at exactly half width 1 on the cube axes.
  const square = asc("a -41 0.6 96 24 48 72 n P", "a 90 1 96 24 48 72 n G", "a 35 0.78 96 24 48 72 n C", "a 0 0.52 96 n T");
  const squareSolid = evaluateDocument(documentFromDesign(square).document);
  assert.ok(!squareSolid.faces.some((face) => face.sourceOperationId === "rough-cube"));
});

test("steep closed designs are not mistaken for open ones", () => {
  const steep = asc(`a -86 0.2 ${sixteen} n P`, `a 90 1 ${sixteen} n G`, `a 35 0.78 ${sixteen} n C`, "a 0 0.52 96 n T");
  assert.equal(planeDesignSolid(steep).open, false);
  assert.equal(planeDesignSolid(asc("a 0 1 0")).open, true);
});

test("shape comparison ignores recentring and scale but not a changed plane", () => {
  const design = asc(`a -41 0.6 ${sixteen} n P`, `a 90 1 ${sixteen} n G`, "a 35 0.78 3 n C", "a 0 0.52 96 n T");
  const scaled = structuredClone(design);
  scaled.tiers.forEach((tier) => { tier.distance *= 3; });
  assert.ok(sameShape(design, scaled));
  const changed = structuredClone(design);
  changed.tiers[2].distance *= 0.97;
  assert.equal(sameShape(design, changed), false);
});

test("every loss the page promises is a diagnostic some writer really emits", async () => {
  const sources = (await Promise.all(["./planeDesign.js", "./gcs.js", "../gemcadAsc.js"]
    .map((path) => readFile(new URL(path, import.meta.url), "utf8")))).join("\n");
  for (const concept of CONCEPTS) {
    for (const code of Object.values(concept.codes ?? {}).flat()) {
      assert.match(sources, new RegExp(`"${code}"`), `${concept.id} lists ${code}, which no writer emits`);
    }
    for (const [format, support] of Object.entries(concept.support)) {
      if (["asc", "gcs"].includes(format) && ["lose", "approx", "block"].includes(support)) {
        assert.ok(Object.values(concept.codes ?? {}).flat().length, `${concept.id} is ${support} in ${format} but has no diagnostic`);
      }
    }
  }
});
