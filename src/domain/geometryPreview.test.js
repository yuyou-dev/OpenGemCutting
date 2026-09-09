import assert from "node:assert/strict";
import test from "node:test";

import {
  clipPolyhedronByPlanes,
  clipPolyhedronPreview,
  createCenteredCube,
  faceArea,
  polyhedronVolume,
} from "./geometry.js";
import { createWorkbenchDocument } from "./document.js";
import { createFacetingDocument, replacePatternFacets, resolveFacetPattern } from "./faceting.js";
import { planeEntry, resolveDraftGeometry, snapshotMeetTarget } from "./cutConstruction.js";
import { createCuttingReplay } from "./cuttingAssistant.js";
import {
  enumerateTopologyVertices, evaluateDraftImpact, MEET_STATUS,
  resolveDraftCommitPolicy, resolvePersistedMeetTarget,
} from "./meetJump.js";

const document = createWorkbenchDocument();
const table = document.facets.filter((facet) => facet.metadata?.operationType === "table");
const cube = createCenteredCube();
const TOLERANCE = 2e-8;

function pattern(region, depth, extra = {}) {
  return resolveFacetPattern({
    patternId: `test-${region}`, region, depth, baseIndex: 0, repeat: 96,
    mirror: 0, industryAngleDeg: region === "girdle" ? 90 : 42,
    ...extra,
  }, { stock: document.stock });
}

function dot(normal, point) {
  return normal.x * point.x + normal.y * point.y + normal.z * point.z;
}

function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) <= TOLERANCE,
    `${label}: ${actual} differs from ${expected}`);
}

function assertSameShape(actual, expected, source, planes) {
  const identities = (solid) => solid.faces.map((face) => [
    face.id, face.sourceOperationId, face.region, face.operationType,
  ]).sort(([a], [b]) => a.localeCompare(b));
  assert.deepEqual(identities(actual), identities(expected));
  near(polyhedronVolume(actual), polyhedronVolume(expected), "volume");
  for (const face of actual.faces) {
    near(faceArea(actual, face), faceArea(expected, face.id), `area ${face.id}`);
    near(Math.hypot(face.normal.x, face.normal.y, face.normal.z), 1, `normal ${face.id}`);
  }
  // Compare the actual solid, independent of vertex numbering or apex welding.
  // Every preview vertex must stay inside the original solid and all new cuts.
  const constraints = [
    ...source.faces.map((face) => ({
      normal: face.normal, offset: dot(face.normal, source.vertices[face.vertexIndices[0]]),
    })),
    ...planes,
  ];
  for (const plane of constraints) {
    for (const point of actual.vertices) {
      assert.ok(dot(plane.normal, point) <= plane.offset + TOLERANCE,
        `preview vertex escaped half-space ${plane.faceId ?? "stock"}`);
    }
    if (actual.vertices.length) {
      near(Math.max(...actual.vertices.map((point) => dot(plane.normal, point))),
        Math.max(...expected.vertices.map((point) => dot(plane.normal, point))), "support distance");
    }
  }
}

test("96-face girdle and a subsequent 96-face pavilion retain every effective facet and shape", () => {
  const initial = structuredClone(cube);
  const girdlePlanes = [...table, ...pattern("girdle", 0.55)].map(planeEntry);
  const girdle = clipPolyhedronByPlanes(cube, girdlePlanes);
  assertSameShape(clipPolyhedronPreview(cube, girdlePlanes), girdle, cube, girdlePlanes);
  assert.equal(girdle.faces.filter((face) => face.sourceOperationId === "test-girdle").length, 96);
  const pavilionPlanes = pattern("pavilion", 0.65).map(planeEntry);
  const saved = structuredClone(girdle);
  const expected = clipPolyhedronByPlanes(girdle, pavilionPlanes);
  const preview = clipPolyhedronPreview(girdle, pavilionPlanes);
  assertSameShape(preview, expected, girdle, pavilionPlanes);
  assert.equal(preview.faces.filter((face) => face.sourceOperationId === "test-pavilion").length, 96);
  const impactOptions = { tolerance: 1e-8 };
  assertSameShape(clipPolyhedronPreview(girdle, pavilionPlanes, impactOptions),
    clipPolyhedronByPlanes(girdle, pavilionPlanes, impactOptions), girdle, pavilionPlanes);
  assert.deepEqual(cube, initial);
  assert.deepEqual(girdle, saved);
});

