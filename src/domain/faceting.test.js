import test from "node:test";
import assert from "node:assert/strict";

import {
  FACET_REGION,
  FacetingDocumentValidationError,
  VALID_REPEAT_COUNTS,
  applyFacetingCommand,
  betaDegToIndustryAngle,
  canRedo,
  canUndo,
  createAddFacetsCommand,
  createCommandHistory,
  createFacetingDocument,
  createRemoveFacetsCommand,
  createReplacePatternCommand,
  displayIndex,
  executeFacetingCommand,
  exportFacetingJSON,
  facetToClippingPlane,
  generateFacetIndices,
  generateMirrorAxes,
  importFacetingJSON,
  indexToAzimuthDeg,
  industryAngleToBetaDeg,
  normalizeIndex,
  redoFacetingCommand,
  replacePatternFacets,
  replayFacetingCommands,
  resolveFacetPattern,
  rotateFacetsByTeeth,
  scaleFacetsAlongZ,
  rotationalStockSupportOffset,
  translateFacetsAlongZ,
  undoFacetingCommand,
  validateFacetingDocument,
} from "./faceting.js";
import { createCenteredCube, clipPolyhedronByPlanes } from "./geometry.js";

test("normalizes the 96-tooth wheel and prints 96 as the zero alias", () => {
  assert.equal(normalizeIndex(96), 0);
  assert.equal(normalizeIndex(192), 0);
  assert.equal(normalizeIndex(-1), 95);
  assert.equal(displayIndex(0), 96);
  assert.equal(displayIndex(96), 96);
  assert.equal(displayIndex(95), 95);
  assert.throws(() => normalizeIndex(2.5), /integer/);
});

test("only divisors of 96 are valid repeat counts", () => {
  assert.deepEqual(VALID_REPEAT_COUNTS, [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 96]);
  assert.throws(
    () => generateFacetIndices({ baseIndex: 0, repeat: 5 }),
    /must divide 96/,
  );
});

test("builds N undirected mirror axes and reflects the rotation orbit across them", () => {
  assert.deepEqual(
    generateMirrorAxes({ baseIndex: 36, repeat: 8, mirror: 0 }),
    [0, 6, 12, 18, 24, 30, 36, 42],
  );
  assert.deepEqual(
    generateMirrorAxes({ baseIndex: 36, repeat: 8, mirror: 2 }),
    [2, 8, 14, 20, 26, 32, 38, 44],
  );

  const mirrored = generateFacetIndices({ baseIndex: 12, repeat: 4, mirror: 2 });
  assert.deepEqual(
    mirrored.map(displayIndex),
    [12, 16, 36, 40, 60, 64, 84, 88],
  );

  const plain = generateFacetIndices({ baseIndex: 96, repeat: 4, mirror: 0 });
  assert.deepEqual(plain.map(displayIndex), [24, 48, 72, 96]);

  const deDuplicated = generateFacetIndices({ baseIndex: 0, repeat: 8, mirror: 6 });
  assert.deepEqual(deDuplicated.map(displayIndex), [12, 24, 36, 48, 60, 72, 84, 96]);
});

test("converts tooth index to azimuth", () => {
  assert.equal(indexToAzimuthDeg(0), 0);
  assert.equal(indexToAzimuthDeg(12), 45);
  assert.equal(indexToAzimuthDeg(24), 90);
  assert.equal(indexToAzimuthDeg(95), 356.25);
});

test("keeps industry angles positive while signed beta follows region", () => {
  assert.equal(industryAngleToBetaDeg(FACET_REGION.CROWN, 35), 55);
  assert.equal(industryAngleToBetaDeg(FACET_REGION.CROWN, 35.12), 54.88);
  assert.equal(industryAngleToBetaDeg(FACET_REGION.GIRDLE, 90), 0);
  assert.equal(industryAngleToBetaDeg(FACET_REGION.PAVILION, 42), -48);
  assert.equal(betaDegToIndustryAngle(FACET_REGION.CROWN, 55), 35);
  assert.equal(betaDegToIndustryAngle(FACET_REGION.PAVILION, -48), 42);
  assert.equal(betaDegToIndustryAngle(FACET_REGION.CROWN, 54.88), 35.12);
  assert.throws(
    () => industryAngleToBetaDeg(FACET_REGION.GIRDLE, 89),
    /must use an industry angle of 90/,
  );
});

