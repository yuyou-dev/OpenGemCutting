import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { GCS_FROST_ALPHA, readGcsDesign, writeGcsDesign } from "./gcs.js";
import { designFromDocument, sameShape } from "./planeDesign.js";
import { readAscDesign, writeAscDesign } from "../gemcadAsc.js";
import { importFacetingJSON } from "../faceting.js";

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const codes = (diagnostics) => diagnostics.map((item) => item.code);
const directions = (design) => new Set(design.tiers.filter((tier) => !tier.hidden && !tier.table)
  .flatMap((tier) => tier.entries.map((entry) => `${tier.region}:${Math.abs(tier.angle).toFixed(2)}:${(entry.index % design.gear).toFixed(4)}`)));

test("a real Gem Cut Studio 1.1 save reads with calibrated directions, frost and labels", async () => {
  const read = readGcsDesign(await fixture("gcs-1.1-resaved.gcs"));
  assert.equal(read.design.gear, 96);
  assert.equal(read.summary.facetCount, 57);
  assert.equal(read.summary.frostedCount, 1);
  assert.equal(read.design.tiers.filter((tier) => tier.table).length, 1);
  assert.ok(!codes(read.diagnostics).includes("GCS_INDEX_LABEL_MISMATCH"), "labels agree with normals under the calibrated convention");
  const frosted = read.design.tiers.flatMap((tier) => tier.entries).find((entry) => entry.finish);
  assert.deepEqual(frosted.finish, { version: 1, model: "ggx-dielectric", state: "frosted", alpha: GCS_FROST_ALPHA });
  assert.deepEqual(frosted.gcs, { frosting: "0.5" });

  // The save started from preset 100058: every facet direction must match it.
  const preset = importFacetingJSON(await readFile(new URL("../../../public/presets/documents/100058-pc-07-001c-square-emerald-1-4.json", import.meta.url), "utf8"));
  assert.deepEqual([...directions(read.design)].sort(), [...directions(designFromDocument(preset).design)].sort());
});

test("an angle edited in Gem Cut Studio is read from the saved normal", async () => {
  const read = readGcsDesign(await fixture("gcs-1.1-edited.gcs"));
  const edited = read.design.tiers.find((tier) => tier.entries.some((entry) => entry.finish));
  assert.equal(edited.angle, 39);
  assert.equal(read.status === "error", false);
});

