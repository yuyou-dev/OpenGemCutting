import { writeFile, mkdir } from "node:fs/promises";
import {
  createFacetingDocument,
  resolveFacetPattern,
  rotationalStockSupportOffset,
  facetNormal,
  industryAngleToBetaDeg,
  exportFacetingJSON,
  scaleFacetsAlongZ,
  translateFacetsAlongZ,
} from "../../src/domain/faceting.js";
import { buildConstructionStages } from "../../src/domain/constructionHistory.js";
import {
  enumerateTopologyEdges,
  enumerateTopologyVertices,
  createEdgeMeetTarget,
  solveVertexMeet,
  solveDualMeet,
} from "../../src/domain/meetJump.js";
import { snapshotMeetTarget } from "../../src/domain/cutConstruction.js";
const out = new URL("../../docs/manual/examples/", import.meta.url);
await mkdir(out, { recursive: true });
const pattern = (
  id,
  label,
  region,
  angle,
  offset,
  repeat = 8,
  baseIndex = 0,
  metadata = {},
) => {
  const normal = facetNormal(baseIndex, industryAngleToBetaDeg(region, angle));
  return resolveFacetPattern({
    patternId: id,
    label,
    region,
    baseIndex,
    repeat,
    mirror: 0,
    industryAngleDeg: angle,
    depth: rotationalStockSupportOffset(normal) - offset,
    metadata: { patternMode: "symmetric", ...metadata },
  });
};
const base = createFacetingDocument({
  name: "圆形练习 01 · 清晰的八瓣冠部",
  facets: [
    ...pattern("table-facet", "T1 台面", "crown", 0, 0.55, 1, 0, {
      operationType: "table",
      fixedAngle: true,
    }),
    ...pattern("girdle-preform", "G1 腰部", "girdle", 90, 0.8, 32),
    ...pattern("pavilion-main", "P1 亭部主面", "pavilion", 42, 0.59),
    ...pattern("crown-main", "C1 冠部主面", "crown", 35, 0.65),
  ],
});
const solid = buildConstructionStages(base).at(-1).afterSolid;
const edges = enumerateTopologyEdges(solid);
// Choose the crown ridge between I96 and I12, facing I6.
const ridge = edges.find((e) =>
  e.endpoints.every(
    (v) =>
      v.sourceFaceIds.includes("crown-main:96") &&
      v.sourceFaceIds.includes("crown-main:12"),
  ),
);
if (!ridge) throw Error("no target ridge");
const addMeet = (name, target, secondTarget = null, custom = false) => {
  let angle = 50;
  const normal = facetNormal(6, industryAngleToBetaDeg("crown", angle));
  const solved = secondTarget
    ? solveDualMeet({
        targetA: target,
        targetB: secondTarget,
        baseIndex: 6,
        region: "crown",
        stock: base.stock,
      })
    : solveVertexMeet({ normal, target, stock: base.stock });
  if (solved.status !== "valid") throw Error(JSON.stringify(solved));
  if (secondTarget) angle = solved.industryAngleDeg;
  const metadata = {
    patternMode: custom ? "arbitrary" : "symmetric",
    primaryIndex: 6,
    construction: {
      solverVersion: 2,
      type: secondTarget ? "dual-meet" : "edge-meet",
      primaryIndex: 6,
      target: snapshotMeetTarget(target),
      ...(secondTarget
        ? { secondTarget: snapshotMeetTarget(secondTarget) }
        : {}),
    },
  };
  let fs = resolveFacetPattern({
    patternId: "crown-detail",
    label: "C2 棱上装饰面",
    region: "crown",
    baseIndex: 6,
    repeat: 8,
    mirror: 0,
    industryAngleDeg: angle,
    depth: solved.depth,
    metadata,
  });
  if (custom)
    fs = fs
      .filter((f) => [6, 30, 54, 78].includes(f.index))
      .map((f) => ({ ...f, repeat: 1, baseIndex: f.index }));
  return createFacetingDocument({
    ...base,
    name,
    facets: [...base.facets, ...fs],
  });
};
const t1 = createEdgeMeetTarget(ridge, 1 / 3),
  t2 = createEdgeMeetTarget(ridge, 2 / 3);
const first = addMeet("圆形练习 02 · 棱上三分之一", t1),
  second = addMeet("圆形练习 03 · 棱上三分之二", t2);
const vertices = enumerateTopologyVertices(solid);
const dualOptions = vertices
  .map((v) => ({
    v,
    s: solveDualMeet({
      targetA: t1,
      targetB: v,
      baseIndex: 6,
      region: "crown",
      stock: base.stock,
    }),
  }))
  .filter(
    ({ s }) =>
      s.status === "valid" &&
      s.industryAngleDeg > 36 &&
      s.industryAngleDeg < 75,
  )
  .sort(
    (a, b) =>
      Math.abs(a.s.industryAngleDeg - 50) - Math.abs(b.s.industryAngleDeg - 50),
  );
let dual;
for (const { v } of dualOptions) {
  const d = addMeet("圆形练习 04 · 两点确定装饰面", t1, v);
  if (
    buildConstructionStages(d)
      .at(-1)
      .afterSolid.faces.some(
        (f) =>
          f.sourceOperationId === "crown-detail" ||
          f.operationId === "crown-detail",
      )
  ) {
    dual = d;
    break;
  }
}
if (!dual) throw new Error("No valid visible dual Meet example was found.");
const waistTop = Math.max(
  ...solid.faces
    .filter((face) => face.sourceOperationId === "girdle-preform")
    .flatMap((face) => face.vertexIndices.map((i) => solid.vertices[i].z)),
);
const low = createFacetingDocument({
  ...base,
  name: "圆形练习 05 · 低冠比例",
  facets: base.facets.map((f) =>
    f.region === "crown" ? scaleFacetsAlongZ([f], 0.7, waistTop)[0] : f,
  ),
});
const custom = addMeet("圆形练习 06 · 四向装饰节奏", t1, null, true);
const stale = createFacetingDocument({
  ...first,
  name: "圆形练习 07 · 来源变化待修复",
  facets: first.facets.map((f) =>
    f.patternId === "crown-main" ? translateFacetsAlongZ([f], 0.03)[0] : f,
  ),
});
const examples = [
  ["01-round-start.json", base],
  ["02-edge-third.json", first],
  ["03-edge-two-thirds.json", second],
  ["04-dual-meet.json", dual],
  ["05-low-crown.json", low],
  ["06-four-accents.json", custom],
  ["07-source-changed.json", stale],
];
const stats = [];
for (const [file, doc] of examples) {
  const stages = buildConstructionStages(doc);
  const s = stages.at(-1).afterSolid;
  await writeFile(new URL(file, out), exportFacetingJSON(doc));
  stats.push({
    file,
    name: doc.name,
    vertices: s.vertices.length,
    faces: s.faces.length,
    constructionStatus: stages.at(-1).construction?.status ?? null,
    angle: doc.facets.at(-1).industryAngleDeg,
    depth: doc.facets.at(-1).depth,
  });
}
await writeFile(
  new URL("manifest.json", out),
  JSON.stringify(
    {
      version: "0.7.2",
      purpose: "教学设计练习，不是生产切磨配方",
      examples: stats,
    },
    null,
    2,
  ),
);
console.log(
  stats.map((s) => ({
    file: s.file,
    faces: s.faces,
    angle: s.angle,
    construction: s.constructionStatus,
  })),
);
