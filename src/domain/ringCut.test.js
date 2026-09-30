import test from "node:test";
import assert from "node:assert/strict";
import { isRingCutParameters, normalizeRingCut, ringCutFromFacets, ringCutLabel, ringCutLayout, ringCutMetadata, ringDissolveLevels, ringDraftPatch, ringCutSketch, ringRatioForIndex } from "./ringCut.js";
import { resolveDraftGeometry } from "./cutConstruction.js";
import { createFacetingDocument, resolveFacet, rotateFacetsByTeeth, validateFacetingDocument } from "./faceting.js";

const layout = (ring, teeth = 96) => ringCutLayout({ rotation: 0, ...ring }, teeth);

test("a triangle cut three times per side snaps to whole teeth, symmetric inside and across sides", () => {
  const result = layout({ symmetry: 3, subdivisions: 3, spacingDeg: 15 });
  assert.deepEqual([...result.indices].sort((a, b) => a - b), [0, 4, 28, 32, 36, 60, 64, 68, 92]);
  assert.deepEqual(result.offsets, [-4, 0, 4]);
  assert.equal(result.primaryIndex, 0);
  assert.equal(result.actualSpacingDeg, 15);
  assert.equal(result.exactSymmetry, true);
});

test("even subdivisions straddle the side normal and the primary is the first facet of side 0", () => {
  const result = layout({ symmetry: 4, subdivisions: 2, spacingDeg: 20, rotation: 0 });
  assert.deepEqual(result.offsets, [-3, 3]);
  assert.equal(result.actualSpacingDeg, 22.5);
  assert.equal(result.primaryIndex, 3);
  assert.equal(result.indices.length, 8);
});

test("rounding keeps offsets identical on every side and reports an inexact wheel division", () => {
  const five = layout({ symmetry: 5, subdivisions: 3, spacingDeg: 10 });
  assert.equal(five.exactSymmetry, false);
  const sides = [0, 19, 38, 58, 77];
  assert.deepEqual([...five.indices].sort((a, b) => a - b), sides.flatMap((c) => [c - 3, c, c + 3]).map((i) => (i + 96) % 96).sort((a, b) => a - b));
  assert.ok(layout({ symmetry: 3, subdivisions: 3, spacingDeg: 15 }, 120).exactSymmetry);
  const tiny = layout({ symmetry: 3, subdivisions: 5, spacingDeg: 0.5 });
  assert.deepEqual(tiny.offsets, [-2, -1, 0, 1, 2], "offsets never collapse onto one tooth");
  const wide = layout({ symmetry: 8, subdivisions: 3, spacingDeg: 30 });
  assert.equal(wide.crossesNeighbours, true);
  const overlap = layout({ symmetry: 12, subdivisions: 3, spacingDeg: 30 });
  assert.ok(overlap.merged > 0, "facets shared by neighbouring sides are merged, not duplicated");
});

test("draft patches rotate the ring by whole teeth and a mode choice leaves the ring", () => {
  const draft = { baseIndex: 0, indexTeeth: 96, ring: { symmetry: 3, subdivisions: 3, spacingDeg: 15, rotation: 0 } };
  const turned = ringDraftPatch(draft, { baseIndex: 5.4 });
  assert.equal(turned.ring.rotation, 5);
  assert.equal(turned.ring.kind, "fan", "saved rings without a kind are fans");
  assert.equal(turned.baseIndex, 5);
  assert.deepEqual(ringDraftPatch(draft, { patternMode: "symmetric" }), { patternMode: "symmetric", ring: null });
  assert.deepEqual(ringDraftPatch({ baseIndex: 0 }, { depth: 0.2 }), { depth: 0.2 });
});

