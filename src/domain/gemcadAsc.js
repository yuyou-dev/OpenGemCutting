import {
  createFacetingDocument,
  displayIndex,
  facetNormal,
  industryAngleToBetaDeg,
  normalizeIndex,
  resolveFacet,
  rotationalStockSupportOffset,
  validateFacetingDocument,
} from "./faceting.js";
import { clipPolyhedronByPlanes, createCenteredCube } from "./geometry.js";
import { summarizeEffectiveFacets } from "./meetJump.js";

const TARGET_GEAR = 96;
const EPSILON = 1e-9;

const REGION_LABELS = {
  crown: "冠部",
  girdle: "腰部",
  pavilion: "亭部",
};

const REGION_PREFIXES = {
  crown: "C",
  girdle: "G",
  pavilion: "P",
};

function diagnostic(severity, code, message, line) {
  return { severity, code, message, ...(line ? { line } : {}) };
}

function statusFor(diagnostics) {
  if (diagnostics.some((item) => item.severity === "error")) return "error";
  if (diagnostics.some((item) => item.severity === "warning")) return "warning";
  return "ready";
}

function decimalFraction(token) {
  const match = String(token).trim().match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const decimals = match[3] ?? "";
  const denominator = 10n ** BigInt(decimals.length);
  const numerator = BigInt(`${match[2]}${decimals}`) * (match[1] === "-" ? -1n : 1n);
  return { numerator, denominator };
}

function mapIndexTo96(token, gear, offsetToken = "0") {
  const fraction = decimalFraction(token);
  const offset = decimalFraction(offsetToken);
  if (!fraction || !offset) return null;
  const commonDenominator = fraction.denominator * offset.denominator;
  const effectiveNumerator = fraction.numerator * offset.denominator
    - offset.numerator * fraction.denominator;
  const gearBigInt = BigInt(gear);
  const scaledNumerator = effectiveNumerator * 96n;
  const scaledDenominator = commonDenominator * gearBigInt;
  if (scaledNumerator % scaledDenominator !== 0n) return null;
  const mapped = Number(scaledNumerator / scaledDenominator);
  return normalizeIndex(mapped);
}

function appendInstructions(tier, value) {
  const next = value.trim();
  if (!next) return;
  tier.instructions = tier.instructions
    ? `${tier.instructions} ${next}`
    : next;
}

function parseTier(line, lineNumber, diagnostics) {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0]?.toLowerCase() !== "a" || tokens.length < 3) {
    diagnostics.push(diagnostic("error", "INVALID_TIER", "刻面层记录缺少角度、平面距离或索引。", lineNumber));
    return null;
  }

  const angleToken = tokens[1].replaceAll("−", "-");
  const distanceToken = tokens[2].replaceAll("−", "-");
  const angle = Number(angleToken);
  const centerDistance = Number(distanceToken);
  if (!Number.isFinite(angle) || Math.abs(angle) > 90) {
    diagnostics.push(diagnostic("error", "INVALID_ANGLE", `角度“${tokens[1]}”必须位于 -90° 到 90°。`, lineNumber));
  }
  if (!Number.isFinite(centerDistance)) {
    diagnostics.push(diagnostic("error", "INVALID_DISTANCE", `平面距离“${tokens[2]}”不是有效数字。`, lineNumber));
  }

  const tier = {
    line: lineNumber,
    angle,
    angleToken,
    centerDistance,
    distanceToken,
    indexTokens: [],
    facetNames: {},
    name: "",
    instructions: "",
  };
  let cursor = 3;
  let previousIndexToken = "";
  while (cursor < tokens.length) {
    const token = tokens[cursor];
    if (token.toLowerCase() === "n") {
      const name = tokens[cursor + 1] ?? "";
      if (!previousIndexToken || !name) {
        diagnostics.push(diagnostic("error", "INVALID_FACET_NAME", "“n”必须紧跟一个索引，并在后面提供刻面名称。", lineNumber));
      } else {
        tier.facetNames[previousIndexToken] = name;
        if (!tier.name) tier.name = name;
      }
      cursor += 2;
      continue;
    }
    if (token === "G") {
      appendInstructions(tier, tokens.slice(cursor + 1).join(" "));
      break;
    }
    if (decimalFraction(token)) {
      tier.indexTokens.push(token);
      previousIndexToken = token;
    } else {
      diagnostics.push(diagnostic("warning", "UNKNOWN_TIER_TOKEN", `刻面层中的“${token}”未识别，已忽略。`, lineNumber));
    }
    cursor += 1;
  }

  if (tier.indexTokens.length === 0 && Math.abs(angle) > EPSILON) {
    diagnostics.push(diagnostic("error", "MISSING_INDICES", "刻面层没有任何索引。", lineNumber));
  }
  return tier;
}

