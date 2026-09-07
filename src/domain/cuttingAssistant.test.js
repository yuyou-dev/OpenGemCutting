import test from "node:test";
import assert from "node:assert/strict";

import { createFacetingDocument, resolveFacetPattern } from "./faceting.js";
import { createCenteredCube, polyhedronVolume } from "./geometry.js";
import { buildConstructionStages } from "./constructionHistory.js";
import {
  buildCuttingSequence,
  createCuttingReplay,
  makeCuttingStepper,
} from "./cuttingAssistant.js";

const SYMMETRIC = { patternMode: "symmetric" };

/**
 * Seven-tier 96-tooth acceptance fixture (handoff §5 layout):
 * G1 girdle 16 -> P1 pavilion 16 -> P2 pavilion 8 -> C1 crown 16 ->
 * C2 crown 8 -> C3 crown 8 -> T table.
 */
function buildSevenTierDocument() {
  const patterns = [
    { patternId: "g1", label: "G1 腰部", region: "girdle", baseIndex: 3, repeat: 16, industryAngleDeg: 90, depth: 0.15, metadata: { ...SYMMETRIC } },
    { patternId: "p1", label: "P1 亭部", region: "pavilion", baseIndex: 3, repeat: 16, industryAngleDeg: 41, depth: 0.7, metadata: { ...SYMMETRIC } },
    { patternId: "p2", label: "P2 亭部", region: "pavilion", baseIndex: 0, repeat: 8, industryAngleDeg: 43, depth: 0.7, metadata: { ...SYMMETRIC } },
    { patternId: "c1", label: "C1 冠部", region: "crown", baseIndex: 3, repeat: 16, industryAngleDeg: 42, depth: 0.45, metadata: { ...SYMMETRIC } },
    { patternId: "c2", label: "C2 冠部", region: "crown", baseIndex: 0, repeat: 8, industryAngleDeg: 35, depth: 0.5, metadata: { ...SYMMETRIC } },
    { patternId: "c3", label: "C3 冠部", region: "crown", baseIndex: 6, repeat: 8, industryAngleDeg: 20, depth: 0.6, metadata: { ...SYMMETRIC } },
    { patternId: "t1", label: "T1 台面", region: "crown", baseIndex: 0, repeat: 1, industryAngleDeg: 0, depth: 0.5, metadata: { ...SYMMETRIC, operationType: "table", fixedAngle: true } },
  ];
  const facets = patterns.flatMap((pattern) => resolveFacetPattern(pattern));
  return createFacetingDocument({ name: "SRB 验收", facets });
}

function planeKey(normal, offset) {
  return [normal.x, normal.y, normal.z, offset]
    .map((value) => (Math.round(value * 1e6) / 1e6).toFixed(6))
    .join(",");
}

function solidPlaneKeys(solid) {
  return new Set(
    solid.faces.map((face) => {
      const vertex = solid.vertices[face.vertexIndices[0]];
      const offset =
        face.normal.x * vertex.x +
        face.normal.y * vertex.y +
        face.normal.z * vertex.z;
      return planeKey(face.normal, offset);
    }),
  );
}

test("expands the seven-tier document into 73 steps in CUT STACK order", () => {
  const document = buildSevenTierDocument();
  const { steps, tiers } = buildCuttingSequence(document);
  const stepper = makeCuttingStepper({ steps, tiers });

  assert.equal(steps.length, 73);
  assert.equal(stepper.total, 73);
  assert.deepEqual(stepper.counts, [16, 16, 8, 16, 8, 8, 1]);
  assert.deepEqual(stepper.cum, [0, 16, 32, 40, 56, 64, 72, 73]);
  assert.deepEqual(
    tiers.map((tier) => tier.patternId),
    ["g1", "p1", "p2", "c1", "c2", "c3", "t1"],
  );
  assert.deepEqual(
    tiers.map((tier) => tier.patternName),
    ["G1 腰部", "P1 亭部", "P2 亭部", "C1 冠部", "C2 冠部", "C3 冠部", "T1 台面"],
  );
  assert.deepEqual(
    steps.map((step) => step.seq),
    Array.from({ length: 73 }, (_, seq) => seq),
  );
  assert.equal(steps[0].patternName, "G1 腰部");
  assert.equal(steps[0].region, "girdle");
  assert.equal(steps[72].patternName, "T1 台面");
  assert.equal(steps[72].region, "crown");
  assert.equal(steps[72].industryAngleDeg, 0);
});