test("produces a unit clipping plane whose offset is rotational support minus depth", () => {
  const plane = facetToClippingPlane({
    region: "crown",
    industryAngleDeg: 35,
    index: 0,
    depth: 0.25,
  });
  const length = Math.hypot(plane.normal.x, plane.normal.y, plane.normal.z);
  assert.ok(Math.abs(length - 1) < 1e-10);
  assert.equal(plane.keep, "less-than-or-equal");
  assert.ok(plane.normal.z > 0);
  assert.ok(
    Math.abs(
      plane.offset - (rotationalStockSupportOffset(plane.normal) - 0.25),
    ) < 1e-10,
  );
});

test("translates cutting planes along Z and keeps their parametric depth valid", () => {
  const crown = resolveFacetPattern({
    patternId: "crown-tier",
    region: "crown",
    baseIndex: 0,
    repeat: 8,
    industryAngleDeg: 35,
    depth: 0.4,
  });
  const shift = 0.1;
  const moved = translateFacetsAlongZ(crown, shift);

  moved.forEach((facet, index) => {
    const original = crown[index];
    assert.ok(Math.abs(facet.depth - (original.depth - original.plane.normal.z * shift)) < 1e-10);
    assert.ok(Math.abs(facet.plane.offset - (original.plane.offset + original.plane.normal.z * shift)) < 1e-10);
    assert.equal(facet.patternId, original.patternId);
    assert.equal(facet.index, original.index);
  });

  assert.throws(() => translateFacetsAlongZ(crown, 10), /outside the rough stock/);
});

test("scales cutting planes along Z around a fixed waist plane", () => {
  const facets = [
    ...resolveFacetPattern({ patternId: "crown-tier", region: "crown", baseIndex: 0, repeat: 8, industryAngleDeg: 35, depth: 0.4 }),
    ...resolveFacetPattern({ patternId: "table-tier", region: "crown", baseIndex: 0, repeat: 1, industryAngleDeg: 0, depth: 0.35 }),
  ];
  const baseZ = 0.2;
  const factor = 1.25;
  const scaled = scaleFacetsAlongZ(facets, factor, baseZ);

  scaled.forEach((facet, index) => {
    const original = facets[index];
    const sourcePoint = {
      x: original.plane.normal.x * original.plane.offset,
      y: original.plane.normal.y * original.plane.offset,
      z: original.plane.normal.z * original.plane.offset,
    };
    const transformedPoint = {
      x: sourcePoint.x,
      y: sourcePoint.y,
      z: baseZ + factor * (sourcePoint.z - baseZ),
    };
    const projected = facet.plane.normal.x * transformedPoint.x
      + facet.plane.normal.y * transformedPoint.y
      + facet.plane.normal.z * transformedPoint.z;
    assert.ok(Math.abs(projected - facet.plane.offset) < 1e-9);
    assert.equal(facet.patternId, original.patternId);
    assert.equal(facet.index, original.index);
    assert.equal(facet.repeat, original.repeat);
  });

  assert.ok(scaled[0].industryAngleDeg > facets[0].industryAngleDeg);
  assert.equal(scaled.at(-1).industryAngleDeg, 0);
  assert.throws(() => scaleFacetsAlongZ(facets, 0, baseZ), /greater than zero/);
});

