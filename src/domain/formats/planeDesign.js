import { evaluateDocument } from "../documentGeometry.js";
import {
  createFacetingDocument,
  displayIndex,
  facetNormal,
  industryAngleToBetaDeg,
  resolveFacet,
  rotationalStockSupportOffset,
  validateFacetingDocument,
} from "../faceting.js";
import { summarizeEffectiveFacets } from "../meetJump.js";
import { facetIndexForGear, indexCompatibilityReport } from "../indexing.js";
import { facetSurfaceState } from "../facetSurface.js";
import { clipPolyhedronByPlanes, createCenteredCube } from "../geometry.js";
import { diagnostic, statusFor } from "./shared.js";

/**
 * PlaneDesign is the neutral model every foreign format reads into and writes
 * from. Frame: this project's (Z up; index·360/gear counterclockwise from +X).
 * Tier angles use the signed GemCad convention (crown positive, pavilion
 * negative, girdle ±90, table 0; a culet is 0 with a negative distance) and
 * distances are measured from a point on the rotation axis.
 *
 * { name, gear, symmetry, mirror, refractiveIndex, headings, footnotes,
 *   tiers: [{ angle, distance, region, table, name, instructions, hidden,
 *             entries: [{ index, token, name, finish, gcs }], line, sourceAngle }],
 *   extras: { asc, gcs, gem } }
 */

const EPSILON = 1e-9;
const REGION_LABELS = { crown: "冠部", girdle: "腰部", pavilion: "亭部" };
const REGION_PREFIXES = { crown: "C", girdle: "G", pavilion: "P" };

export function tierRegion(angle, distance, angleToken = "") {
  if (Math.abs(Math.abs(angle) - 90) <= EPSILON) return "girdle";
  const horizontalCulet = Math.abs(angle) <= EPSILON && distance < 0;
  if (angle < 0 || horizontalCulet || Object.is(angle, -0) || /^\s*-0(?:\.0*)?\s*$/.test(angleToken)) return "pavilion";
  return "crown";
}

export function tierNormal(tier, index, gear) {
  return facetNormal(index, industryAngleToBetaDeg(tier.region, Math.abs(tier.angle)), gear);
}

export function visibleTiers(design) {
  return design.tiers.filter((tier) => !tier.hidden);
}

/** Facet names beyond the tier's own: GemCad names a tier by naming one of
 * its indices, which every format keeps as the tier name. */
export function individualFacetNames(tier) {
  const named = tier.entries.filter((entry) => entry.name);
  if (named.length === 1 && named[0].name === tier.name) return [];
  return named;
}

export function textLines(lines) {
  return lines.filter((line) => String(line ?? "").trim());
}

// Trim floating-point noise after normal-to-index conversion, never snap a
// fractional direction to a machine tooth.
export function cleanIndex(index, teeth) {
  const rounded = Number(index.toFixed(10));
  return rounded === 0 || rounded === teeth ? teeth : rounded;
}

/** Final solid of a design on its own, without the workbench stock. A design
 * that does not close (no table, open pavilion) is reported as `open`; its
 * solid is then cut by a box `previewBound` times the largest distance so a
 * preview stays readable. Steep closed designs are confirmed with a wide box. */
export function planeDesignSolid(design, { previewBound = 1.5 } = {}) {
  const tiers = visibleTiers(design);
  const reach = Math.max(1e-9, ...tiers.map((tier) => Math.abs(tier.distance)));
  const planes = tiers.flatMap((tier, tierIndex) => tier.entries.map((entry, entryIndex) => ({
    normal: tierNormal(tier, entry.index, design.gear),
    offset: Math.abs(tier.distance),
    faceId: `${tierIndex}:${entryIndex}`,
    operationId: `tier-${tierIndex}`,
    region: tier.region,
  })));
  const clip = (half) => clipPolyhedronByPlanes(createCenteredCube(reach * half * 2, { sourceOperationId: "open-bound" }), planes);
  const touches = (solid) => solid.faces.some((face) => face.sourceOperationId === "open-bound");
  let solid = clip(4);
  let open = touches(solid);
  if (open) {
    const wide = clip(1000);
    open = touches(wide);
    solid = open ? clip(previewBound) : wide;
  }
  return { solid, open, dimensions: open ? null : solidDimensions(solid) };
}

