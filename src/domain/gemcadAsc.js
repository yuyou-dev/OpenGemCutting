import { normalizeIndex } from "./faceting.js";
import {
  cleanIndex,
  designFromDocument,
  designSummary,
  documentFromDesign,
  markTable,
  tierRegion,
} from "./formats/planeDesign.js";
import { diagnostic, statusFor } from "./formats/shared.js";

const EPSILON = 1e-9;

const REGION_PREFIXES = {
  crown: "C",
  girdle: "G",
  pavilion: "P",
};

function isDecimalToken(token) {
  const text = String(token).trim();
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) && Number.isFinite(Number(text));
}

function sourceIndex(token, gear, offset = 0) {
  return normalizeIndex((Number(token) - offset) * Math.sign(gear), Math.abs(gear));
}

function appendInstructions(tier, value) {
  const next = value.trim();
  if (!next) return;
  tier.instructions = tier.instructions
    ? `${tier.instructions} ${next}`
    : next;
}

// Tier tokens: index numbers, "n name" for the preceding index and "G text"
// to the end of the line. Continuation lines use the same grammar, so a wrapped
// tier keeps every index, facet name and instruction.
function consumeTierTokens(tier, tokens, lineNumber, diagnostics) {
  let cursor = 0;
  while (cursor < tokens.length) {
    const token = tokens[cursor];
    if (token.toLowerCase() === "n") {
      const name = tokens[cursor + 1] ?? "";
      if (!tier.lastIndexToken || !name) {
        diagnostics.push(diagnostic("error", "INVALID_FACET_NAME", "“n”必须紧跟一个索引，并在后面提供刻面名称。", lineNumber));
      } else {
        tier.facetNames[tier.lastIndexToken] = name;
        if (!tier.name) tier.name = name;
      }
      cursor += 2;
      continue;
    }
    if (token === "G") {
      appendInstructions(tier, tokens.slice(cursor + 1).join(" "));
      break;
    }
    if (isDecimalToken(token.replaceAll("−", "-"))) {
      const value = token.replaceAll("−", "-");
      tier.indexTokens.push(value);
      tier.lastIndexToken = value;
    } else {
      diagnostics.push(diagnostic("warning", "UNKNOWN_TIER_TOKEN", `刻面层中的“${token}”未识别，已忽略。`, lineNumber));
    }
    cursor += 1;
  }
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
    lastIndexToken: "",
  };
  consumeTierTokens(tier, tokens.slice(3), lineNumber, diagnostics);
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
    const firstToken = line.split(/\s+/)[0].replaceAll("−", "-");
    if (currentTier && (isDecimalToken(firstToken) || firstToken.toLowerCase() === "n")) {
      consumeTierTokens(currentTier, line.split(/\s+/), lineNumber, diagnostics);
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
  if (!Number.isInteger(parsed.gear) || parsed.gear === 0 || Math.abs(parsed.gear) > 360) {
    diagnostics.push(diagnostic("error", "INVALID_GEAR", "齿轮规格必须为 ±1 到 ±360 的非零整数。"));
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
    if (tier.indexTokens.length === 0 && Math.abs(tier.angle) > EPSILON) {
      diagnostics.push(diagnostic("error", "MISSING_INDICES", "刻面层没有任何索引。", tier.line));
    }
    if (tier.centerDistance < 0 && Math.abs(tier.angle) > EPSILON) {
      diagnostics.push(diagnostic("error", "NEGATIVE_NON_CULET_DISTANCE", "只有 0° 底尖层可以使用负平面距离。", tier.line));
    }
  });
  return parsed;
}

/** GemCad ASC text as a PlaneDesign, without the workbench's table rule: a
 * tableless or open design can still be converted to another format. */