test("sorts each tier by normalized index and copies the source plane", () => {
  const document = buildSevenTierDocument();
  const { steps } = buildCuttingSequence(document);
  const facetsById = new Map(document.facets.map((facet) => [facet.id, facet]));

  for (const [start, end] of [[0, 16], [16, 32], [32, 40], [40, 56], [56, 64], [64, 72]]) {
    const indices = steps.slice(start, end).map((step) => step.index);
    const sorted = [...indices].sort((left, right) => left - right);
    assert.deepEqual(indices, sorted);
  }
  // resolveFacetPattern stores index 0 last (display alias 96); the cutting
  // sequence must start the tier at normalized index 0.
  assert.deepEqual(
    steps.slice(32, 40).map((step) => step.index),
    [0, 12, 24, 36, 48, 60, 72, 84],
  );
  assert.deepEqual(
    steps.slice(0, 16).map((step) => step.index),
    [3, 9, 15, 21, 27, 33, 39, 45, 51, 57, 63, 69, 75, 81, 87, 93],
  );

  for (const step of steps) {
    const source = facetsById.get(step.facetId);
    assert.ok(source, `step ${step.seq} must reference a source facet`);
    assert.deepEqual(step.plane, source.plane);
    assert.notEqual(step.plane, source.plane);
    assert.notEqual(step.plane.normal, source.plane.normal);
    assert.equal(step.industryAngleDeg, source.industryAngleDeg);
    assert.equal(step.depth, source.depth);
  }
});

test("keeps mirror-expanded facets adjacent in ascending index order", () => {
  const facets = resolveFacetPattern({
    patternId: "mirrored",
    label: "P1 亭部",
    region: "pavilion",
    baseIndex: 12,
    repeat: 4,
    mirror: 2,
    industryAngleDeg: 41,
    depth: 0.5,
    metadata: { ...SYMMETRIC },
  });
  const document = createFacetingDocument({ facets });
  const { steps, tiers } = buildCuttingSequence(document);

  assert.equal(tiers.length, 1);
  assert.equal(tiers[0].count, 8);
  assert.deepEqual(
    steps.map((step) => step.index),
    [12, 16, 36, 40, 60, 64, 84, 88],
  );
});

test("locates stock, in-tier, boundary, and finished positions", () => {
  const stepper = makeCuttingStepper(buildCuttingSequence(buildSevenTierDocument()));

  assert.deepEqual(stepper.locate(0), {
    status: "stock",
    position: 0,
    tierIndex: 0,
    patternId: "g1",
    stepInTier: 0,
    tierStepCount: 16,
  });
  assert.deepEqual(stepper.locate(1), {
    status: "cutting",
    position: 1,
    tierIndex: 0,
    patternId: "g1",
    stepInTier: 1,
    tierStepCount: 16,
  });
  for (const [p, tierIndex, patternId, tierStepCount] of [
    [16, 1, "p1", 16],
    [32, 2, "p2", 8],
    [40, 3, "c1", 16],
    [56, 4, "c2", 8],
    [64, 5, "c3", 8],
    [72, 6, "t1", 1],
  ]) {
    assert.deepEqual(stepper.locate(p), {
      status: "cutting",
      position: p,
      tierIndex,
      patternId,
      stepInTier: 0,
      tierStepCount,
    });
  }
  // p = total is the finished stone: no current step, but the last cutting
  // tier is reported complete so navigation can anchor on it.
  assert.deepEqual(stepper.locate(73), {
    status: "finished",
    position: 73,
    tierIndex: 6,
    patternId: "t1",
    stepInTier: 1,
    tierStepCount: 1,
  });
});

test("navigates tiers with clamping at both ends", () => {
  const stepper = makeCuttingStepper(buildCuttingSequence(buildSevenTierDocument()));

  assert.equal(stepper.nextTierPos(0), 16);
  assert.equal(stepper.nextTierPos(5), 16);
  assert.equal(stepper.nextTierPos(16), 32);
  assert.equal(stepper.nextTierPos(41), 56);
  assert.equal(stepper.nextTierPos(72), 73);
  assert.equal(stepper.nextTierPos(73), 73);

  assert.equal(stepper.prevTierPos(0), 0);
  assert.equal(stepper.prevTierPos(5), 0);
  assert.equal(stepper.prevTierPos(16), 0);
  assert.equal(stepper.prevTierPos(33), 32);
  assert.equal(stepper.prevTierPos(72), 64);
  assert.equal(stepper.prevTierPos(73), 72);

  assert.equal(stepper.tierEndPos(0), 16);
  assert.equal(stepper.tierEndPos(50), 56);
  assert.equal(stepper.tierEndPos(72), 73);
  assert.equal(stepper.tierEndPos(73), 73);
});

test("hidden layers contribute zero steps while seq stays continuous", () => {
  const document = buildSevenTierDocument();
  const { steps, tiers } = buildCuttingSequence(document, { hiddenPatternIds: ["p2"] });
  const stepper = makeCuttingStepper({ steps, tiers });

  assert.equal(stepper.total, 65);
  assert.deepEqual(stepper.counts, [16, 16, 0, 16, 8, 8, 1]);
  assert.equal(tiers.length, 7);
  assert.deepEqual(tiers[2], {
    patternId: "p2",
    patternName: "P2 亭部",
    region: "pavilion",
    table: false,
    hidden: true,
    count: 0,
    startPos: 32,
  });
  assert.deepEqual(
    steps.map((step) => step.seq),
    Array.from({ length: 65 }, (_, seq) => seq),
  );
  assert.ok(steps.every((step) => step.patternId !== "p2"));
  // The step right after the hidden tier's slot belongs to C1.
  assert.equal(steps[32].patternId, "c1");
  assert.equal(stepper.locate(32).tierIndex, 3);
  // The hidden tier collapses to zero width: completing P1 lands directly
  // on C1's start at 32.
  assert.equal(stepper.nextTierPos(31), 32);
});