test("rotates a facet group by whole 96-wheel teeth without changing its pattern", () => {
  const facets = resolveFacetPattern({
    patternId: "rotating-tier",
    region: "crown",
    baseIndex: 6,
    repeat: 8,
    mirror: 2,
    industryAngleDeg: 35,
    depth: 0.4,
  });
  const rotated = rotateFacetsByTeeth(facets, 5);

  rotated.forEach((facet, index) => {
    assert.equal(facet.patternId, facets[index].patternId);
    assert.equal(facet.id, facets[index].id);
    assert.equal(facet.baseIndex, normalizeIndex(facets[index].baseIndex + 5));
    assert.equal(facet.index, normalizeIndex(facets[index].index + 5));
    assert.equal(facet.repeat, facets[index].repeat);
    assert.equal(facet.mirror, facets[index].mirror);
    assert.equal(facet.industryAngleDeg, facets[index].industryAngleDeg);
    assert.equal(facet.depth, facets[index].depth);
  });

  assert.throws(() => rotateFacetsByTeeth(facets, 0.5), /integer/);
});

test("places crown facets above the girdle and pavilion facets below it", () => {
  const centerZ = (solid, face) => face.vertexIndices.reduce(
    (total, vertexIndex) => total + solid.vertices[vertexIndex].z,
    0,
  ) / face.vertexIndices.length;
  const crown = resolveFacetPattern({
    patternId: "crown-top",
    region: "crown",
    baseIndex: 0,
    repeat: 8,
    mirror: 0,
    industryAngleDeg: 35,
    depth: 0.35,
  });
  const pavilion = resolveFacetPattern({
    patternId: "pavilion-bottom",
    region: "pavilion",
    baseIndex: 0,
    repeat: 8,
    mirror: 0,
    industryAngleDeg: 42,
    depth: 0.35,
  });
  const solid = clipPolyhedronByPlanes(
    createCenteredCube(2),
    [...crown, ...pavilion].map((facet) => ({
      ...facet.plane,
      operationId: facet.patternId,
      faceId: facet.id,
      region: facet.region,
    })),
  );
  const crownCenters = solid.faces
    .filter((face) => face.region === "crown")
    .map((face) => centerZ(solid, face));
  const pavilionCenters = solid.faces
    .filter((face) => face.region === "pavilion")
    .map((face) => centerZ(solid, face));

  assert.equal(crownCenters.length, 8);
  assert.equal(pavilionCenters.length, 8);
  assert.ok(crownCenters.every((value) => value > 0));
  assert.ok(pavilionCenters.every((value) => value < 0));
});

test("every requested repeat remains an effective face on square stock", () => {
  for (const depth of [0.02, 0.42, 0.67, 0.92]) {
    for (const repeat of [1, 2, 3, 4, 6, 8, 12, 16]) {
      const patternId = `repeat-${repeat}-depth-${depth}`;
      const facets = resolveFacetPattern({
        patternId,
        region: "crown",
        baseIndex: 36,
        repeat,
        mirror: 0,
        industryAngleDeg: 32,
        depth,
      });
      const solid = clipPolyhedronByPlanes(
        createCenteredCube(2),
        facets.map((facet) => ({
          ...facet.plane,
          operationId: facet.patternId,
          faceId: facet.id,
          region: facet.region,
        })),
      );
      const generatedFaces = solid.faces.filter(
        (face) => face.sourceOperationId === patternId,
      );
      assert.equal(
        generatedFaces.length,
        repeat,
        `repeat ${repeat} at depth ${depth} should create ${repeat} effective faces`,
      );
    }
  }
});

test("resolves every generated face into explicit replayable parameters", () => {
  const facets = resolveFacetPattern({
    patternId: "c1",
    region: "crown",
    baseIndex: 12,
    repeat: 4,
    mirror: 2,
    industryAngleDeg: 35,
    depth: 0.2,
  });

  assert.equal(facets.length, 8);
  assert.deepEqual(
    facets.map((facet) => facet.displayIndex),
    [12, 16, 36, 40, 60, 64, 84, 88],
  );
  assert.deepEqual(
    Object.keys(facets[0]).sort(),
    [
      "azimuthDeg",
      "baseIndex",
      "betaDeg",
      "depth",
      "displayIndex",
      "id",
      "index",
      "industryAngleDeg",
      "mirror",
      "ordinal",
      "patternId",
      "plane",
      "region",
      "repeat",
    ].sort(),
  );
  assert.equal(facets[0].plane.keep, "less-than-or-equal");
});