test("GCS write and read back keeps the shape, frost values, labels and hidden tiers", async () => {
  const source = await fixture("gcs-1.1-resaved.gcs");
  const hiddenSource = source.replace(/(name="T14" instructions="" visible=")true"/, "$1false\"");
  assert.notEqual(hiddenSource, source);
  const read = readGcsDesign(hiddenSource);
  assert.ok(codes(read.diagnostics).includes("GCS_HIDDEN_TIERS"));
  const written = writeGcsDesign(read.design, { diagnostics: [] });
  assert.equal(written.status === "error", false);
  assert.match(written.text, /visible="false"/);
  assert.match(written.text, /frosting="0.5"/);
  const back = readGcsDesign(written.text);
  assert.ok(sameShape(read.design, back.design));
  assert.equal(back.summary.frostedCount, 1);
  assert.equal(back.summary.hiddenTierCount, 1);
  assert.ok(!codes(back.diagnostics).includes("GCS_INDEX_LABEL_MISMATCH"));
  assert.ok(codes(written.diagnostics).includes("GCS_FROST_ON_OFF"));

  const asc = writeAscDesign(read.design, { diagnostics: [] });
  assert.ok(codes(asc.diagnostics).includes("HIDDEN_TIERS_OMITTED"));
  assert.ok(codes(asc.diagnostics).includes("FROSTED_FINISH_OMITTED"));
  assert.ok(codes(asc.diagnostics).includes("GCS_RENDER_OMITTED"));
});

test("GemCad designs convert to GCS with GemCad indices kept on the crown and reversed on the pavilion", () => {
  const { design } = readAscDesign([
    "GemCad 5.0", "g96 0.0", "y 1 n", "I 1.54",
    "a -41.000000 0.60000000 3 n P1",
    "a 90.000000 1.00000000 3 27 51 75 n G1",
    "a 35.000000 0.78000000 3 27 51 75 n C1",
    "a -41.000000 0.60000000 27 51 75 n P2",
    "a 0.000000 0.52000000 96 n T",
  ].join("\n"));
  const written = writeGcsDesign(design, { diagnostics: [] });
  const labels = [...written.text.matchAll(/<tier angle="([\d.]+)"[\s\S]*?<\/tier>/g)].map(([tier, angle]) => [Number(angle), [...tier.matchAll(/index_angle="([\d.]+)"/g)].map((match) => Number(match[1]))]);
  // Index 3 of 96 is 11.25°: crown label 11.25, pavilion and girdle 348.75.
  assert.deepEqual(labels.find(([angle]) => angle === 35)[1].sort((a, b) => a - b), [11.25, 101.25, 191.25, 281.25]);
  assert.deepEqual(labels.find(([angle]) => angle === 139)[1], [348.75]);
  assert.deepEqual(labels.find(([angle]) => angle === 90)[1].sort((a, b) => a - b), [78.75, 168.75, 258.75, 348.75]);
  assert.ok(sameShape(design, readGcsDesign(written.text).design));
});

test("a twisted design keeps its GemCad crown indices, as checked in Gem Cut Studio 1.1", () => {
  // Opened in Gem Cut Studio 1.1 beside its own import of the same ASC: both
  // listed C1 02-14-26…86 and C2 09-21-33…93 and rendered identically.
  const { design } = readAscDesign(["GemCad 5.0", "g96 0.0", "y 8 n", "I 1.54",
    "a -41.000000 0.60000000 96 n P1 12 24 36 48 60 72 84", "a -39.000000 0.61500000 6 n P2 18 30 42 54 66 78 90",
    "a 90.000000 1.00000000 96 n G 12 24 36 48 60 72 84", "a 90.000000 1.02000000 6 n G2 18 30 42 54 66 78 90",
    "a 40.000000 0.79000000 2 n C1 14 26 38 50 62 74 86", "a 24.000000 0.64000000 9 n C2 21 33 45 57 69 81 93",
    "a 0.000000 0.52000000 96 n T"].join("\n"));
  const written = writeGcsDesign(design, { diagnostics: [] });
  assert.equal(written.status, "ready");
  const crown = (angle) => [...written.text.matchAll(new RegExp(`<tier angle="${angle}"[\\s\\S]*?</tier>`, "g"))]
    .flatMap(([tier]) => [...tier.matchAll(/index_angle="([\d.]+)"/g)].map((match) => Number(match[1]) * 96 / 360)).sort((a, b) => a - b);
  assert.deepEqual(crown(40), [2, 14, 26, 38, 50, 62, 74, 86]);
  assert.deepEqual(crown(24), [9, 21, 33, 45, 57, 69, 81, 93]);
  assert.ok(sameShape(design, readGcsDesign(written.text).design));
});

test("labels that disagree with their normals are reported and the normals win", async () => {
  const text = (await fixture("gcs-1.1-resaved.gcs")).replace('index_angle="90">', 'index_angle="45">');
  const read = readGcsDesign(text);
  assert.ok(codes(read.diagnostics).includes("GCS_INDEX_LABEL_MISMATCH"));
  assert.ok(sameShape(read.design, readGcsDesign(await fixture("gcs-1.1-resaved.gcs")).design));
});

test("open designs cannot be written to GCS, and malformed files are refused", () => {
  const open = readAscDesign("GemCad 5.0\ng96 0.0\nI 1.54\na 0 1 0\n").design;
  const written = writeGcsDesign(open, { diagnostics: [] });
  assert.equal(written.status, "error");
  assert.ok(codes(written.diagnostics).includes("GCS_OPEN_DESIGN"));
  assert.throws(() => readGcsDesign("<Other/>"), { code: "GCS_ROOT" });
  assert.throws(() => readGcsDesign("<GemCutStudio version=\"1000\"><index gear=\"96\"/></GemCutStudio>"), { code: "GCS_NO_TIERS" });
  for (const bad of ["NaN", "Infinity", "1e9999", "0x10"]) {
    assert.throws(() => readGcsDesign(`<GemCutStudio version="1000"><index gear="96"/><tier angle="0" depth="1"><facet nx="${bad}" ny="0" nz="1"/></tier></GemCutStudio>`), { code: /INVALID_NUMBER|NUMBER_RANGE/ });
  }
});
