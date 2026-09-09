import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cpus } from "node:os";
import assert from "node:assert/strict";

// Optional alternate checkout enables a before/after comparison using one runner.
const domainRoot = process.argv[2] ?? "src/domain";
const domainUrl = pathToFileURL(resolve(domainRoot) + "/").href;
const geometry = await import(domainUrl + "geometry.js");
const meet = await import(domainUrl + "meetJump.js");
const { createWorkbenchDocument } = await import(domainUrl + "document.js");
const { resolveDraftGeometry, planeEntry } = await import(domainUrl + "cutConstruction.js");

function sample(operation, sampleCount = 30) {
  for (let index = 0; index < 5; index += 1) operation(index);
  const durations = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const start = performance.now();
    operation(index);
    durations.push(performance.now() - start);
  }
  durations.sort((left, right) => left - right);
  return {
    samples: sampleCount,
    medianMs: durations[Math.floor(sampleCount * 0.5)],
    p95Ms: durations[Math.min(sampleCount - 1, Math.floor(sampleCount * 0.95))],
  };
}

// Exact convex n-gonal bipyramid: 2n actual triangular faces, no inactive planes.
function bipyramid(sideCount) {
  const vertices = Array.from({ length: sideCount }, (_, index) => ({
    x: Math.cos(index * 2 * Math.PI / sideCount),
    y: Math.sin(index * 2 * Math.PI / sideCount),
    z: 0,
  }));
  vertices.push({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 });
  const faces = [];
  for (let index = 0; index < sideCount; index += 1) {
    for (const isTop of [true, false]) {
      const vertexIndices = isTop
        ? [index, (index + 1) % sideCount, sideCount]
        : [(index + 1) % sideCount, index, sideCount + 1];
      const [a, b, c] = vertexIndices.map((vertexIndex) => vertices[vertexIndex]);
      const edgeAB = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
      const edgeAC = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
      const normal = {
        x: edgeAB.y * edgeAC.z - edgeAB.z * edgeAC.y,
        y: edgeAB.z * edgeAC.x - edgeAB.x * edgeAC.z,
        z: edgeAB.x * edgeAC.y - edgeAB.y * edgeAC.x,
      };
      const normalLength = Math.hypot(normal.x, normal.y, normal.z);
      for (const axis of ["x", "y", "z"]) normal[axis] /= normalLength;
      faces.push({
        id: `f${faces.length}`,
        sourceOperationId: `layer-${isTop}`,
        region: isTop ? "crown" : "pavilion",
        vertexIndices,
        normal,
      });
    }
  }
  return { vertices, faces };
}

const results = {
  domainRoot,
  node: process.version,
  platform: process.platform,
  cpu: cpus()[0]?.model,
  warmups: 5,
  rows: [],
};
const document = createWorkbenchDocument();
const baseSolid = geometry.clipPolyhedronByPlanes(
  geometry.createCenteredCube(),
  document.facets.map(planeEntry),
);
const draftPlanes = (index) => resolveDraftGeometry({
  patternMode: "symmetric",
  baseIndex: 36,
  repeat: 8,
  mirrorOffset: 0,
  industryAngle: 32,
  depth: 0.30 + (index % 20) * 0.005,
}, "crown", document.stock).facets.map(planeEntry);

results.rows.push({
  name: "default-new-cut",
  faces: baseSolid.faces.length,
  planes: 8,
  ...sample((index) => {
    const planes = draftPlanes(index);
    // Impact and preview deliberately retain their separate clipping tolerances.
    meet.evaluateDraftImpact({ baseSolid, planes });
    const solid = geometry.clipPolyhedronByPlanes(baseSolid, planes);
    geometry.measurePolyhedron(solid);
  }),
});

// Reproduce the workbench's two derivations: impact excludes the edited layer,
// while its display is rebuilt in the original CUT STACK position. In particular,
// editing G before P must not benchmark an append-to-P shortcut as its preview.
const cube = geometry.createCenteredCube();
const tablePlanes = document.facets
  .filter((facet) => facet.metadata?.operationType === "table")
  .map(planeEntry);
const draft96 = (region, depth) => resolveDraftGeometry({
  patternMode: "symmetric",
  baseIndex: 0,
  repeat: 96,
  mirrorOffset: 0,
  industryAngle: region === "girdle" ? 90 : 42,
  depth,
}, region, document.stock);
const savedPlanes96 = (region, depth, patternId) => draft96(region, depth).facets
  .map((facet) => planeEntry({ ...facet, id: `${patternId}:${facet.index}`, patternId }));