export function solidDimensions(solid) {
  if (!solid.vertices.length) return null;
  const axis = (key) => {
    let min = Infinity;
    let max = -Infinity;
    for (const point of solid.vertices) { min = Math.min(min, point[key]); max = Math.max(max, point[key]); }
    return { min, max, size: max - min };
  };
  const x = axis("x");
  const y = axis("y");
  const z = axis("z");
  const width = Math.min(x.size, y.size);
  const length = Math.max(x.size, y.size);
  return {
    x: x.size, y: y.size, z: z.size,
    center: { x: (x.min + x.max) / 2, y: (y.min + y.max) / 2, z: (z.min + z.max) / 2 },
    halfExtent: Math.max(x.size, y.size, z.size) / 2,
    lengthToWidth: width > EPSILON ? length / width : null,
    heightToWidth: width > EPSILON ? z.size / width : null,
  };
}

/** Planes normalised to the bounding-box centre and half extent: two files of
 * the same stone agree here even when one format recentres or rescales. Open
 * designs are never recentred by a writer, so their planes compare as written. */
export function planeSignature(design) {
  const { solid, open, dimensions } = planeDesignSolid(design);
  if (!solid.vertices.length) return [];
  const faces = new Set(solid.faces.map((face) => face.id));
  const tiers = visibleTiers(design);
  const reach = Math.max(1e-9, ...tiers.map((tier) => Math.abs(tier.distance)));
  const center = open ? { x: 0, y: 0, z: 0 } : dimensions.center;
  const unit = open ? reach : dimensions.halfExtent;
  return tiers.flatMap((tier, tierIndex) => tier.entries.flatMap((entry, entryIndex) => {
    if (!open && !faces.has(`${tierIndex}:${entryIndex}`)) return [];
    const normal = tierNormal(tier, entry.index, design.gear);
    const offset = (Math.abs(tier.distance) - (normal.x * center.x + normal.y * center.y + normal.z * center.z)) / unit;
    return [{ normal, offset }];
  })).sort((a, b) => a.normal.x - b.normal.x || a.normal.y - b.normal.y || a.normal.z - b.normal.z);
}

export function sameShape(left, right, tolerance = 1e-5) {
  const a = planeSignature(left);
  const b = planeSignature(right);
  if (!a.length || a.length !== b.length) return false;
  const remaining = [...b];
  return a.every((plane) => {
    const match = remaining.findIndex((other) => Math.abs(other.normal.x - plane.normal.x) < tolerance
      && Math.abs(other.normal.y - plane.normal.y) < tolerance
      && Math.abs(other.normal.z - plane.normal.z) < tolerance
      && Math.abs(other.offset - plane.offset) < tolerance);
    if (match < 0) return false;
    remaining.splice(match, 1);
    return true;
  });
}

/** Direction pseudo-facets for index compatibility reports. */
export function designDirections(design) {
  return visibleTiers(design).flatMap((tier, tierIndex) => tier.entries.map((entry, entryIndex) => ({
    id: `${tierIndex}:${entryIndex}`,
    normal: tierNormal(tier, entry.index, design.gear),
  })));
}

export function designSummary(design) {
  const tiers = visibleTiers(design);
  const regions = { crown: 0, girdle: 0, pavilion: 0, table: 0 };
  for (const tier of tiers) regions[tier.table ? "table" : tier.region] += tier.entries.length;
  return {
    sourceGear: design.extras?.asc?.sourceGear ?? design.gear,
    targetGear: design.gear,
    symmetry: design.symmetry,
    mirrorSymmetry: design.mirror,
    refractiveIndex: design.refractiveIndex,
    tierCount: tiers.length,
    facetCount: tiers.reduce((sum, tier) => sum + tier.entries.length, 0),
    frostedCount: tiers.reduce((sum, tier) => sum + tier.entries.filter((entry) => entry.finish?.state === "frosted").length, 0),
    hiddenTierCount: design.tiers.length - tiers.length,
    scale: null,
    dimensions: null,
    regions,
  };
}

/** Mark the single horizontal crown tier as the table; more than one stays
 * ambiguous and is resolved (or refused) by the consumer. */
export function markTable(tiers) {
  const horizontal = tiers.filter((tier) => !tier.hidden && tier.region === "crown" && Math.abs(tier.angle) <= EPSILON);
  if (horizontal.length === 1) horizontal[0].table = true;
  return tiers;
}

function tierLabel(tier, count) {
  return `${tier.name || `${REGION_PREFIXES[tier.region]}${count}`} ${REGION_LABELS[tier.region]}`;
}