test("saved ring parameters stay editable only while they still describe the facets", () => {
  const ring = { kind: "fan", symmetry: 4, subdivisions: 2, spacingDeg: 20, rotation: 0 };
  const facets = layout(ring).indices.map((index, ordinal) => resolveFacet({
    id: `ring:${index}`, patternId: "ring", ordinal, region: "crown", indexTeeth: 96, baseIndex: index, repeat: 1, mirror: 0,
    index, industryAngleDeg: 30, depth: 0.2, metadata: { patternMode: "arbitrary", ring: ringCutMetadata(ring) },
  }));
  assert.deepEqual(ringCutFromFacets(facets), ring);
  assert.equal(validateFacetingDocument(createFacetingDocument({ facets })).valid, true);
  assert.deepEqual(ringCutFromFacets(rotateFacetsByTeeth(facets, 2)), { ...ring, rotation: 2 });
  assert.equal(ringCutFromFacets(rotateFacetsByTeeth(facets, 0.5)), null, "a half-tooth turn leaves an ordinary layer");
  assert.equal(rotateFacetsByTeeth(facets, 0.5)[0].metadata.ring, undefined);
  assert.equal(ringCutFromFacets(facets.slice(1)), null, "a missing facet leaves an ordinary layer");
  const broken = facets.map((facet) => ({ ...facet, metadata: { ...facet.metadata, ring: { version: 1, symmetry: 1 } } }));
  assert.equal(validateFacetingDocument({ ...createFacetingDocument({ facets }), facets: broken }).valid, false);
  assert.equal(isRingCutParameters({ symmetry: 3, subdivisions: 3, spacingDeg: 15, rotation: 1.5 }), false);
});

const arc = (ring, teeth = 96) => layout({ kind: "arc", ...ring }, teeth);
const sorted = (indices) => [...indices].sort((a, b) => a - b);

test("an arc splits each bulged side into whole-tooth chords with mirrored depth levels", () => {
  const result = arc({ symmetry: 3, subdivisions: 3, bulge: 0.55 });
  assert.deepEqual(sorted(result.indices), [0, 6, 26, 32, 38, 58, 64, 70, 90]);
  assert.equal(result.primaryIndex, 6, "the farthest level of side 0, positive side first");
  assert.deepEqual(result.levels.map((level) => [Number(level.ratio.toFixed(4)), sorted(level.indices)]),
    [[1, [6, 26, 38, 58, 70, 90]], [0.925, [0, 32, 64]]]);
  assert.ok(Object.values(result.ratios).every((ratio) => ratio > 0 && ratio <= 1));
  assert.ok(result.residual < 0.01, "the chord corners sit on the arc within rounding");
  assert.equal(ringCutLabel(result.ring), "弧切 L3×3");
  const turned = arc({ symmetry: 3, subdivisions: 3, bulge: 0.55, rotation: 5 });
  assert.deepEqual(sorted(turned.indices), sorted(result.indices.map((index) => (index + 5) % 96)));
  assert.equal(turned.primaryIndex, 11);
});

test("bulge runs from the straight polygon to a near circle, and L2 needs a lens", () => {
  const straight = arc({ symmetry: 3, subdivisions: 3, bulge: 0 });
  assert.deepEqual(sorted(straight.indices), [0, 32, 64]);
  assert.equal(straight.merged, 6);
  assert.equal(straight.levels.length, 1);
  const round = arc({ symmetry: 3, subdivisions: 3, bulge: 1 });
  assert.equal(round.indices.length, 9);
  assert.ok(round.levels.every((level) => level.ratio > 0.99), "a full circle is nearly one level");
  assert.deepEqual(normalizeRingCut({ kind: "arc", symmetry: 2, subdivisions: 1, bulge: 0, rotation: 0 }, 96),
    { kind: "arc", symmetry: 2, subdivisions: 2, bulge: 0.05, rotation: 0 });
  assert.equal(isRingCutParameters({ kind: "arc", symmetry: 2, subdivisions: 2, bulge: 0.01, rotation: 0 }), false);
  const lens = arc({ symmetry: 2, subdivisions: 3, bulge: 0.5 });
  assert.deepEqual(sorted(lens.indices), [0, 9, 39, 48, 57, 87]);
  assert.equal(lens.degenerate, false);
  const pentagon = arc({ symmetry: 5, subdivisions: 3, bulge: 0.5 });
  assert.equal(pentagon.exactSymmetry, false);
  assert.deepEqual(pentagon.levels.map((level) => level.indices.length), [10, 5]);
});

