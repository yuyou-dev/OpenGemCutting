import test from "node:test";
import assert from "node:assert/strict";
import { readGemDesign } from "./gem.js";
import { planeDesignSolid, sameShape, tierNormal } from "./planeDesign.js";
import { readAscDesign } from "../gemcadAsc.js";

// Test-only encoder following the layout documented in gem.js. Real .gem
// designs by third parties are not committed.
function encodeGem(design, { gear = design.gear, location = 0, preform = false, trailerMarker = 0xc0f869f0 } = {}) {
  const chunks = [];
  const i32 = (value) => { const buffer = new DataView(new ArrayBuffer(4)); buffer.setInt32(0, value, true); chunks.push(new Uint8Array(buffer.buffer)); };
  const u32 = (value) => { const buffer = new DataView(new ArrayBuffer(4)); buffer.setUint32(0, value, true); chunks.push(new Uint8Array(buffer.buffer)); };
  const f64 = (value) => { const buffer = new DataView(new ArrayBuffer(8)); buffer.setFloat64(0, value, true); chunks.push(new Uint8Array(buffer.buffer)); };
  const text = (value) => { const bytes = new TextEncoder().encode(value); chunks.push(Uint8Array.of(bytes.length), bytes); };
  design.tiers.forEach((tier, tierIndex) => tier.entries.forEach((entry, entryIndex) => {
    const normal = tierNormal(tier, entry.index, design.gear);
    const distance = Math.abs(tier.distance);
    // GemCad's frame swaps X and Y relative to this project.
    f64(normal.y / distance); f64(normal.x / distance); f64(normal.z / distance);
    i32(tierIndex + 1);
    text(`${entryIndex === 0 ? tier.name : ""}\t${entryIndex === 0 ? tier.instructions : ""}`);
    i32(1);
    f64(0); f64(0); f64(0); i32(1);
    f64(0); f64(0); f64(1); i32(0);
  }));
  i32(0); u32(trailerMarker); i32(design.symmetry ?? 1); i32(design.mirror ? 1 : 0); i32(gear);
  f64(design.refractiveIndex); u32(0x7fff); f64(location);
  design.headings.forEach(text);
  text(" ");
  design.footnotes.forEach(text);
  if (preform) text("preform");
  chunks.push(Uint8Array.of(0, 0, 0, 0, 0));
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

const ROUND = readAscDesign([
  "GemCad 5.0", "g96 0.0", "y 8 y", "I 1.76",
  "H Test Round", "H by the test suite",
  "a -41.000000 0.60000000 3 9 15 21 27 33 39 45 51 57 63 69 75 81 87 93 n P1 G Cut to center",
  "a -90.000000 1.00000000 3 9 15 21 27 33 39 45 51 57 63 69 75 81 87 93 n G",
  "a 35.000000 0.78000000 3 9 15 21 27 33 39 45 51 57 63 69 75 81 87 93 n C1",
  "a 0.000000 0.52000000 96 n T",
  "F A footnote",
].join("\n")).design;

test("a GemCad .gem file reads into the same stone as its ASC", () => {
  const read = readGemDesign(encodeGem(ROUND), { fileName: "round.gem" });
  assert.equal(read.status, "ready");
  assert.ok(sameShape(read.design, ROUND));
  assert.equal(read.design.name, "Test Round");
  assert.deepEqual(read.design.headings, ["Test Round", "by the test suite"]);
  assert.deepEqual(read.design.footnotes, ["A footnote"]);
  assert.equal(read.design.symmetry, 8);
  assert.equal(read.design.mirror, true);
  assert.equal(read.design.refractiveIndex, 1.76);
  assert.deepEqual(read.design.tiers.map((tier) => tier.name), ["P1", "G", "C1", "T"]);
  assert.equal(read.design.tiers[0].instructions, "Cut to center");
  assert.deepEqual(read.design.tiers[0].entries.map((entry) => entry.index), ROUND.tiers[0].entries.map((entry) => entry.index));
  assert.equal(read.design.tiers.filter((tier) => tier.table).length, 1);
  assert.equal(planeDesignSolid(read.design).open, false);
});

test("a reversed gear with a location reports the offset and keeps the geometry", () => {
  const read = readGemDesign(encodeGem(ROUND, { gear: -96, location: 48 }));
  assert.ok(read.diagnostics.some((item) => item.code === "GEAR_OFFSET_APPLIED"));
  assert.ok(sameShape(read.design, ROUND));
  assert.equal(read.design.gear, 96);
});

test("preforms, truncation and unrelated binaries are refused without a design", () => {
  assert.throws(() => readGemDesign(encodeGem(ROUND, { preform: true })), { code: "UNSUPPORTED_PREFORM" });
  const bytes = encodeGem(ROUND);
  assert.throws(() => readGemDesign(bytes.subarray(0, 100)), { code: /GEM_TRUNCATED|GEM_NO_TRAILER/ });
  assert.throws(() => readGemDesign(new Uint8Array(4096).fill(7)), { code: /GEM_/ });
  const nan = bytes.slice();
  new DataView(nan.buffer).setFloat64(0, Number.NaN, true);
  assert.throws(() => readGemDesign(nan), { code: "GEM_INVALID_NUMBER" });
});