export function parseGemCadAsc(source) {
  const diagnostics = [];
  const text = typeof source === "string" ? source.replace(/^\uFEFF/, "") : "";
  if (!text.trim()) {
    return {
      formatVersion: "",
      gear: null,
      gearOffset: 0,
      symmetry: null,
      mirrorSymmetry: false,
      refractiveIndex: null,
      headings: [],
      footnotes: [],
      comments: [],
      tiers: [],
      diagnostics: [diagnostic("error", "EMPTY_FILE", "ASC 文件为空。")],
    };
  }

  const parsed = {
    formatVersion: "",
    gear: null,
    gearOffset: 0,
    symmetry: null,
    mirrorSymmetry: false,
    refractiveIndex: null,
    headings: [],
    footnotes: [],
    comments: [],
    tiers: [],
    diagnostics,
  };
  let currentTier = null;

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line) return;
    const version = line.match(/^GemCad\s+(.+)$/i);
    if (version) {
      parsed.formatVersion = version[1].trim();
      if (parsed.formatVersion !== "5.0") {
        diagnostics.push(diagnostic("warning", "LEGACY_VERSION", `文件声明为 GemCad ${parsed.formatVersion}；将按 5.0 文本语义解析。`, lineNumber));
      }
      return;
    }

    const gear = line.match(/^g\s*([+-]?\d+)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/i);
    const relaxedGear = !parsed.gear && line.match(/^([+-]?\d+)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/);
    if (gear || relaxedGear) {
      const match = gear ?? relaxedGear;
      parsed.gear = Number(match[1]);
      parsed.gearOffset = Number(match[2]);
      parsed.gearOffsetToken = match[2];
      if (!gear) {
        diagnostics.push(diagnostic("warning", "MISSING_GEAR_PREFIX", "齿轮行缺少标准的“g”前缀，已按真实世界兼容写法读取。", lineNumber));
      }
      return;
    }

    const symmetry = line.match(/^y\s+(\d+)\s+([yn])$/i);
    if (symmetry) {
      parsed.symmetry = Number(symmetry[1]);
      parsed.mirrorSymmetry = symmetry[2].toLowerCase() === "y";
      return;
    }

    const refractiveIndex = line.match(/^I\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/);
    if (refractiveIndex) {
      parsed.refractiveIndex = Number(refractiveIndex[1]);
      return;
    }
    if (/^H(?:\s|$)/.test(line)) {
      parsed.headings.push(line.slice(1).trim());
      return;
    }
    if (/^F(?:\s|$)/.test(line)) {
      parsed.footnotes.push(line.slice(1).trim());
      return;
    }
    if (/^[#;]/.test(line)) {
      parsed.comments.push(line);
      return;
    }
    if (/^a(?:\s|$)/i.test(line)) {
      currentTier = parseTier(line, lineNumber, diagnostics);
      if (currentTier) parsed.tiers.push(currentTier);
      return;
    }
    if (/^G(?:\s|$)/.test(line) && currentTier) {
      appendInstructions(currentTier, line.slice(1));
      return;
    }
    if (currentTier && line.split(/\s+/).every((token) => decimalFraction(token))) {
      currentTier.indexTokens.push(...line.split(/\s+/));
      return;
    }

    const record = line[0]?.toLowerCase();
    diagnostics.push(diagnostic(
      record === "p" ? "error" : "warning",
      record === "p" ? "UNSUPPORTED_PREFORM" : "UNKNOWN_RECORD",
      record === "p"
        ? "ASC 预形记录无法由当前立方体毛坯模型无损表示。请先在 GemCad 中复制预形为真实刻面。"
        : `记录“${line}”未识别，已忽略。`,
      lineNumber,
    ));
  });

  if (!parsed.formatVersion) {
    diagnostics.push(diagnostic("error", "MISSING_SIGNATURE", "缺少“GemCad 5.0”文件签名。"));
  }
  if (!Number.isInteger(parsed.gear) || parsed.gear === 0) {
    diagnostics.push(diagnostic("error", "INVALID_GEAR", "缺少有效的非零整数齿轮规格。"));
  }
  if (!Number.isFinite(parsed.gearOffset)) {
    diagnostics.push(diagnostic("error", "INVALID_GEAR_OFFSET", "齿轮方向偏移不是有效数字。"));
  }
  if (parsed.refractiveIndex === null) {
    parsed.refractiveIndex = 1.54;
    diagnostics.push(diagnostic("warning", "DEFAULT_REFRACTIVE_INDEX", "文件未声明折射率，将使用 GemCad 默认值 1.54。"));
  } else if (parsed.refractiveIndex <= 1) {
    diagnostics.push(diagnostic("error", "INVALID_REFRACTIVE_INDEX", "折射率必须大于 1。"));
  }
  if (parsed.headings.length > 4) {
    diagnostics.push(diagnostic("warning", "EXCESS_HEADINGS", "GemCad 仅保证前四行标题兼容；额外标题会保留在 Facet 96 元数据中。"));
  }
  if (parsed.footnotes.length > 4) {
    diagnostics.push(diagnostic("warning", "EXCESS_FOOTNOTES", "GemCad 仅保证前四行脚注兼容；额外脚注会保留在 Facet 96 元数据中。"));
  }
  if (parsed.tiers.length === 0) {
    diagnostics.push(diagnostic("error", "NO_TIERS", "ASC 文件没有刻面层记录。"));
  }
  parsed.tiers.forEach((tier) => {
    if (tier.centerDistance < 0 && Math.abs(tier.angle) > EPSILON) {
      diagnostics.push(diagnostic("error", "NEGATIVE_NON_CULET_DISTANCE", "只有 0° 底尖层可以使用负平面距离。", tier.line));
    }
  });
  return parsed;
}