test("arc drafts give every facet its linked depth and dissolve by level", () => {
  const ring = { kind: "arc", symmetry: 3, subdivisions: 3, bulge: 0.55, rotation: 0 };
  const patch = ringDraftPatch({ baseIndex: 0, indexTeeth: 96 }, { ring });
  assert.equal(patch.baseIndex, 6);
  const draft = { industryAngle: 90, depth: 0.3, indexTeeth: 96, ...patch };
  const { facets, error } = resolveDraftGeometry(draft, "girdle");
  assert.equal(error, "");
  const result = arc(ring);
  for (const facet of facets) {
    const ratio = ringRatioForIndex(result, facet.index, 96);
    assert.ok(Math.abs(facet.plane.offset - ratio * facets.find((item) => item.index === 6).plane.offset) < 1e-9);
  }
  assert.equal(facets.find((facet) => facet.index === 6).depth, 0.3);
  assert.ok(facets.find((facet) => facet.index === 0).depth > 0.3);
  assert.deepEqual(ringDissolveLevels(ring, 96).map(sorted), [[6, 26, 38, 58, 70, 90], [0, 32, 64]]);
  assert.deepEqual(ringDissolveLevels({ kind: "fan", symmetry: 3, subdivisions: 3, spacingDeg: 15, rotation: 0 }, 96).length, 1);
  const stored = facets.map((facet) => ({ ...facet, metadata: { ...facet.metadata, patternMode: "arbitrary", ring: ringCutMetadata(result.ring) } }));
  assert.deepEqual(ringCutFromFacets(stored), result.ring);
  assert.equal(validateFacetingDocument(createFacetingDocument({ facets: stored })).valid, true);
  const turned = rotateFacetsByTeeth(stored, 3);
  assert.deepEqual(ringCutFromFacets(turned), { ...result.ring, rotation: 3 });
  assert.deepEqual(turned.map((facet) => facet.depth), stored.map((facet) => facet.depth), "a whole-tooth turn keeps every linked depth");
});

test("the composer sketch draws the ideal arcs and the outline the snapped facets actually cut", () => {
  const sketch = ringCutSketch({ kind: "arc", symmetry: 3, subdivisions: 3, bulge: 0.55, rotation: 0 }, 96);
  assert.equal(sketch.corners.length, 3);
  assert.ok(sketch.corners.every((point) => Math.abs(Math.hypot(...point) - 1) < 1e-9), "corners sit on the circumcircle");
  assert.equal(sketch.arcs.length, 3);
  assert.equal(sketch.divisions.length, 6);
  assert.equal(sketch.edges.length, 9);
  assert.deepEqual(sketch.edges.filter((edge) => edge.primary).map((edge) => edge.index), [6]);
  assert.deepEqual(sketch.edges.filter((edge) => edge.level === 1).map((edge) => edge.index), [0, 32, 64]);
  sketch.edges.forEach((edge, q) => assert.deepEqual(edge.to, sketch.edges[(q + 1) % 9].from), "a closed outline");
  const fan = ringCutSketch({ kind: "fan", symmetry: 3, subdivisions: 3, spacingDeg: 15, rotation: 0 }, 96);
  assert.deepEqual([fan.arcs.length, fan.divisions.length, fan.edges.length], [0, 0, 9]);
  assert.ok(fan.edges.every((edge) => edge.level === 0), "a fan has one depth level");
  assert.equal(ringCutSketch({ kind: "fan", symmetry: 2, subdivisions: 1, spacingDeg: 15, rotation: 0 }, 96).edges.length, 0, "two parallel facets enclose nothing");
});