test("an offset 8-axis mirror tier creates a second effective 8-face orbit", () => {
  const patternId = "mirror-eight";
  const facets = resolveFacetPattern({
    patternId,
    region: "crown",
    baseIndex: 36,
    repeat: 8,
    mirror: 2,
    industryAngleDeg: 32,
    depth: 0.42,
  });
  const solid = clipPolyhedronByPlanes(
    createCenteredCube(2),
    facets.map((facet) => ({
      ...facet.plane,
      operationId: facet.patternId,
      faceId: facet.id,
      region: facet.region,
    })),
  );
  const generatedFaces = solid.faces.filter(
    (face) => face.sourceOperationId === patternId,
  );

  assert.equal(generateMirrorAxes({ baseIndex: 36, repeat: 8, mirror: 2 }).length, 8);
  assert.equal(facets.length, 16);
  assert.equal(generatedFaces.length, 16);
});

test("exports and imports validated JSON with explicit resolved facet data", () => {
  const facets = resolveFacetPattern({
    patternId: "p1",
    region: "pavilion",
    baseIndex: 0,
    repeat: 4,
    mirror: 0,
    industryAngleDeg: 42,
    depth: 0.3,
  });
  const document = createFacetingDocument({ name: "Round test", facets });
  const json = exportFacetingJSON(document);
  const restored = importFacetingJSON(json);

  assert.deepEqual(restored, document);
  assert.equal(validateFacetingDocument(restored).valid, true);

  const invalid = structuredClone(document);
  invalid.facets[0].displayIndex = 7;
  const result = validateFacetingDocument(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.path.endsWith(".displayIndex")));
  assert.throws(
    () => importFacetingJSON(JSON.stringify(invalid)),
    FacetingDocumentValidationError,
  );
});

test("round-trips valid vertex Meet metadata and rejects malformed construction records", () => {
  const construction = {
    type: "vertex-meet",
    solverVersion: 1,
    target: {
      topologyKey: "vertex:a|b|c",
      sourceFaceIds: ["a", "b", "c"],
      sourceOperationIds: ["crown-1", "girdle-1"],
      sourceGeometrySignature: "v1:0123456789abcdef",
      fallbackWorldPoint: [0.25, -0.5, 0.125],
    },
  };
  const facets = resolveFacetPattern({
    patternId: "meet-tier",
    region: "pavilion",
    baseIndex: 0,
    repeat: 4,
    mirror: 0,
    industryAngleDeg: 41,
    depth: 0.42,
    metadata: { patternMode: "symmetric", construction },
  });
  const document = createFacetingDocument({ facets });
  assert.deepEqual(importFacetingJSON(exportFacetingJSON(document)), document);

  const malformed = structuredClone(document);
  malformed.facets[0].metadata.construction.target.fallbackWorldPoint = [0, 1];
  assert.throws(
    () => importFacetingJSON(JSON.stringify(malformed)),
    (error) => error instanceof FacetingDocumentValidationError
      && error.errors.some((item) => item.path.endsWith("fallbackWorldPoint")),
  );
});

