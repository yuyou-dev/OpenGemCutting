import assert from "node:assert/strict";
import test from "node:test";
import { physicalMeasures } from "./physicalScale.js";

const cube = [
  { x: -1, y: -0.5, z: 0 }, { x: 1, y: 0.5, z: 0.25 },
];

test("physical measures scale lengths and volume by the document's millimetre scale", () => {
  const document = { metadata: { physicalScale: { millimetersPerModelUnit: 3 } } };
  const measures = physicalMeasures(document, { vertices: cube, volume: 0.5 });
  assert.deepEqual(measures.size, { x: 6, y: 3, z: 0.75 });
  assert.equal(measures.volume, 13.5);
  assert.equal(measures.millimetersPerModelUnit, 3);
});

test("physical measures are absent without a scale, never guessed", () => {
  assert.equal(physicalMeasures({ metadata: {} }, { vertices: cube, volume: 0.5 }), null);
  assert.equal(physicalMeasures({}, { vertices: cube, volume: 0.5 }), null);
});

test("the legacy stock source scale is honoured", () => {
  const document = { stock: { source: { millimetersPerModelUnit: 2 } } };
  assert.equal(physicalMeasures(document, { vertices: cube, volume: 1 }).volume, 8);
});