test("the table always counts one step and preform layers stay in the sequence", () => {
  const document = buildSevenTierDocument();
  const { steps, tiers } = buildCuttingSequence(document);
  const tableFacet = document.facets.find(
    (facet) => facet.metadata?.operationType === "table",
  );
  const tableTier = tiers.find((tier) => tier.patternId === "t1");

  assert.equal(tableTier.table, true);
  assert.equal(tableTier.count, 1);
  assert.equal(steps.at(-1).index, tableFacet.index);
  assert.equal(steps.at(-1).operationType, "table");

  const preformDocument = createFacetingDocument({
    facets: [
      ...resolveFacetPattern({
        patternId: "preform-p",
        label: "P0 预成型",
        region: "pavilion",
        baseIndex: 0,
        repeat: 8,
        industryAngleDeg: 45,
        depth: 0.3,
        metadata: { ...SYMMETRIC, preform: true },
      }),
      ...resolveFacetPattern({
        patternId: "mains-p",
        label: "P1 亭部",
        region: "pavilion",
        baseIndex: 3,
        repeat: 16,
        industryAngleDeg: 41,
        depth: 0.6,
        metadata: { ...SYMMETRIC },
      }),
    ],
  });
  const preformSequence = buildCuttingSequence(preformDocument);
  assert.deepEqual(makeCuttingStepper(preformSequence).counts, [8, 16]);
  assert.equal(preformSequence.tiers[0].count, 8);
});

test("replays the rough at p=0 and the production solid at p=total", () => {
  const document = buildSevenTierDocument();
  const replay = createCuttingReplay(document);

  const rough = replay.solidAt(0);
  const expectedRough = createCenteredCube(document.stock.size, {
    center: document.stock.center,
  });
  assert.equal(rough.faces.length, 6);
  assert.deepEqual(solidPlaneKeys(rough), solidPlaneKeys(expectedRough));
  assert.ok(Math.abs(polyhedronVolume(rough) - 8) < 1e-9);

  const finished = replay.solidAt(replay.total);
  const production = buildConstructionStages(document).at(-1).afterSolid;
  assert.equal(finished.faces.length, production.faces.length);
  assert.deepEqual(solidPlaneKeys(finished), solidPlaneKeys(production));
});

test("replays intermediate positions with exactly the planes cut so far", () => {
  const document = buildSevenTierDocument();
  const replay = createCuttingReplay(document);

  for (const p of [16, 40]) {
    const solid = replay.solidAt(p);
    assert.ok(solid.faces.length > 6, `solid at ${p} must have cut faces`);
    const keys = solidPlaneKeys(solid);
    for (const step of replay.steps.slice(0, p)) {
      assert.ok(
        keys.has(planeKey(step.plane.normal, step.plane.offset)),
        `solid at ${p} must contain the plane of step ${step.seq}`,
      );
    }
  }

  // G1 done, P1 untouched: all 16 girdle planes present, no pavilion plane.
  const girdleDone = replay.solidAt(16);
  assert.equal(girdleDone.faces.length, 18); // 16 girdle caps + top + bottom
  assert.ok(
    !solidPlaneKeys(girdleDone).has(
      planeKey(replay.steps[16].plane.normal, replay.steps[16].plane.offset),
    ),
  );

  // Forward cache: repeated access returns the identical object.
  assert.equal(replay.solidAt(40), replay.solidAt(40));
  // Backward access replays from the nearest cached position.
  assert.equal(replay.solidAt(16).faces.length, 18);
});

test("an all-hidden document replays as an empty sequence", () => {
  const document = buildSevenTierDocument();
  const hiddenPatternIds = ["g1", "p1", "p2", "c1", "c2", "c3", "t1"];
  const { steps, tiers } = buildCuttingSequence(document, { hiddenPatternIds });
  const stepper = makeCuttingStepper({ steps, tiers });
  const replay = createCuttingReplay(document, { hiddenPatternIds });

  assert.equal(steps.length, 0);
  assert.equal(stepper.total, 0);
  assert.deepEqual(stepper.counts, [0, 0, 0, 0, 0, 0, 0]);
  assert.equal(tiers.length, 7);
  assert.equal(stepper.locate(0).status, "stock");
  assert.equal(stepper.locate(0).tierIndex, null);
  assert.equal(stepper.nextTierPos(0), 0);
  assert.equal(stepper.prevTierPos(0), 0);

  const rough = replay.solidAt(0);
  assert.equal(rough.faces.length, 6);
  assert.ok(Math.abs(polyhedronVolume(rough) - 8) < 1e-9);
  assert.equal(replay.solidAt(5), rough);
});