test("rejects Meet metadata outside one consistent symmetric crown or pavilion pattern", () => {
  const construction = {
    type: "vertex-meet",
    solverVersion: 1,
    target: {
      topologyKey: "vertex:a|b|c",
      sourceFaceIds: ["a", "b", "c"],
      sourceOperationIds: ["crown-1", "girdle-1"],
      sourceGeometrySignature: "v1:0123456789abcdef",
      fallbackWorldPoint: [0.25, -0.5, 0.125],
    },
  };
  const girdle = resolveFacetPattern({
    patternId: "bad-girdle", region: "girdle", baseIndex: 0, repeat: 4,
    industryAngleDeg: 90, depth: 0.2, metadata: { patternMode: "symmetric", construction },
  });
  assert.throws(() => createFacetingDocument({ facets: girdle }), FacetingDocumentValidationError);

  const arbitrary = resolveFacetPattern({
    patternId: "bad-arbitrary", region: "crown", baseIndex: 0, repeat: 4,
    industryAngleDeg: 32, depth: 0.2, metadata: { patternMode: "arbitrary", construction },
  });
  assert.throws(() => createFacetingDocument({ facets: arbitrary }), FacetingDocumentValidationError);

  const facets = resolveFacetPattern({
    patternId: "consistent", region: "pavilion", baseIndex: 0, repeat: 4,
    industryAngleDeg: 41, depth: 0.42, metadata: { patternMode: "symmetric", construction },
  });
  const document = createFacetingDocument({ facets });
  const partial = structuredClone(document);
  delete partial.facets[1].metadata.construction;
  assert.ok(validateFacetingDocument(partial).errors.some((error) => /every facet/.test(error.message)));

  const conflicting = structuredClone(document);
  conflicting.facets[1].metadata.construction.target.topologyKey = "vertex:other";
  assert.ok(validateFacetingDocument(conflicting).errors.some((error) => /must match every facet/.test(error.message)));
});

test("imports the previous inverted crown and pavilion convention by re-resolving geometry", () => {
  const legacy = createFacetingDocument({
    facets: [
      ...resolveFacetPattern({ patternId: "old-crown", region: "crown", baseIndex: 0, repeat: 4, mirror: 0, industryAngleDeg: 35, depth: 0.3 }),
      ...resolveFacetPattern({ patternId: "old-pavilion", region: "pavilion", baseIndex: 0, repeat: 4, mirror: 0, industryAngleDeg: 42, depth: 0.3 }),
    ],
  });
  legacy.facets.forEach((facet) => {
    facet.betaDeg *= -1;
    facet.plane.normal.z *= -1;
  });

  const restored = importFacetingJSON(JSON.stringify(legacy));
  assert.equal(validateFacetingDocument(restored).valid, true);
  assert.ok(restored.facets.filter((facet) => facet.region === "crown").every((facet) => facet.betaDeg > 0 && facet.plane.normal.z > 0));
  assert.ok(restored.facets.filter((facet) => facet.region === "pavilion").every((facet) => facet.betaDeg < 0 && facet.plane.normal.z < 0));
});

test("immutable command history supports undo, redo, branching, and replay", () => {
  const initial = createFacetingDocument({ name: "History test" });
  const addPavilion = createAddFacetsCommand(resolveFacetPattern({
    patternId: "p1",
    region: "pavilion",
    baseIndex: 0,
    repeat: 4,
    mirror: 0,
    industryAngleDeg: 42,
    depth: 0.25,
  }));
  const history0 = createCommandHistory(initial);
  const history1 = executeFacetingCommand(history0, addPavilion);

  assert.equal(history0.present.facets.length, 0);
  assert.equal(history1.present.facets.length, 4);
  assert.equal(canUndo(history1), true);
  assert.equal(canRedo(history1), false);

  const undone = undoFacetingCommand(history1);
  assert.equal(undone.present.facets.length, 0);
  assert.equal(history1.present.facets.length, 4);
  assert.equal(canRedo(undone), true);

  const redone = redoFacetingCommand(undone);
  assert.deepEqual(redone.present, history1.present);
  assert.deepEqual(
    replayFacetingCommands(history1.initial, history1.commands),
    history1.present,
  );

  const branchCommand = createAddFacetsCommand(resolveFacetPattern({
    patternId: "g1",
    region: "girdle",
    baseIndex: 0,
    repeat: 4,
    mirror: 0,
    industryAngleDeg: 90,
    depth: 0.1,
  }));
  const branched = executeFacetingCommand(undone, branchCommand);
  assert.equal(canRedo(branched), false);
  assert.equal(branched.commands.length, 1);
  assert.ok(branched.present.facets.every((facet) => facet.region === "girdle"));
});