test("deep 96-face pavilion apex preserves effective IDs, area, volume and half-spaces", () => {
  const girdle = clipPolyhedronByPlanes(cube, [...table, ...pattern("girdle", 0.55)].map(planeEntry));
  for (const depth of [1.05, 1.4]) {
    const planes = pattern("pavilion", depth).map(planeEntry);
    const expected = clipPolyhedronByPlanes(girdle, planes);
    assertSameShape(clipPolyhedronPreview(girdle, planes), expected, girdle, planes);
    assert.ok(expected.faces.length > 100, "fixture must retain a real many-face pointed solid");
  }
});

test("previewing an earlier edited tier retains later tiers and does not mutate the saved stack", () => {
  const saved = [...table, ...pattern("girdle", 0.55), ...pattern("pavilion", 0.65)];
  const snapshot = structuredClone(saved);
  const edited = replacePatternFacets(saved, "test-girdle", pattern("girdle", 0.6));
  const planes = edited.map(planeEntry);
  const expected = clipPolyhedronByPlanes(cube, planes);
  assertSameShape(clipPolyhedronPreview(cube, planes), expected, cube, planes);
  assert.equal(expected.faces.filter((face) => face.sourceOperationId === "test-pavilion").length, 96);
  assert.deepEqual(saved, snapshot);
});

test("mirrored and arbitrary cuts preserve coplanar ownership and operation provenance", () => {
  const girdle = clipPolyhedronByPlanes(cube, [...table, ...pattern("girdle", 0.55)].map(planeEntry));
  const arbitrary = resolveDraftGeometry({
    patternMode: "arbitrary", customIndices: "1 3 7 11 15 19 23 31 37 41 49 55 61 67 73 79 83 89 93 96", baseIndex: 0,
    industryAngle: 39.25, depth: 0.7,
  }, "pavilion", document.stock);
  assert.equal(arbitrary.error, "");
  const cases = [
    pattern("crown", 0.55, { repeat: 8, mirror: 2 }),
    pattern("crown", 0.55, { repeat: 8, mirror: 6 }),
    arbitrary.facets,
  ];
  assert.equal(cases[0].length, 16);
  assert.equal(cases[1].length, 8);
  assert.equal(cases[2].length, 20);
  for (const facets of cases) {
    const planes = facets.map(planeEntry);
    // A later coincident plane must never steal the earlier facet's identity.
    planes.push({ ...planes[0], faceId: "coincident-later", operationId: "later" });
    const expected = clipPolyhedronByPlanes(girdle, planes);
    const preview = clipPolyhedronPreview(girdle, planes);
    assertSameShape(preview, expected, girdle, planes);
    assert.ok(preview.faces.every((face) => face.id !== "coincident-later"));
  }
});

test("empty, tangent and erased previews keep canonical no-cut and irreversible-empty behavior", () => {
  const plane = (offset, id) => ({ normal: { x: 1, y: 0, z: 0 }, offset, faceId: id });
  for (const planes of [[], [plane(2, "outside")], [plane(1, "touch")],
    [plane(-1, "tangent-erase")], [plane(-2, "erase"), plane(2, "cannot-revive")]]) {
    assert.deepEqual(clipPolyhedronPreview(cube, planes), clipPolyhedronByPlanes(cube, planes));
  }
  const empty = clipPolyhedronByPlanes(cube, [plane(-2, "erase")]);
  assert.deepEqual(clipPolyhedronPreview(empty, [plane(2, "later")]), empty);
  const outside = Array.from({ length: 16 }, (_, index) => plane(2 + index, `outside-${index}`));
  for (const last of [plane(1, "touch"), plane(-1, "tangent-erase"), plane(-2, "erase")]) {
    const planes = [...outside, last];
    assertSameShape(clipPolyhedronPreview(cube, planes),
      clipPolyhedronByPlanes(cube, planes), cube, planes);
  }
});

test("per-plane options and repeated face IDs retain exact canonical fallback semantics", () => {
  const planes = [
    ...Array.from({ length: 16 }, (_, index) => ({
      normal: [0, 0, 1], offset: 2 + index, faceId: `outside-${index}`,
    })),
    { normal: [1, 0, 0], offset: 0.7, faceId: "shared", operationId: "first" },
    { normal: [1, 0, 0], offset: 0.5, faceId: "shared", operationId: "second" },
    { normal: [0, 1, 0], offset: 0.3, faceId: "shared", operationId: "third" },
  ];
  assert.deepEqual(clipPolyhedronPreview(cube, planes), clipPolyhedronByPlanes(cube, planes));
  const withOptions = planes.map((plane, index) => ({ ...plane,
    options: { faceId: `option-${index}`, sourceOperationId: `owner-${index}`,
      region: "pavilion", operationType: "arbitrary", tolerance: (index + 1) * 1e-8 },
  }));
  const options = { region: "crown", operationId: "global", tolerance: 1e-7 };
  assert.deepEqual(clipPolyhedronPreview(cube, withOptions, options),
    clipPolyhedronByPlanes(cube, withOptions, options));
});