const savedGirdlePlanes = savedPlanes96("girdle", 0.55, "benchmark-G1");
const savedPavilionPlanes = savedPlanes96("pavilion", 0.65, "benchmark-P1");
const tableSolid = geometry.clipPolyhedronByPlanes(cube, tablePlanes);
const savedGirdleSolid = geometry.clipPolyhedronByPlanes(cube, [...tablePlanes, ...savedGirdlePlanes]);
const tablePavilionSolid = geometry.clipPolyhedronByPlanes(cube, [...tablePlanes, ...savedPavilionPlanes]);
const savedGirdlePavilionSolid = geometry.clipPolyhedronByPlanes(
  cube, [...tablePlanes, ...savedGirdlePlanes, ...savedPavilionPlanes],
);
const scenarios96 = [
  {
    name: "96-girdle-edit",
    region: "girdle",
    initialDepth: 0.50,
    savedSolid: savedGirdleSolid,
    impactBaseSolid: tableSolid,
    previewBaseSolid: cube,
    sequence: (planes) => [...tablePlanes, ...planes],
  },
  {
    name: "saved-96-girdle-new-96-pavilion",
    region: "pavilion",
    initialDepth: 0.60,
    savedSolid: savedGirdleSolid,
    impactBaseSolid: savedGirdleSolid,
    previewBaseSolid: savedGirdleSolid,
    sequence: (planes) => planes,
  },
  {
    name: "96-girdle-edit-before-96-pavilion",
    region: "girdle",
    initialDepth: 0.50,
    savedSolid: savedGirdlePavilionSolid,
    impactBaseSolid: tablePavilionSolid,
    previewBaseSolid: cube,
    sequence: (planes) => [...tablePlanes, ...planes, ...savedPavilionPlanes],
  },
];

for (const scenario of scenarios96) {
  const modes = typeof geometry.clipPolyhedronPreview === "function" ? ["canonical", "preview"] : ["canonical"];
  const durations = Object.fromEntries(modes.map((mode) => [mode, []]));
  const outputs = Object.fromEntries(modes.map((mode) => [mode, []]));
  const sampleCount = 16;
  const warmups = 3;
  for (let iteration = -warmups; iteration < sampleCount; iteration += 1) {
    const index = iteration < 0 ? iteration + warmups : iteration;
    // Alternate ordering so JIT/thermal scheduling does not always favor one path.
    for (const mode of index % 2 ? [...modes].reverse() : modes) {
      const start = performance.now();
      const draft = draft96(scenario.region, scenario.initialDepth + index * 0.002);
      const planes = draft.facets.map(planeEntry);
      const impact = meet.evaluateDraftImpact({
        baseSolid: scenario.impactBaseSolid,
        planes,
        preview: mode === "preview",
      });
      const clip = mode === "preview" ? geometry.clipPolyhedronPreview : geometry.clipPolyhedronByPlanes;
      // Do not reuse impact.resultSolid: its default 1e-8 tolerance and (for
      // edited layers) plane ordering differ from the actual visual preview.
      const solid = clip(scenario.previewBaseSolid, scenario.sequence(planes));
      const metrics = geometry.measurePolyhedron(solid);
      const duration = performance.now() - start;
      assert.equal(draft.error, "");
      assert.equal(planes.length, 96);
      assert.equal(impact.noOp, false, `${scenario.name}/${mode}: no-op input`);
      assert.equal(impact.solidErased, false);
      assert.ok(impact.generatedFaceCount > 0);
      assert.ok(metrics.volume > 0);
      const activeFaces = solid.faces.filter((face) => face.sourceOperationId === "draft-symmetric").length;
      assert.equal(activeFaces, 96, `${scenario.name}/${mode}: all 96 active facets must exist`);
      if (iteration >= 0) {
        durations[mode].push(duration);
        outputs[mode].push({ faces: solid.faces.length, activeFaces, vertices: solid.vertices.length });
      }
    }
  }
  for (const mode of modes) {
    durations[mode].sort((left, right) => left - right);
    results.rows.push({
      name: scenario.name,
      mode,
      paired: modes.length === 2,
      warmups,
      samples: sampleCount,
      faces: scenario.savedSolid.faces.length,
      planes: 96,
      previewPlanes: scenario.sequence(savedGirdlePlanes).length,
      resultFaceRange: [Math.min(...outputs[mode].map((output) => output.faces)), Math.max(...outputs[mode].map((output) => output.faces))],
      activeFaces: 96,
      impactTolerance: "default (1e-8)",
      previewTolerance: "geometry default (scale-aware)",
      medianMs: durations[mode][Math.floor(sampleCount * 0.5)],
      p95Ms: durations[mode][Math.floor(sampleCount * 0.95)],
    });
  }
}

for (const faceCount of [64, 1000, 10000, 20000]) {
  const solid = bipyramid(faceCount / 2);
  const sampleCount = faceCount >= 10000 ? 6 : 20;
  results.rows.push({
    name: "topology",
    faces: faceCount,
    vertices: solid.vertices.length,
    ...sample(() => meet.enumerateTopologyVertices(solid), sampleCount),
  });
  results.rows.push({
    name: "single-cut",
    faces: faceCount,
    vertices: solid.vertices.length,
    ...sample(() => geometry.clipPolyhedron(solid, {
      normal: [0, 0, 1],
      offset: 0.5,
    }), sampleCount),
  });
}

console.log(JSON.stringify(results, null, 2));