test("command-owned ids make anonymous facets stable across replay", () => {
  const initial = createFacetingDocument();
  const anonymous = resolveFacetPattern({
    region: "crown",
    baseIndex: 6,
    repeat: 2,
    mirror: 0,
    industryAngleDeg: 35,
    depth: 0.2,
  }).map(({ id, patternId, ...facet }) => facet);
  const command = createAddFacetsCommand(anonymous);
  const first = replayFacetingCommands(initial, [command]);
  const second = replayFacetingCommands(initial, [command]);
  assert.deepEqual(second, first);

  const added = executeFacetingCommand(createCommandHistory(initial), command);
  const redone = redoFacetingCommand(undoFacetingCommand(added));
  assert.deepEqual(redone.present, added.present);
});

test("remove commands do not mutate the source document", () => {
  const document = createFacetingDocument({
    facets: resolveFacetPattern({
      patternId: "single",
      region: "pavilion",
      baseIndex: 12,
      repeat: 1,
      mirror: 0,
      industryAngleDeg: 42,
      depth: 0.1,
    }),
  });
  const id = document.facets[0].id;
  const removed = applyFacetingCommand(document, createRemoveFacetsCommand(id));
  assert.equal(removed.facets.length, 0);
  assert.equal(document.facets.length, 1);
});

test("replaces one parsed pattern while preserving its position and other patterns", () => {
  const first = resolveFacetPattern({ patternId: "first", region: "crown", baseIndex: 6, repeat: 8, mirror: 0, industryAngleDeg: 32, depth: 0.2 });
  const second = resolveFacetPattern({ patternId: "second", region: "pavilion", baseIndex: 0, repeat: 8, mirror: 0, industryAngleDeg: 41, depth: 0.3 });
  const document = createFacetingDocument({ facets: [...first, ...second] });
  const replacement = resolveFacetPattern({ patternId: "draft", region: "crown", baseIndex: 12, repeat: 4, mirror: 0, industryAngleDeg: 35, depth: 0.4 });
  const updated = applyFacetingCommand(document, createReplacePatternCommand("first", replacement));
  assert.equal(updated.facets.filter((facet) => facet.patternId === "first").length, 4);
  assert.equal(updated.facets[0].patternId, "first");
  assert.equal(updated.facets[0].depth, 0.4);
  assert.equal(updated.facets.at(-1).patternId, "second");
  assert.equal(document.facets.filter((facet) => facet.patternId === "first").length, 8);
});

test("replaces a layer preview in its original boolean-sequence slot", () => {
  const c1 = resolveFacetPattern({ patternId: "c1", region: "crown", baseIndex: 0, repeat: 4, mirror: 0, industryAngleDeg: 32, depth: 0.2 });
  const c2 = resolveFacetPattern({ patternId: "c2", region: "crown", baseIndex: 6, repeat: 8, mirror: 0, industryAngleDeg: 35, depth: 0.3 });
  const p1 = resolveFacetPattern({ patternId: "p1", region: "pavilion", baseIndex: 0, repeat: 4, mirror: 0, industryAngleDeg: 41, depth: 0.25 });
  const replacement = resolveFacetPattern({ patternId: "draft", region: "crown", baseIndex: 12, repeat: 8, mirror: 0, industryAngleDeg: 34, depth: 0.4 })
    .map((facet) => ({ ...facet, patternId: "c1" }));

  const source = [...c1, ...c2, ...p1];
  const result = replacePatternFacets(source, "c1", replacement);
  assert.deepEqual([...new Set(result.map((facet) => facet.patternId))], ["c1", "c2", "p1"]);
  assert.equal(result.filter((facet) => facet.patternId === "c1").length, 8);
  assert.equal(source.filter((facet) => facet.patternId === "c1").length, 4);
});