export function readAscDesign(source, { fileName = "Imported GemCad Design.asc" } = {}) {
  const parsed = parseGemCadAsc(source);
  const diagnostics = [...parsed.diagnostics];
  if (diagnostics.some((item) => item.severity === "error")) {
    return { status: "error", design: null, parsed, diagnostics, summary: baseSummary(parsed) };
  }

  const gear = Math.abs(parsed.gear);
  const tiers = markTable(parsed.tiers.map((tier) => {
    const region = tierRegion(tier.angle, tier.centerDistance, tier.angleToken);
    const common = {
      angle: tier.angle,
      distance: tier.centerDistance,
      region,
      table: false,
      name: tier.name,
      instructions: tier.instructions,
      line: tier.line,
      sourceAngle: tier.angleToken,
      hidden: false,
    };
    const tokens = tier.indexTokens.length > 0 ? tier.indexTokens : [String(gear)];
    if (Math.abs(tier.angle) <= EPSILON) {
      return { ...common, entries: [{ index: 0, token: tokens[0], name: tier.facetNames[tokens[0]] ?? "", finish: null }] };
    }
    let normalized = false;
    const entries = [];
    for (const token of tokens) {
      const value = Number(token);
      if (value < 0 || value > gear) normalized = true;
      const index = sourceIndex(token, parsed.gear, parsed.gearOffset);
      if (entries.some((entry) => entry.index === index)) {
        diagnostics.push(diagnostic("warning", "DUPLICATE_INDEX", "该层包含重复索引；导入时已去重。", tier.line));
        continue;
      }
      entries.push({ index, token, name: tier.facetNames[token] ?? "", finish: null });
    }
    if (normalized) {
      diagnostics.push(diagnostic("warning", "INDEX_NORMALIZED", `该层含负索引或超出 0–${gear} 的索引；已按 ${gear} 齿循环换算到同一方向。`, tier.line));
    }
    return { ...common, entries };
  }));

  if (Math.abs(parsed.gearOffset) > EPSILON || parsed.gear < 0) {
    diagnostics.push(diagnostic("info", "GEAR_OFFSET_APPLIED", `按源 ${parsed.gear} 齿盘应用方位偏移 ${parsed.gearOffset}，保留精确方向与小数分度；文档使用 ${gear} 齿正向标记。`));
  }
  const design = {
    name: parsed.headings.find((line) => line.trim()) || fileName.replace(/\.asc$/i, "") || "Imported GemCad Design",
    gear,
    symmetry: parsed.symmetry,
    mirror: parsed.mirrorSymmetry,
    refractiveIndex: parsed.refractiveIndex,
    headings: parsed.headings,
    footnotes: parsed.footnotes,
    tiers,
    extras: {
      asc: {
        formatVersion: parsed.formatVersion,
        sourceGear: parsed.gear,
        sourceGearOffset: parsed.gearOffset,
        comments: parsed.comments,
      },
    },
  };
  const summary = { ...baseSummary(parsed), ...designSummary(design), tierCount: parsed.tiers.length };
  return { status: statusFor(diagnostics), design, parsed, diagnostics, summary };
}

export function inspectGemCadAsc(source, options = {}) {
  const read = readAscDesign(source, options);
  if (!read.design) return { status: "error", document: null, parsed: read.parsed, diagnostics: read.diagnostics, summary: read.summary };
  return documentFromDesign(read.design, { diagnostics: read.diagnostics, summary: read.summary, parsed: read.parsed });
}