test("batch impact and commit gates match canonical contact, coverage and erase decisions", () => {
  const girdle = clipPolyhedronByPlanes(cube, [...table, ...pattern("girdle", 0.55)].map(planeEntry));
  // Two real pavilion facets at different depths give a partially covered tier,
  // followed by full coverage of that same tier without erasing the solid.
  const withPavilion = clipPolyhedronByPlanes(girdle, [
    ...pattern("pavilion", 0.6, { patternId: "old-p", repeat: 1, baseIndex: 0 }),
    ...pattern("pavilion", 0.8, { patternId: "old-p", repeat: 1, baseIndex: 24 }),
  ].map(planeEntry));
  const cases = [
    ...[-1e-8, 0, 9.9e-9, 1.01e-8].map((delta) => ({
      name: `girdle contact depth delta ${delta}`, baseSolid: girdle,
      facets: pattern("girdle", 0.55 + delta, { patternId: "new-girdle" }),
      kind: delta > 1e-8 ? "face-removal" : "no-op", policy: "block",
    })),
    { name: "normal pavilion", baseSolid: girdle, facets: pattern("pavilion", 0.65), kind: "facet", policy: "allow" },
    { name: "partial pavilion coverage", baseSolid: withPavilion, facets: pattern("pavilion", 0.7), kind: "face-removal", policy: "warn" },
    { name: "complete pavilion coverage", baseSolid: withPavilion, facets: pattern("pavilion", 0.9), kind: "face-removal", policy: "confirm" },
    { name: "erased solid", baseSolid: girdle, facets: pattern("pavilion", 2.5), kind: "solid-erased", policy: "block" },
    { name: "mirrored pavilion", baseSolid: girdle, facets: pattern("pavilion", 0.65, { repeat: 8, mirror: 2 }), kind: "facet", policy: "allow" },
  ];
  for (const { name, baseSolid, facets, kind, policy } of cases) {
    const planes = facets.map(planeEntry);
    const canonical = evaluateDraftImpact({ baseSolid, planes });
    const preview = evaluateDraftImpact({ baseSolid, planes, preview: true });
    const fields = ({ resultSolid, ...classification }) => classification;
    assert.deepEqual(fields(preview), fields(canonical), name);
    assert.equal(canonical.impactKind, kind, `${name}: fixture impact`);
    assert.equal(resolveDraftCommitPolicy(canonical), policy, `${name}: fixture policy`);
    assert.equal(resolveDraftCommitPolicy(preview), policy, `${name}: preview policy`);
  }
});

test("preview never changes canonical Meet sources or the assistant's ordered replay", () => {
  const facets = [...table, ...pattern("girdle", 0.55), ...pattern("pavilion", 1.05)];
  const planes = facets.map(planeEntry);
  const canonical = clipPolyhedronByPlanes(cube, planes);
  const snapshot = structuredClone(canonical);
  const targets = enumerateTopologyVertices(canonical);
  clipPolyhedronPreview(canonical, pattern("crown", 0.6, { repeat: 8 }).map(planeEntry));
  assert.deepEqual(canonical, snapshot);
  const rebuilt = clipPolyhedronByPlanes(cube, planes);
  assert.deepEqual(enumerateTopologyVertices(rebuilt), targets);
  const vertices = enumerateTopologyVertices(rebuilt);
  for (const target of targets) {
    assert.equal(resolvePersistedMeetTarget(snapshotMeetTarget(target), rebuilt, { vertices }).status,
      MEET_STATUS.VALID);
  }
  const replay = createCuttingReplay(createFacetingDocument({ facets }));
  const replayPlanes = replay.steps.map((step) => ({ ...step.plane,
    operationId: step.patternId, faceId: step.facetId, region: step.region,
    operationType: step.operationType,
  }));
  for (const position of [2, 97, replay.total]) {
    assert.deepEqual(replay.solidAt(position),
      clipPolyhedronByPlanes(replay.solidAt(0), replayPlanes.slice(0, position)));
  }
});