function tierRegion(tier) {
  if (Math.abs(Math.abs(tier.angle) - 90) <= EPSILON) return "girdle";
  if (tier.angle < 0 || Object.is(tier.angle, -0) || /^\s*-0(?:\.0*)?\s*$/.test(tier.angleToken)) {
    return "pavilion";
  }
  return "crown";
}

function tierLabel(tier, region, count) {
  const prefix = tier.name || `${REGION_PREFIXES[region]}${count}`;
  return `${prefix} ${REGION_LABELS[region]}`;
}

function geometrySummary(document) {
  const stock = createCenteredCube(document.stock.size, {
    center: document.stock.center,
    sourceOperationId: "rough-cube",
  });
  const solid = clipPolyhedronByPlanes(stock, document.facets.map((facet) => ({
    ...facet.plane,
    operationId: facet.patternId,
    faceId: facet.id,
    region: facet.region,
    operationType: facet.metadata?.operationType,
  })));
  if (solid.vertices.length === 0) return { solid, dimensions: null };
  const xs = solid.vertices.map((point) => point.x);
  const ys = solid.vertices.map((point) => point.y);
  const zs = solid.vertices.map((point) => point.z);
  const x = Math.max(...xs) - Math.min(...xs);
  const y = Math.max(...ys) - Math.min(...ys);
  const z = Math.max(...zs) - Math.min(...zs);
  const width = Math.min(x, y);
  const length = Math.max(x, y);
  return {
    solid,
    dimensions: {
      x,
      y,
      z,
      lengthToWidth: width > EPSILON ? length / width : null,
      heightToWidth: width > EPSILON ? z / width : null,
    },
  };
}

function baseSummary(parsed) {
  return {
    sourceGear: parsed.gear,
    targetGear: TARGET_GEAR,
    symmetry: parsed.symmetry,
    mirrorSymmetry: parsed.mirrorSymmetry,
    refractiveIndex: parsed.refractiveIndex,
    tierCount: parsed.tiers.length,
    facetCount: parsed.tiers.reduce((sum, tier) => sum + tier.indexTokens.length, 0),
    scale: null,
    dimensions: null,
    regions: { crown: 0, girdle: 0, pavilion: 0, table: 0 },
  };
}