function baseSummary(parsed) {
  return {
    sourceGear: parsed.gear,
    targetGear: Math.abs(parsed.gear),
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

function safeTierName(value, fallback, diagnostics) {
  const raw = String(value ?? "").trim();
  if (/^[A-Za-z0-9_.-]+$/.test(raw)) return raw;
  if (raw) diagnostics.push(diagnostic("warning", "LAYER_NAME_NORMALIZED", `图层名“${raw}”已转换为 GemCad 单词标识“${fallback}”。`));
  return fallback;
}

/** Write a PlaneDesign as GemCad 5.0 text; every loss is reported. */
export function writeAscDesign(design, { diagnostics = [] } = {}) {
  const tiers = design.tiers.filter((tier) => !tier.hidden);
  const hidden = design.tiers.length - tiers.length;
  if (hidden) {
    diagnostics.push(diagnostic("warning", "HIDDEN_TIERS_OMITTED", `${hidden} 个在 Gem Cut Studio 中隐藏（不切）的层不会写入 ASC；GemCad 没有隐藏层。`));
  }
  if (!design.symmetry) {
    diagnostics.push(diagnostic("warning", "SYMMETRY_NORMALIZED", "全局对称设置将写为 1-fold / no mirror；所有真实刻面仍由显式索引完整保留。"));
  }
  const headings = design.headings.slice(0, 4);
  const footnotes = design.footnotes.slice(0, 4);
  if (design.headings.length > 4 || design.footnotes.length > 4) {
    diagnostics.push(diagnostic("warning", "TEXT_LINES_TRUNCATED", "GemCad 只保留前四行标题与前四行脚注；其余行不会写入 ASC。"));
  }
  if ([...headings, ...footnotes].some((line) => /[^\x00-\x7F]/.test(line))) {
    diagnostics.push(diagnostic("warning", "UNICODE_TEXT", "标题或脚注含非 ASCII 字符；现代 UTF-8 工具可读取，但旧版 GemCad 的显示编码需人工确认。"));
  }
  const written = tiers.map((tier, tierIndex) => {
    const fallback = tier.table ? "T" : `${REGION_PREFIXES[tier.region]}${tierIndex + 1}`;
    const name = safeTierName(tier.name, fallback, diagnostics);
    const hasFacetNames = tier.entries.some((entry) => entry.name);
    const entries = tier.entries.map((entry, index) => {
      const raw = entry.name || (!hasFacetNames && index === 0 ? name : "");
      return { index: cleanIndex(entry.index, design.gear), name: raw ? safeTierName(raw, name, diagnostics) : "" };
    });
    return { angle: tier.angle, distance: tier.distance, entries, instructions: String(tier.instructions ?? "").replace(/\s+/g, " ").trim() };
  });
  const frosted = tiers.reduce((sum, tier) => sum + tier.entries.filter((entry) => entry.finish?.state === "frosted").length, 0);
  if (frosted > 0) {
    diagnostics.push(diagnostic("warning", "FROSTED_FINISH_OMITTED", `${frosted} 个磨砂面在 ASC 中写为普通刻面；GemCad 没有磨砂表面，磨砂标注只保留在 JSON 与 GCS 中。`));
  }
  if (design.extras?.gcs?.render) {
    diagnostics.push(diagnostic("warning", "GCS_RENDER_OMITTED", "Gem Cut Studio 的材质、颜色与灯光设置不会写入 ASC；ASC 只保存折射率。"));
  }
  const text = formatAscText({
    gear: design.gear,
    symmetry: design.symmetry || 1,
    mirror: Boolean(design.symmetry) && design.mirror,
    refractiveIndex: design.refractiveIndex,
    headings,
    footnotes,
    tiers: written,
  });
  return { status: statusFor(diagnostics), text, diagnostics };
}

export function serializeGemCadAsc(document) {
  const converted = designFromDocument(document, { target: "ASC" });
  const { design, diagnostics, facts } = converted;
  const summary = design || facts.effectiveFacetCount !== undefined ? {
    sourceGear: design?.gear ?? document.indexGear?.teeth ?? 96,
    targetGear: design?.gear ?? document.indexGear?.teeth ?? 96,
    compatibility: facts.compatibility,
    symmetry: design?.symmetry || 1,
    mirrorSymmetry: Boolean(design?.symmetry) && Boolean(design?.mirror),
    refractiveIndex: design?.refractiveIndex,
    tierCount: design?.tiers.filter((tier) => !tier.hidden).length ?? 0,
    facetCount: facts.effectiveFacetCount,
    storedFacetCount: facts.storedFacetCount,
    effectiveFacetCount: facts.effectiveFacetCount,
    omittedFacetCount: facts.overwritten,
    dimensions: facts.dimensions,
  } : null;
  if (!design) return { status: "error", text: "", diagnostics, summary };
  const written = writeAscDesign(design, { diagnostics });
  return { status: written.status, text: written.text, diagnostics, summary };
}

/**
 * Write GemCad 5.0 text. Tiers: {angle (signed; culet 0 with negative
 * distance), distance, entries [{index, name}], instructions}. Indices are
 * written in `gear` numbering with location 0; fractional indices stay exact.
 * Lines end in CRLF like GemCad's own files: Gem Cut Studio 1.1 reads a
 * trailing character into the last name of LF-only files.
 */
export function formatAscText({ gear, symmetry = 1, mirror = false, refractiveIndex = 1.54, headings = [], footnotes = [], tiers }) {
  const tierLines = tiers.map(({ angle, distance, entries, instructions = "" }) => {
    const rendered = entries.map(({ index, name }) => name ? `${index} n ${name}` : String(index)).join(" ");
    return `a ${angle.toFixed(6)} ${distance.toFixed(8)}${rendered ? ` ${rendered}` : ""}${instructions ? ` G ${instructions}` : ""}`;
  });
  return [
    "GemCad 5.0",
    `g${gear} 0.0`,
    `y ${symmetry} ${mirror ? "y" : "n"}`,
    `I ${refractiveIndex}`,
    ...headings.map((line) => `H ${line}`),
    ...tierLines,
    ...footnotes.map((line) => `F ${line}`),
    "",
  ].join("\r\n");
}