test("near-coincident tilted planes retain the canonical commit gate instead of becoming empty CUTs", () => {
  // The normal differs by less than the impact tolerance, yet the far corner
  // crosses the plane. Treating it as the existing +X plane loses a real cut.
  const planes = Array.from({ length: 15 }, (_, index) => ({
    normal: [0, 0, 1], offset: 3 + index, faceId: `outside-${index}`,
  }));
  planes.push({ normal: [1, 7e-9, 7e-9], offset: 1, faceId: "tilt", operationId: "new-cut" });
  const canonical = evaluateDraftImpact({ baseSolid: cube, planes });
  const preview = evaluateDraftImpact({ baseSolid: cube, planes, preview: true });
  assert.equal(canonical.generatedFaceCount, 1);
  assert.equal(resolveDraftCommitPolicy(canonical), "allow");
  assert.deepEqual(preview, canonical);
});

test("batch clipping respects array and non-unit source normals and preserves source metadata", () => {
  const planes = Array.from({ length: 16 }, (_, index) => ({
    normal: [Math.cos(index * Math.PI / 8), Math.sin(index * Math.PI / 8), 1],
    offset: 0.8, faceId: `oblique-${index}`, operationId: "oblique-cut",
  }));
  for (const magnitude of [1, 2]) {
    const source = createCenteredCube(2, { sourceOperationId: "rough-cube", region: "rough" });
    source.faces.forEach((face) => {
      face.normal = [face.normal.x, face.normal.y, face.normal.z].map((value) => value * magnitude);
      face.metadata = { label: face.id, finish: "rough" };
    });
    const snapshot = structuredClone(source);
    const canonical = clipPolyhedronByPlanes(source, planes);
    const preview = clipPolyhedronPreview(source, planes);
    const normalizedSource = {
      ...source,
      faces: source.faces.map((face) => ({ ...face, normal: {
        x: face.normal[0] / magnitude, y: face.normal[1] / magnitude, z: face.normal[2] / magnitude,
      } })),
    };
    assertSameShape(preview, canonical, normalizedSource,
      planes.map((plane) => ({ ...plane, normal: { x: plane.normal[0], y: plane.normal[1], z: plane.normal[2] } })));
    assert.ok(preview.vertices.every((point) => [point.x, point.y, point.z].every((value) => Math.abs(value) <= 1 + TOLERANCE)));
    for (const face of preview.faces.filter((face) => face.sourceOperationId === "rough-cube")) {
      assert.deepEqual(face.metadata, source.faces.find((entry) => entry.id === face.id).metadata);
    }
    assert.deepEqual(source, snapshot);
  }
});

test("96-fold Meet snapshots from the pre-batch kernel still resolve at the welded pavilion apex", () => {
  // Captured from 7af08b6 before batch preview / numeric VertexPool keys.
  // This apex has two legacy vertices: merging them in canonical geometry
  // would silently invalidate already-saved Meet construction identities.
  const snapshots = [
    {
      sourceFaceIds: Array.from({ length: 96 }, (_, index) => `test-pavilion:${index + 1}`).sort(),
      sourceGeometrySignature: "v1:8427f95e3186e9aa",
      fallbackWorldPoint: [2.720168166624463e-9, -1.0237977013335961e-9, -0.4874896755954818],
    },
    {
      sourceFaceIds: ["test-pavilion:1", "test-pavilion:95"],
      sourceGeometrySignature: "v1:9db9e2535722641f",
      fallbackWorldPoint: [8.89991795999728e-8, -1.023797505658816e-9, -0.4874895980758425],
    },
  ].map((target) => ({
    ...target,
    topologyKey: `vertex:${target.sourceFaceIds.map(encodeURIComponent).join("|")}`,
    sourceOperationIds: ["test-pavilion"],
  }));
  const planes = [...table, ...pattern("girdle", 0.55), ...pattern("pavilion", 1.05)].map(planeEntry);
  const canonical = clipPolyhedronByPlanes(cube, planes);
  clipPolyhedronPreview(cube, planes);
  for (const snapshot of snapshots) {
    const restored = resolvePersistedMeetTarget(snapshot, canonical);
    assert.equal(restored.status, MEET_STATUS.VALID);
    assert.equal(restored.target.sourceGeometrySignature, snapshot.sourceGeometrySignature);
    assert.deepEqual(restored.target.sourceFaceIds, snapshot.sourceFaceIds);
  }
});