export function inspectGemCadAsc(source, { fileName = "Imported GemCad Design.asc" } = {}) {
  const parsed = parseGemCadAsc(source);
  const diagnostics = [...parsed.diagnostics];
  const summary = baseSummary(parsed);
  if (diagnostics.some((item) => item.severity === "error")) {
    return { status: "error", document: null, parsed, diagnostics, summary };
  }

  const mappedTiers = parsed.tiers.map((tier) => {
    const sourceIndices = tier.indexTokens.length > 0
      ? tier.indexTokens
      : [String(Math.abs(parsed.gear))];
    if (Math.abs(tier.angle) <= EPSILON) {
      return { ...tier, indexTokens: sourceIndices, indices: [0], region: tierRegion(tier) };
    }
    const indices = [];
    for (const token of sourceIndices) {
      const value = Number(token);
      if (!Number.isFinite(value) || value < 0 || value > Math.abs(parsed.gear)) {
        diagnostics.push(diagnostic("error", "INDEX_OUT_OF_RANGE", `索引 ${token} 不在 0–${Math.abs(parsed.gear)} 齿轮范围内。`, tier.line));
        continue;
      }
      const mapped = mapIndexTo96(token, parsed.gear, parsed.gearOffsetToken ?? "0");
      if (mapped === null) {
        diagnostics.push(diagnostic("error", "INEXACT_INDEX_MAPPING", `索引 ${token} × 96 / ${parsed.gear} 不能得到整数齿，拒绝近似取整。`, tier.line));
        continue;
      }
      indices.push(mapped);
    }
    const uniqueIndices = [...new Set(indices)];
    if (uniqueIndices.length !== indices.length) {
      diagnostics.push(diagnostic("warning", "DUPLICATE_INDEX", "该层包含重复索引；导入时已去重。", tier.line));
    }
    return { ...tier, indexTokens: sourceIndices, indices: uniqueIndices, region: tierRegion(tier) };
  });

  if (parsed.gear !== TARGET_GEAR && !diagnostics.some((item) => item.code === "INEXACT_INDEX_MAPPING")) {
    diagnostics.push(diagnostic("warning", "GEAR_CONVERTED", `${parsed.gear} 齿索引将按精确整数关系映射到 96 齿；方位角不变。`));
  }
  if (Math.abs(parsed.gearOffset) > EPSILON && !diagnostics.some((item) => item.code === "INEXACT_INDEX_MAPPING")) {
    diagnostics.push(diagnostic("warning", "GEAR_OFFSET_APPLIED", `已按 (索引 − ${parsed.gearOffset}) × 96 / ${parsed.gear} 应用齿轮方位偏移。`));
  }
  if (diagnostics.some((item) => item.severity === "error")) {
    return { status: "error", document: null, parsed, diagnostics, summary };
  }

  let scale = 1;
  for (const tier of mappedTiers) {
    const industryAngleDeg = Math.abs(tier.angle);
    const betaDeg = industryAngleToBetaDeg(tier.region, industryAngleDeg);
    for (const index of tier.indices) {
      const support = rotationalStockSupportOffset(facetNormal(index, betaDeg));
      const distance = Math.abs(tier.centerDistance);
      if (distance > EPSILON) scale = Math.min(scale, support / distance);
    }
  }
  scale = Math.min(1, scale);
  summary.scale = scale;
  if (scale < 1 - EPSILON) {
    diagnostics.push(diagnostic(
      "warning",
      "UNIFORM_SCALE_NORMALIZATION",
      `为保持深度非负，全部平面距离统一缩放为 ${(scale * 100).toFixed(3)}%；角度、L/W 与冠亭高度比例保持不变。`,
    ));
  }

  const regionCounts = { crown: 0, girdle: 0, pavilion: 0 };
  const tableTiers = mappedTiers.filter((tier) => (
    tier.region === "crown" && Math.abs(tier.angle) <= EPSILON
  ));
  if (tableTiers.length === 0) {
    diagnostics.push(diagnostic("error", "MISSING_TABLE", "源文件没有可识别的 0° 水平台面；当前文档模型要求唯一固定 T1，不能无提示虚构。"));
    return { status: "error", document: null, parsed, diagnostics, summary };
  }
  if (tableTiers.length > 1) {
    diagnostics.push(diagnostic("error", "AMBIGUOUS_TABLE", "源文件包含多个 0° 水平层；当前文档模型要求唯一固定 T1，请先在 GemCad 中合并或删除多余台面。", tableTiers[1].line));
    return { status: "error", document: null, parsed, diagnostics, summary };
  }
  const [tableTier] = tableTiers;
  if (mappedTiers.indexOf(tableTier) !== 0) {
    diagnostics.push(diagnostic("warning", "TABLE_REORDERED", "T1 在 CUT STACK 中提升为固定首层；半空间几何不变，原 ASC 工序序号会保留供再次导出。", tableTier.line));
  }
  const facetGroups = [];
  for (const [tierIndex, tier] of mappedTiers.entries()) {
    const isTable = tier === tableTier;
    if (!isTable) regionCounts[tier.region] += 1;
    const patternId = isTable ? "table-facet" : `asc-tier-${tierIndex + 1}`;
    const label = isTable ? "T1 台面" : tierLabel(tier, tier.region, regionCounts[tier.region]);
    const industryAngleDeg = Math.abs(tier.angle);
    const betaDeg = industryAngleToBetaDeg(tier.region, industryAngleDeg);
    const metadata = {
      patternMode: "arbitrary",
      ...(isTable ? { operationType: "table", fixedAngle: true } : {}),
      asc: {
        order: tierIndex,
        line: tier.line,
        name: tier.name,
        instructions: tier.instructions,
        sourceAngle: tier.angleToken,
        sourceCenterDistance: tier.centerDistance,
        sourceIndices: tier.indexTokens,
      },
    };
    const facets = tier.indices.map((index, ordinal) => {
      const support = rotationalStockSupportOffset(facetNormal(index, betaDeg));
      const depth = Math.max(0, support - Math.abs(tier.centerDistance) * scale);
      const sourceIndex = tier.indexTokens[ordinal];
      return resolveFacet({
        id: `${patternId}:${displayIndex(index)}`,
        patternId,
        ordinal,
        region: tier.region,
        baseIndex: index,
        repeat: 1,
        mirror: 0,
        index,
        industryAngleDeg,
        depth,
        label,
        metadata: {
          ...metadata,
          asc: {
            ...metadata.asc,
            facetName: tier.facetNames[sourceIndex] ?? "",
          },
        },
      });
    });
    facetGroups.push({ isTable, facets });
  }

  const facets = [
    ...facetGroups.filter((group) => group.isTable).flatMap((group) => group.facets),
    ...facetGroups.filter((group) => !group.isTable).flatMap((group) => group.facets),
  ];
  const rawName = parsed.headings.find(Boolean) || fileName.replace(/\.asc$/i, "") || "Imported GemCad Design";
  const document = createFacetingDocument({
    name: rawName,
    facets,
    metadata: {
      optics: { refractiveIndex: parsed.refractiveIndex },
      asc: {
        formatVersion: parsed.formatVersion,
        sourceGear: parsed.gear,
        sourceGearOffset: parsed.gearOffset,
        symmetry: parsed.symmetry,
        mirrorSymmetry: parsed.mirrorSymmetry,
        headings: parsed.headings,
        footnotes: parsed.footnotes,
        comments: parsed.comments,
        importScale: scale,
      },
    },
  });
  const geometry = geometrySummary(document);
  if (geometry.solid.vertices.length === 0) {
    diagnostics.push(diagnostic("error", "EMPTY_GEOMETRY", "这些切面组合会移除全部毛坯，无法导入。"));
  } else {
    const survivingPatterns = new Set(
      geometry.solid.faces.map((face) => face.sourceOperationId).filter(Boolean),
    );
    facetGroups.forEach((group) => {
      const patternId = group.facets[0]?.patternId;
      if (patternId && !survivingPatterns.has(patternId)) {
        diagnostics.push(diagnostic("warning", "REDUNDANT_TIER", `图层“${group.facets[0].label}”在最终实体中没有保留刻面；仍按原工序保存在 CUT STACK。`, group.facets[0].metadata?.asc?.line));
      }
    });
    if (survivingPatterns.has("rough-cube")) {
      diagnostics.push(diagnostic("warning", "ROUGH_STOCK_REMAINS", "最终实体仍包含毛坯原始面；请检查源 ASC 是否依赖未编码的预形。"));
    }
  }
  summary.dimensions = geometry.dimensions;
  summary.tierCount = facetGroups.length;
  summary.facetCount = facets.length;
  for (const tier of mappedTiers) summary.regions[tier.region] += tier.indices.length;
  summary.regions.table = tableTier.indices.length;
  summary.regions.crown -= tableTier.indices.length;

  return {
    status: statusFor(diagnostics),
    document: diagnostics.some((item) => item.severity === "error") ? null : document,
    parsed,
    diagnostics,
    summary,
  };
}