/**
 * Open a design in the workbench. Planes are scaled uniformly so every depth
 * stays non-negative on the stock; the single horizontal table becomes the
 * fixed T1 and the source order is kept for export. Tier names, instructions,
 * facet names and source order live in `metadata.asc` (historical name for the
 * exchange bookkeeping every format shares); per-facet finish and Gem Cut
 * Studio values stay on the facet.
 */
export function documentFromDesign(design, { diagnostics = [], summary = designSummary(design), parsed = null, metadata = {} } = {}) {
  const indexTeeth = design.gear;
  const tiers = visibleTiers(design);
  let scale = 1;
  for (const tier of tiers) {
    for (const { index } of tier.entries) {
      const distance = Math.abs(tier.distance);
      if (distance > EPSILON) scale = Math.min(scale, rotationalStockSupportOffset(tierNormal(tier, index, indexTeeth)) / distance);
    }
  }
  scale = Math.min(1, scale);
  // Depth alone does not keep the stone inside the stock: girdle corners
  // between facets (and steep pavilion points) can reach past the cube and be
  // shaved into slivers of uncut stock. Shrink uniformly until the closed
  // stone fits, strictly inside so no facet merges into a stock face.
  const { solid: sourceSolid, open } = planeDesignSolid({ ...design, tiers });
  if (!open && sourceSolid.vertices.length) {
    const reach = Math.max(...sourceSolid.vertices.map((point) => Math.max(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z))));
    if (reach * scale > 1 - 1e-7) scale = (1 - 1e-6) / reach;
  } else if (tiers.some((tier) => tier.entries.some(({ index }) => {
    const normal = tierNormal(tier, index, indexTeeth);
    const axisAligned = [normal.x, normal.y, normal.z].some((value) => Math.abs(Math.abs(value) - 1) < 1e-12);
    return axisAligned && rotationalStockSupportOffset(normal) - Math.abs(tier.distance) * scale < 1e-9;
  }))) {
    scale *= 1 - 1e-6; // an open design's plane resting on a stock face stays a real cut
  }
  summary.scale = scale;
  if (scale < 1 - EPSILON) {
    diagnostics.push(diagnostic("warning", "UNIFORM_SCALE_NORMALIZATION", `为保持深度非负，全部平面距离统一缩放为 ${(scale * 100).toFixed(3)}%；角度、L/W 与冠亭高度比例保持不变。`));
  }

  const tableTiers = tiers.filter((tier) => tier.region === "crown" && Math.abs(tier.angle) <= EPSILON);
  if (tableTiers.length === 0) {
    diagnostics.push(diagnostic("error", "MISSING_TABLE", "源文件没有可识别的 0° 水平台面；工作台要求唯一固定 T1，不能无提示虚构。可以直接转换为其他格式，不经过工作台。"));
    return { status: "error", document: null, parsed, diagnostics, summary };
  }
  if (tableTiers.length > 1) {
    diagnostics.push(diagnostic("error", "AMBIGUOUS_TABLE", "源文件包含多个 0° 水平层；工作台要求唯一固定 T1，请先在原软件中合并或删除多余台面。", tableTiers[1].line));
    return { status: "error", document: null, parsed, diagnostics, summary };
  }
  const [tableTier] = tableTiers;
  if (tiers.indexOf(tableTier) !== 0) {
    diagnostics.push(diagnostic("warning", "TABLE_REORDERED", "T1 在 CUT STACK 中提升为固定首层；半空间几何不变，原工序序号会保留供再次导出。", tableTier.line));
  }

  const regionCounts = { crown: 0, girdle: 0, pavilion: 0 };
  const facetGroups = tiers.map((tier, tierIndex) => {
    const isTable = tier === tableTier;
    if (!isTable) regionCounts[tier.region] += 1;
    const patternId = isTable ? "table-facet" : `asc-tier-${tierIndex + 1}`;
    const label = isTable ? "T1 台面" : tierLabel(tier, regionCounts[tier.region]);
    const industryAngleDeg = Math.abs(tier.angle);
    const tierMetadata = {
      order: tier.order ?? tierIndex,
      ...(tier.line ? { line: tier.line } : {}),
      name: tier.name ?? "",
      instructions: tier.instructions ?? "",
      sourceAngle: tier.sourceAngle ?? String(tier.angle),
      sourceCenterDistance: tier.distance,
      sourceIndices: tier.entries.map((entry) => String(entry.token ?? entry.index)),
    };
    const facets = tier.entries.map((entry, ordinal) => {
      const normal = tierNormal(tier, entry.index, indexTeeth);
      const depth = Math.max(0, rotationalStockSupportOffset(normal) - Math.abs(tier.distance) * scale);
      return resolveFacet({
        id: `${patternId}:${displayIndex(entry.index, indexTeeth)}`,
        patternId,
        ordinal,
        region: tier.region,
        baseIndex: entry.index,
        indexTeeth,
        repeat: 1,
        mirror: 0,
        index: entry.index,
        industryAngleDeg,
        depth,
        label,
        metadata: {
          patternMode: "arbitrary",
          ...(isTable ? { operationType: "table", fixedAngle: true } : {}),
          ...(entry.finish?.state === "frosted" ? { surfaceFinish: structuredClone(entry.finish) } : {}),
          ...(entry.gcs ? { gcs: { ...entry.gcs } } : {}),
          asc: { ...tierMetadata, facetName: entry.name ?? "" },
        },
      });
    });
    return { isTable, facets };
  });

  const facets = [
    ...facetGroups.filter((group) => group.isTable).flatMap((group) => group.facets),
    ...facetGroups.filter((group) => !group.isTable).flatMap((group) => group.facets),
  ];
  const hidden = design.tiers.filter((tier) => tier.hidden)
    .map((tier) => ({ ...structuredClone(tier), distance: tier.distance * scale }));
  const gcs = design.extras?.gcs ? { ...structuredClone(design.extras.gcs), ...(hidden.length ? { hiddenTiers: hidden } : {}) } : undefined;
  const document = createFacetingDocument({
    name: design.name,
    indexGear: indexTeeth,
    facets,
    metadata: {
      optics: { refractiveIndex: design.refractiveIndex },
      ...metadata,
      asc: {
        ...(design.extras?.asc ?? {}),
        ...(metadata.asc ?? {}),
        symmetry: design.symmetry,
        mirrorSymmetry: design.mirror,
        headings: design.headings,
        footnotes: design.footnotes,
        importScale: scale,
      },
      ...(gcs ? { gcs } : {}),
    },
  });

  const solid = evaluateDocument(document);
  if (solid.vertices.length === 0) {
    diagnostics.push(diagnostic("error", "EMPTY_GEOMETRY", "这些切面组合会移除全部毛坯，无法导入。"));
  } else {
    const surviving = new Set(solid.faces.map((face) => face.sourceOperationId).filter(Boolean));
    for (const group of facetGroups) {
      const first = group.facets[0];
      if (first && !surviving.has(first.patternId)) {
        diagnostics.push(diagnostic("warning", "REDUNDANT_TIER", `图层“${first.label}”在最终实体中没有保留刻面；仍按原工序保存在 CUT STACK。`, first.metadata?.asc?.line));
      }
    }
    if (surviving.has("rough-cube")) {
      diagnostics.push(diagnostic("warning", "ROUGH_STOCK_REMAINS", "最终实体仍包含毛坯原始面；请检查源文件是否依赖未编码的预形。"));
    }
  }
  summary.compatibility = indexCompatibilityReport(document, { gears: [indexTeeth, ...(indexTeeth === 96 ? [] : [96])] });
  if (!summary.compatibility[0].compatible) {
    diagnostics.push(diagnostic("warning", "FRACTIONAL_INDICES_PRESERVED", `${summary.compatibility[0].incompatibleCount} 个方向在 ${indexTeeth} 齿盘上需要小数分度；几何已原样保留，未取整。`));
  }
  summary.dimensions = solidDimensions(solid);
  summary.tierCount = facetGroups.length;
  summary.facetCount = facets.length;
  summary.regions = { crown: 0, girdle: 0, pavilion: 0, table: 0 };
  for (const tier of tiers) summary.regions[tier === tableTier ? "table" : tier.region] += tier.entries.length;
  const errors = diagnostics.some((item) => item.severity === "error");
  return { status: statusFor(diagnostics), document: errors ? null : document, parsed, diagnostics, summary };
}

