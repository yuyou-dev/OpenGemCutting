import test from "node:test";
import assert from "node:assert/strict";
import { facetNormal } from "../domain/faceting.js";
import { INDEX_GEARS } from "../domain/indexing.js";
import { indexRingLayout, ringPoint } from "./viewportIndexRing.js";

test("fractional ring positions stay aligned with cut normals for every supported gear", () => {
  for (const indexTeeth of INDEX_GEARS) {
    const baseIndex = indexTeeth / 5;
    const layout = indexRingLayout({ indexTeeth, baseIndex, repeat: 5 });
    assert.equal(layout.rotationIndices.length, 5);
    assert.equal(layout.baseIndex, baseIndex);
    for (const index of layout.rotationIndices) {
      const point = ringPoint([0, 0, 0], 1, index, indexTeeth);
      const normal = facetNormal(index, 0, indexTeeth);
      assert.ok(Math.hypot(point[0] - normal.x, point[1] - normal.y, point[2] - normal.z) < 1e-10);
    }
    const start = ringPoint([1, 2, 3], 2, 0, indexTeeth);
    const end = ringPoint([1, 2, 3], 2, indexTeeth, indexTeeth);
    assert.ok(Math.hypot(...start.map((value, axis) => value - end[axis])) < 1e-10);
  }
});

test("odd wheels retain the exact mirror half-turn and do not round a fractional handle", () => {
  const ring = indexRingLayout({ indexTeeth: 77, baseIndex: 15.4, repeat: 5, mirror: 38.5 });
  assert.equal(ring.baseIndex, 15.4);
  assert.equal(ring.mirror, 38.5);
  assert.equal(ring.mirrorOffsets.at(-1), 38.5);
  assert.ok(ring.mirrorOffsets.every(value => value <= 38.5));
  assert.deepEqual(ring.rotationIndices, ring.mirroredIndices);
  assert.equal(ring.sampleCount, 96);
  const first = ringPoint([0, 0, 0], 1, ring.baseIndex, 77);
  const opposite = ringPoint([0, 0, 0], 1, ring.baseIndex + ring.mirror, 77);
  assert.ok(Math.hypot(first[0] + opposite[0], first[1] + opposite[1]) < 1e-10);
});

test("96 default ring retains its geometry and 360 gear uses all teeth", () => {
  assert.deepEqual(indexRingLayout(), indexRingLayout({ indexTeeth: 96 }));
  const ring = indexRingLayout({ indexTeeth: 360, baseIndex: 360, repeat: 360 });
  assert.equal(ring.baseIndex, 0);
  assert.equal(ring.rotationIndices.length, 360);
  assert.equal(ring.sampleCount, 360);
});