function groupFacets(facets) {
  const groups = new Map();
  facets.forEach((facet) => {
    if (!groups.has(facet.patternId)) groups.set(facet.patternId, []);
    groups.get(facet.patternId).push(facet);
  });
  return [...groups.values()];
}

function effectiveFacets(facets, solid) {
  const survivingFacetIds = new Set(summarizeEffectiveFacets(solid).effectiveFacetIds);
  return facets.filter((facet) => survivingFacetIds.has(facet.id));
}

function safeTierName(value, fallback, diagnostics) {
  const raw = String(value ?? "").trim();
  if (/^[A-Za-z0-9_.-]+$/.test(raw)) return raw;
  if (raw) diagnostics.push(diagnostic("warning", "LAYER_NAME_NORMALIZED", `图层名“${raw}”已转换为 GemCad 单词标识“${fallback}”。`));
  return fallback;
}

function operationRank(group) {
  const first = group[0];
  const sourceOrder = first.metadata?.asc?.order;
  if (Number.isInteger(sourceOrder)) return sourceOrder;
  if (first.metadata?.operationType === "table") return 400000;
  return { pavilion: 100000, girdle: 200000, crown: 300000 }[first.region] ?? 350000;
}

export function serializeGemCadAsc(document) {
  const diagnostics = [];
  const validation = validateFacetingDocument(document);
  if (!validation.valid) {
    validation.errors.slice(0, 8).forEach((error) => diagnostics.push(diagnostic("error", "INVALID_DOCUMENT", `${error.path} ${error.message}`)));
    return { status: "error", text: "", diagnostics, summary: null };
  }

  const geometry = geometrySummary(document);
  const exportedFacets = effectiveFacets(document.facets, geometry.solid);
  const omittedFacetCount = document.facets.length - exportedFacets.length;
  const groups = groupFacets(exportedFacets).sort((left, right) => operationRank(left) - operationRank(right));
  const ascMetadata = document.metadata?.asc ?? {};
  const symmetry = Number.isInteger(ascMetadata.symmetry) && ascMetadata.symmetry > 0 ? ascMetadata.symmetry : 1;
  const mirror = ascMetadata.mirrorSymmetry ? "y" : "n";
  if (!ascMetadata.symmetry) {
    diagnostics.push(diagnostic("warning", "SYMMETRY_NORMALIZED", "全局对称设置将写为 1-fold / no mirror；所有真实刻面仍由显式索引完整保留。"));
  }
  const ri = Number(document.metadata?.optics?.material?.ior ?? document.metadata?.optics?.refractiveIndex);
  const refractiveIndex = Number.isFinite(ri) && ri > 1 ? ri : 1.54;
  const headings = [document.name, ...(Array.isArray(ascMetadata.headings) ? ascMetadata.headings.slice(1) : [])].slice(0, 4);
  const footnotes = Array.isArray(ascMetadata.footnotes) ? ascMetadata.footnotes.slice(0, 4) : [];
  if ([...headings, ...footnotes].some((line) => /[^\x00-\x7F]/.test(line))) {
    diagnostics.push(diagnostic("warning", "UNICODE_TEXT", "标题或脚注含非 ASCII 字符；现代 UTF-8 工具可读取，但旧版 GemCad 的显示编码需人工确认。"));
  }

  let flattened = false;
  const tierLines = groups.map((group, groupIndex) => {
    const first = group[0];
    const sameTier = group.every((facet) => (
      facet.region === first.region
      && Math.abs(facet.industryAngleDeg - first.industryAngleDeg) <= EPSILON
      && Math.abs(facet.plane.offset - first.plane.offset) <= EPSILON
    ));
    if (!sameTier) {
      diagnostics.push(diagnostic("error", "INCONSISTENT_LAYER", `图层“${first.label ?? first.patternId}”内的刻面不共享角度和平面距离，不能写为一个 ASC tier。`));
    }
    if (first.repeat > 1 || first.mirror > 0) flattened = true;
    const isTable = first.metadata?.operationType === "table";
    const sourceAngle = Number(first.metadata?.asc?.sourceAngle);
    const angle = isTable
      ? 0
      : first.region === "pavilion"
        ? -first.industryAngleDeg
        : first.region === "girdle" && Number.isFinite(sourceAngle) && Math.abs(sourceAngle) === 90
          ? sourceAngle
          : first.industryAngleDeg;
    const fallback = isTable ? "T" : `${REGION_PREFIXES[first.region]}${groupIndex + 1}`;
    const name = safeTierName(first.metadata?.asc?.name || first.label?.split(/\s+/)[0], fallback, diagnostics);
    const indexEntries = [];
    const seenIndices = new Set();
    group.forEach((facet) => {
      const index = displayIndex(facet.index);
      if (seenIndices.has(index)) return;
      seenIndices.add(index);
      indexEntries.push({ index, facetName: facet.metadata?.asc?.facetName ?? "" });
    });
    const hasPerFacetNames = indexEntries.some((entry) => entry.facetName);
    const renderedIndices = indexEntries.map((entry, index) => {
      const rawName = entry.facetName || (!hasPerFacetNames && index === 0 ? name : "");
      return rawName
        ? `${entry.index} n ${safeTierName(rawName, name, diagnostics)}`
        : String(entry.index);
    }).join(" ");
    const instruction = String(first.metadata?.asc?.instructions ?? "").trim();
    return `a ${angle.toFixed(6)} ${first.plane.offset.toFixed(8)} ${renderedIndices}${instruction ? ` G ${instruction}` : ""}`;
  });

  if (flattened) {
    diagnostics.push(diagnostic("warning", "PARAMETRIC_RELATIONSHIP_FLATTENED", "重复与镜像关系会展开为显式索引；刻面几何保持，但该参数关系无法从 ASC 恢复。"));
  }
  if (document.facets.some((facet) => facet.metadata?.construction?.type === "vertex-meet")) {
    diagnostics.push(diagnostic("warning", "MEET_CONSTRUCTION_OMITTED", "ASC 只保留显式切面；Meet 顶点来源与构造意图不会写入，请保留 JSON 主文件。"));
  }
  if (omittedFacetCount > 0) {
    diagnostics.push(diagnostic(
      "warning",
      "OVERWRITTEN_FACETS_OMITTED",
      `最终实体中有 ${omittedFacetCount} 条刻面记录已被后续切割覆盖，ASC 已省略；完整 CUT STACK 仍保留在 JSON 主文件中。`,
    ));
  }
  const opticsKeys = Object.keys(document.metadata?.optics ?? {}).filter((key) => key !== "refractiveIndex");
  if (opticsKeys.length > 0) {
    diagnostics.push(diagnostic("warning", "OPTICS_METADATA_OMITTED", "ASC 只保存折射率；色散、体色、吸收与观察环境仍只保留在 JSON 中。"));
  }
  diagnostics.push(diagnostic("warning", "EDITOR_STATE_OMITTED", "ASC 不包含撤销历史、隐藏状态、毛坯定义或编辑器会话；请同时保留 JSON 作为完整主文件。"));

  const summary = {
    sourceGear: TARGET_GEAR,
    targetGear: TARGET_GEAR,
    symmetry,
    mirrorSymmetry: mirror === "y",
    refractiveIndex,
    tierCount: groups.length,
    facetCount: exportedFacets.length,
    storedFacetCount: document.facets.length,
    effectiveFacetCount: exportedFacets.length,
    omittedFacetCount,
    dimensions: geometry.dimensions,
  };
  if (diagnostics.some((item) => item.severity === "error")) {
    return { status: "error", text: "", diagnostics, summary };
  }
  const text = [
    "GemCad 5.0",
    "g96 0.0",
    `y ${symmetry} ${mirror}`,
    `I ${refractiveIndex}`,
    ...headings.map((line) => `H ${line}`),
    ...tierLines,
    ...footnotes.map((line) => `F ${line}`),
    "",
  ].join("\n");
  return { status: statusFor(diagnostics), text, diagnostics, summary };
}