function operationRank(group) {
  const first = group[0];
  const sourceOrder = first.metadata?.asc?.order;
  if (Number.isInteger(sourceOrder)) return sourceOrder;
  if (first.metadata?.operationType === "table") return 400000;
  return { pavilion: 100000, girdle: 200000, crown: 300000 }[first.region] ?? 350000;
}

/**
 * The final effective facets of a workbench document as a PlaneDesign. Only
 * surviving faces are written; everything a foreign format cannot hold is
 * reported with `target` in the message. Tier and facet order follow the saved
 * source order, then pavilion → girdle → crown → table.
 */
export function designFromDocument(document, { target = "该格式" } = {}) {
  const diagnostics = [];
  const facts = {};
  if (document.concaveCuts?.some((cut) => cut.enabled !== false)) {
    diagnostics.push(diagnostic("error", "CONCAVE_CUTS_UNSUPPORTED", `${target} 不能表达凹切刀具与曲面；请用 JSON 保存完整项目，或导出 PDF 查看独立凹切工序。`));
    return { status: "error", design: null, diagnostics, facts };
  }
  if (document.concaveCuts?.length) {
    facts.disabledConcaveCuts = document.concaveCuts.length;
    diagnostics.push(diagnostic("warning", "DISABLED_CONCAVE_CUTS_OMITTED", `已停用的凹切参数不会写入 ${target}；它们只保留在 JSON 完整项目中。`));
  }
  if (document.stock?.kind === "mesh") {
    diagnostics.push(diagnostic("error", "MESH_STOCK_UNSUPPORTED", `${target} 无法保存导入晶体的凹部、孔洞与原始表面；请使用 JSON 完整保存，或导出 PDF 查看切割指令。`));
    return { status: "error", design: null, diagnostics, facts };
  }
  const validation = validateFacetingDocument(document);
  if (!validation.valid) {
    validation.errors.slice(0, 8).forEach((error) => diagnostics.push(diagnostic("error", "INVALID_DOCUMENT", `${error.path} ${error.message}`)));
    return { status: "error", design: null, diagnostics, facts };
  }

  const gear = document.indexGear?.teeth ?? 96;
  const solid = evaluateDocument(document);
  const surviving = new Set(summarizeEffectiveFacets(solid).effectiveFacetIds);
  const exported = document.facets.filter((facet) => surviving.has(facet.id));
  if (!solid.vertices.length) {
    diagnostics.push(diagnostic("error", "EMPTY_GEOMETRY", "当前切割已移除全部底胚，没有可导出的实体。"));
  } else if (!exported.length) {
    diagnostics.push(diagnostic("error", "NO_EFFECTIVE_FACETS", `当前没有最终有效的平面工序可写入 ${target}，请用 JSON 保存底胚与完整项目。`));
  } else if (solid.faces.some((face) => face.sourceOperationId === "rough-cube")) {
    facts.roughStock = true;
    diagnostics.push(diagnostic("warning", "ROUGH_STOCK_REMAINS", `当前实体保留部分初始底胚面；${target} 只写切割平面，不包含这些底胚边界，不能独立还原完整外形。`));
  }

  const groups = new Map();
  for (const facet of exported) {
    if (!groups.has(facet.patternId)) groups.set(facet.patternId, []);
    groups.get(facet.patternId).push(facet);
  }
  const ordered = [...groups.values()].sort((left, right) => operationRank(left) - operationRank(right));
  let flattened = false;
  const tiers = ordered.map((group) => {
    const first = group[0];
    const sameTier = group.every((facet) => facet.region === first.region
      && Math.abs(facet.industryAngleDeg - first.industryAngleDeg) <= EPSILON
      && Math.abs(facet.plane.offset - first.plane.offset) <= EPSILON);
    if (!sameTier) {
      diagnostics.push(diagnostic("error", "INCONSISTENT_LAYER", `图层“${first.label ?? first.patternId}”内的刻面不共享角度和平面距离，不能写为一个 ${target} 层。`));
    }
    if (first.repeat > 1 || first.mirror > 0) flattened = true;
    const table = first.metadata?.operationType === "table";
    const culet = first.region === "pavilion" && Math.abs(first.industryAngleDeg) <= EPSILON;
    const sourceAngle = Number(first.metadata?.asc?.sourceAngle);
    const angle = table || culet
      ? 0
      : first.region === "pavilion"
        ? -first.industryAngleDeg
        : first.region === "girdle" && Math.abs(sourceAngle) === 90 ? sourceAngle : first.industryAngleDeg;
    const seen = new Set();
    const entries = [];
    for (const facet of group) {
      const index = cleanIndex(facetIndexForGear(facet, gear) ?? 0, gear);
      if (seen.has(index)) continue;
      seen.add(index);
      entries.push({
        index,
        name: facet.metadata?.asc?.facetName ?? "",
        finish: facetSurfaceState(facet) === "frosted" ? structuredClone(facet.metadata.surfaceFinish) : null,
        ...(facet.metadata?.gcs ? { gcs: { ...facet.metadata.gcs } } : {}),
      });
    }
    return {
      angle,
      distance: culet ? -first.plane.offset : first.plane.offset,
      region: first.region,
      table,
      name: first.metadata?.asc?.name || first.label?.split(/\s+/)[0] || "",
      instructions: String(first.metadata?.asc?.instructions ?? "").trim(),
      entries,
      preform: Boolean(first.metadata?.preform),
      hidden: false,
    };
  });

  const hiddenTiers = Array.isArray(document.metadata?.gcs?.hiddenTiers) ? document.metadata.gcs.hiddenTiers : [];
  facts.flattened = flattened;
  facts.overwritten = document.facets.length - exported.length;
  facts.meet = document.facets.filter((facet) => facet.metadata?.construction).length;
  facts.preform = document.facets.filter((facet) => facet.metadata?.preform).length;
  facts.optics = Object.keys(document.metadata?.optics ?? {}).filter((key) => key !== "refractiveIndex");
  facts.storedFacetCount = document.facets.length;
  facts.effectiveFacetCount = exported.length;
  if (flattened) {
    diagnostics.push(diagnostic("warning", "PARAMETRIC_RELATIONSHIP_FLATTENED", `重复与镜像关系会展开为显式索引；刻面几何保持，但该参数关系无法从 ${target} 恢复。`));
  }
  if (facts.meet) {
    diagnostics.push(diagnostic("warning", "MEET_CONSTRUCTION_OMITTED", `${target} 只保留显式切面；Meet 顶点／棱点来源、比例与双点构造意图不会写入，请保留 JSON 主文件。`));
  }
  if (facts.preform) {
    diagnostics.push(diagnostic("warning", "PREFORM_PURPOSE_OMITTED", `${target} 只保留最终有效切面；预形工序用途标记不会写入，请保留 JSON 主文件。`));
  }
  if (facts.overwritten > 0) {
    diagnostics.push(diagnostic("warning", "OVERWRITTEN_FACETS_OMITTED", `最终实体中有 ${facts.overwritten} 条刻面记录已被后续切割覆盖，${target} 已省略；完整 CUT STACK 仍保留在 JSON 主文件中。`));
  }
  if (facts.optics.length) {
    diagnostics.push(diagnostic("warning", "OPTICS_METADATA_OMITTED", `${target} 只保存折射率；色散、体色、吸收与观察环境仍只保留在 JSON 中。`));
  }
  diagnostics.push(diagnostic("warning", "EDITOR_STATE_OMITTED", `${target} 不包含撤销历史、隐藏状态、毛坯定义或编辑器会话；请同时保留 JSON 作为完整主文件。`));

  const asc = document.metadata?.asc ?? {};
  const ri = Number(document.metadata?.optics?.material?.ior ?? document.metadata?.optics?.refractiveIndex);
  const design = {
    name: document.name,
    gear,
    symmetry: Number.isInteger(asc.symmetry) && asc.symmetry > 0 ? asc.symmetry : null,
    mirror: Boolean(asc.mirrorSymmetry),
    refractiveIndex: Number.isFinite(ri) && ri > 1 ? ri : 1.54,
    headings: [document.name, ...(Array.isArray(asc.headings) ? asc.headings.slice(1) : [])],
    footnotes: Array.isArray(asc.footnotes) ? [...asc.footnotes] : [],
    tiers: [...tiers, ...hiddenTiers.map((tier) => ({ ...structuredClone(tier), hidden: true }))],
    extras: {},
  };
  if (document.metadata?.gcs) {
    const { hiddenTiers: _hidden, ...gcs } = structuredClone(document.metadata.gcs);
    design.extras.gcs = gcs;
  }
  const compatibility = indexCompatibilityReport(exported, { scope: "final", finalFacets: exported, gears: [gear] });
  if (!compatibility[0].compatible) {
    diagnostics.push(diagnostic("warning", "FRACTIONAL_INDICES_PRESERVED", `${compatibility[0].incompatibleCount} 个最终平面在 ${gear} 齿盘上需要小数分度；${target} 保留这些方向，未取整。整齿最大偏差 ${compatibility[0].maxErrorDeg.toFixed(6)}°。`));
  }
  facts.compatibility = compatibility;
  facts.dimensions = solidDimensions(solid);
  return { status: statusFor(diagnostics), design: diagnostics.some((item) => item.severity === "error") ? null : design, diagnostics, facts };
}
