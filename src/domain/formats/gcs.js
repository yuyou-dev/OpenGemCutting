import { FORMAT_LIMITS, diagnostic, fail, formatNumber, readInteger, readNumber, statusFor } from "./shared.js";
import { parseXml, writeXml } from "./xml.js";
import { clipPolyhedronByPlanes, createCenteredCube } from "../geometry.js";
import { cleanIndex, designSummary, individualFacetNames, markTable, planeDesignSolid, solidDimensions, textLines, tierNormal, visibleTiers } from "./planeDesign.js";

/*
 * Gem Cut Studio (.gcs) XML, per the Gem Cut Studio 1.1 manual and real 1.1
 * desktop saves. Calibrated conventions:
 * - geometry: GCS azimuth + 90° = this project's azimuth (a rotation about Z);
 * - index_angle labels: crown = our azimuth, pavilion and girdle = 360° − our
 *   azimuth (the transfer reverses the wheel); labels are checked against the
 *   normals and the normals win. A twisted (chiral) design opened in Gem Cut
 *   Studio 1.1 matched its own ASC import in indices and render (2026-09-25);
 * - tier angle: 0 table, 90 girdle, over 90 pavilion, 180 flat culet;
 * - depth: plane distance from the file origin (vertices are a derived cache);
 * - frosting: any value above 0 is Gem Cut Studio's on/off frost.
 */

export const GCS_FROST_ALPHA = 0.25;
const EPSILON = 1e-9;
const DEG = 180 / Math.PI;
const KNOWN = {
  GemCutStudio: ["version"],
  index: ["gear", "base", "symmetry", "mirror"],
  tier: ["angle", "depth", "name", "instructions", "visible", "guide", "frosting"],
  facet: ["nx", "ny", "nz", "index_angle", "frosting"],
  vertex: ["x", "y", "z"],
  render: ["material", "refractive_index", "dispersion", "clarity", "density", "lighting_model"],
  color: ["r", "g", "b"],
  info: ["title", "author", "date", "header2", "footer1", "footer2", "shape", "size_min", "size_max", "ri_min", "ri_max"],
};
const CHILDREN = { GemCutStudio: ["index", "tier", "render", "info"], tier: ["facet"], facet: ["vertex"], render: ["color"] };

const mod360 = (value) => ((value % 360) + 360) % 360;
const toOurs = ({ x, y, z }) => ({ x: -y, y: x, z });
const toGcs = ({ x, y, z }) => ({ x: y, y: -x, z });

function flag(value, fallback, label, line) {
  if (value === undefined) return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return fail("GCS_INVALID_FLAG", `${label}必须为 true 或 false。`, line);
}

function countUnknown(node, counter) {
  const keys = KNOWN[node.name];
  if (!keys) { counter.count += 1; return; }
  counter.count += Object.keys(node.attrs).filter((key) => !keys.includes(key)).length;
  for (const child of node.children) {
    if (!(CHILDREN[node.name] ?? []).includes(child.name)) counter.count += 1;
    else countUnknown(child, counter);
  }
}

function expectedLabel(region, azimuth) {
  return region === "crown" ? mod360(azimuth) : mod360(360 - azimuth);
}

export function frostedFinish() {
  return { version: 1, model: "ggx-dielectric", state: "frosted", alpha: GCS_FROST_ALPHA };
}

/** Read a .gcs file into a PlaneDesign. */
export function readGcsDesign(text, { fileName = "Imported Gem Cut Studio Design.gcs" } = {}) {
  const diagnostics = [];
  const root = parseXml(text);
  if (root.name !== "GemCutStudio") fail("GCS_ROOT", "这不是 Gem Cut Studio 文件（缺少 GemCutStudio 根节点）。");
  const version = readInteger(root.attrs.version ?? "1000", "GCS 版本", { min: 1, max: 1000000 });
  if (version > 1000) {
    diagnostics.push(diagnostic("warning", "GCS_VERSION_NEWER", `文件来自更新版本的 Gem Cut Studio（格式版本 ${version}）；已按 1.1 版的格式读取，新增内容可能没有读取。`));
  }
  const unknown = { count: 0 };
  countUnknown(root, unknown);
  if (unknown.count) {
    diagnostics.push(diagnostic("warning", "GCS_UNKNOWN_FIELDS", `${unknown.count} 项未识别的 Gem Cut Studio 字段未读取。`));
  }

  const indexNodes = root.children.filter((node) => node.name === "index");
  if (indexNodes.length !== 1) fail("GCS_INDEX", "Gem Cut Studio 文件必须有且只有一个 index 设置。");
  const indexAttrs = indexNodes[0].attrs;
  const gear = readInteger(indexAttrs.gear, "齿盘齿数", { min: 1, max: 360, line: indexNodes[0].line });

  const tierNodes = root.children.filter((node) => node.name === "tier");
  if (!tierNodes.length) fail("GCS_NO_TIERS", "文件没有任何刻面层。");
  if (tierNodes.length > FORMAT_LIMITS.tiers) fail("GCS_TIER_BUDGET", "刻面层数量超出限制。");

  let facetTotal = 0;
  let vertexTotal = 0;
  let labelMismatch = 0;
  let depthFromVertices = 0;
  let staleVertices = 0;
  const planes = [];
  const sources = [];
  for (const [tierIndex, tierNode] of tierNodes.entries()) {
    const attrs = tierNode.attrs;
    const line = tierNode.line;
    const polar = readNumber(attrs.angle, "层角度", { min: 0, max: 180, line });
    const tierDepth = attrs.depth === undefined ? null : readNumber(attrs.depth, "层深度", { line });
    const hidden = !flag(attrs.visible, true, "visible", line);
    const guide = flag(attrs.guide, false, "guide", line);
    const tierFrost = attrs.frosting === undefined ? 0 : readNumber(attrs.frosting, "磨砂值", { min: 0, max: 100, line });
    const facetNodes = tierNode.children.filter((node) => node.name === "facet");
    if (!facetNodes.length) fail("GCS_EMPTY_TIER", `第 ${tierIndex + 1} 层没有刻面。`, line);

    for (const facetNode of facetNodes) {
      facetTotal += 1;
      if (facetTotal > FORMAT_LIMITS.facets) fail("GCS_FACET_BUDGET", "刻面数量超出限制。");
      const fa = facetNode.attrs;
      const fline = facetNode.line;
      const vertexNodes = facetNode.children.filter((node) => node.name === "vertex");
      if (vertexNodes.length > FORMAT_LIMITS.polygonVertices) fail("GCS_POLYGON_BUDGET", "单个刻面顶点过多。", fline);
      vertexTotal += vertexNodes.length;
      if (vertexTotal > FORMAT_LIMITS.totalVertices) fail("GCS_VERTEX_BUDGET", "顶点总数超出限制。");
      const vertices = vertexNodes.map((node) => toOurs({
        x: readNumber(node.attrs.x, "顶点 x", { line: node.line }),
        y: readNumber(node.attrs.y, "顶点 y", { line: node.line }),
        z: readNumber(node.attrs.z, "顶点 z", { line: node.line }),
      }));
      const label = fa.index_angle === undefined ? null : readNumber(fa.index_angle, "分度角", { min: -3600, max: 3600, line: fline });
      const components = ["nx", "ny", "nz"].filter((key) => fa[key] !== undefined);
      if (components.length && components.length !== 3) fail("GCS_PARTIAL_NORMAL", "法向量必须同时给出 nx、ny、nz。", fline);

      let normal;
      if (components.length) {
        const raw = { x: readNumber(fa.nx, "nx", { line: fline }), y: readNumber(fa.ny, "ny", { line: fline }), z: readNumber(fa.nz, "nz", { line: fline }) };
        const length = Math.hypot(raw.x, raw.y, raw.z);
        if (length < 1e-12) fail("GCS_ZERO_NORMAL", "刻面法向量不能为零。", fline);
        normal = toOurs({ x: raw.x / length, y: raw.y / length, z: raw.z / length });
      } else if (label !== null) {
        const region = Math.abs(polar - 90) < 1e-9 ? "girdle" : polar > 90 ? "pavilion" : "crown";
        const azimuth = (region === "crown" ? label : 360 - label) / DEG;
        const sin = Math.sin(polar / DEG);
        normal = { x: sin * Math.cos(azimuth), y: sin * Math.sin(azimuth), z: Math.cos(polar / DEG) };
      } else {
        fail("GCS_NO_NORMAL", "刻面既没有法向量也没有分度角，无法确定方向。", fline);
      }

      const planeOf = (point) => normal.x * point.x + normal.y * point.y + normal.z * point.z;
      let offset = tierDepth;
      if (offset === null) {
        if (vertices.length < 3) fail("GCS_NO_DEPTH", "刻面没有层深度，也没有足够的顶点推算深度。", fline);
        offset = vertices.reduce((sum, point) => sum + planeOf(point), 0) / vertices.length;
        depthFromVertices += 1;
      } else if (vertices.some((point) => Math.abs(planeOf(point) - offset) > 1e-4 * Math.max(1, Math.abs(offset)))) {
        staleVertices += 1;
      }
      const facetPolar = Math.acos(Math.max(-1, Math.min(1, normal.z))) * DEG;
      if (Math.abs(facetPolar - polar) > 1e-6) {
        diagnostics.push(diagnostic("warning", "GCS_ANGLE_NORMAL_MISMATCH", `层角度 ${polar}° 与刻面法向对应的 ${facetPolar.toFixed(6)}° 不一致；已按法向计算。`, fline));
      }
      const frost = fa.frosting === undefined ? tierFrost : readNumber(fa.frosting, "磨砂值", { min: 0, max: 100, line: fline });
      planes.push({
        tierIndex, normal, offset, label, hasNormal: components.length === 3, line: fline,
        entry: {
          token: fa.index_angle ?? "",
          name: "",
          finish: frost > 0 ? frostedFinish() : null,
          ...(fa.frosting !== undefined || attrs.frosting !== undefined ? { gcs: { frosting: fa.frosting ?? attrs.frosting } } : {}),
        },
      });
    }
    sources.push({ attrs, line, hidden, guide });
  }

  const shift = axisShift(planes);
  if (shift) diagnostics.push(diagnostic("info", "GCS_RECENTERED", "文件原点不在宝石内部；已沿旋转轴移动参考点，形状不变。"));
  const tiers = [];
  for (const [tierIndex, source] of sources.entries()) {
    const groups = [];
    for (const plane of planes.filter((item) => item.tierIndex === tierIndex)) {
      const { normal } = plane;
      const distance = plane.offset - normal.z * shift;
      const horizontal = Math.hypot(normal.x, normal.y) < 1e-10;
      const polarDeg = Math.acos(Math.max(-1, Math.min(1, normal.z))) * DEG;
      const region = Math.abs(polarDeg - 90) < 1e-7 ? "girdle" : polarDeg > 90 ? "pavilion" : "crown";
      const industry = region === "girdle" ? 90 : region === "crown" ? polarDeg : 180 - polarDeg;
      const culet = region === "pavilion" && industry < 1e-9;
      const angle = region === "girdle" ? 90 : region === "pavilion" ? (culet ? 0 : -industry) : industry;
      const signedDistance = culet ? -distance : distance;
      const azimuth = horizontal ? 0 : mod360(Math.atan2(normal.y, normal.x) * DEG);
      const index = horizontal ? 0 : cleanIndex(azimuth * gear / 360, gear);
      if (!horizontal && plane.label !== null && plane.hasNormal
        && Math.abs(mod360(plane.label - expectedLabel(region, azimuth) + 180) - 180) > 1e-4) labelMismatch += 1;
      const angleKey = Number(angle.toFixed(7));
      let group = groups.find((item) => item.region === region && item.angleKey === angleKey
        && Math.abs(item.distance - signedDistance) <= 1e-9 * Math.max(1, Math.abs(signedDistance)));
      if (!group) {
        group = { region, angleKey, angle: Number(angle.toFixed(12)), distance: signedDistance, entries: [] };
        groups.push(group);
      }
      if (group.entries.some((item) => Math.abs(item.index - index) < 1e-9)) {
        diagnostics.push(diagnostic("warning", "DUPLICATE_INDEX", "该层包含重复方向；已去重。", plane.line));
      } else {
        group.entries.push({ index, ...plane.entry });
      }
    }
    if (groups.length > 1) {
      diagnostics.push(diagnostic("info", "GCS_TIER_SPLIT", `第 ${tierIndex + 1} 层（${source.attrs.name || "未命名"}）的刻面深度或角度不同，已拆成 ${groups.length} 层。`, source.line));
    }
    for (const group of groups) {
      tiers.push({
        angle: group.angle,
        distance: group.distance,
        region: group.region,
        table: false,
        name: source.attrs.name ?? "",
        instructions: source.attrs.instructions ?? "",
        entries: group.entries,
        hidden: source.hidden,
        line: source.line,
        sourceAngle: source.attrs.angle,
        ...(source.guide ? { gcs: { guide: "true" } } : {}),
      });
    }
  }

  if (labelMismatch) {
    diagnostics.push(diagnostic("warning", "GCS_INDEX_LABEL_MISMATCH", `${labelMismatch} 个刻面的分度标注与面朝向不一致；已按面朝向计算分度。请在 Gem Cut Studio 中核对该文件。`));
  }
  if (depthFromVertices) {
    diagnostics.push(diagnostic("info", "GCS_DEPTH_FROM_VERTICES", `${depthFromVertices} 个刻面没有层深度，已由顶点推算。`));
  }
  if (staleVertices) {
    diagnostics.push(diagnostic("info", "GCS_VERTICES_RECOMPUTED", `${staleVertices} 个刻面的缓存顶点与切割平面不一致；已按切割平面重新计算形状。`));
  }
  const hiddenCount = tiers.filter((tier) => tier.hidden).length;
  if (hiddenCount) {
    diagnostics.push(diagnostic("warning", "GCS_HIDDEN_TIERS", `${hiddenCount} 个层在 Gem Cut Studio 中处于隐藏（不切）状态；按原软件的显示不切入形状，打开或另存为 GCS 时仍会保留。`));
  }
  if (!tiers.some((tier) => !tier.hidden)) fail("GCS_ALL_HIDDEN", "所有刻面层都处于隐藏状态，没有可读取的形状。");

  const renderNodes = root.children.filter((node) => node.name === "render");
  if (renderNodes.length > 1) fail("GCS_RENDER", "文件包含重复的渲染设置。");
  const render = renderNodes[0];
  let refractiveIndex = 1.54;
  if (render?.attrs.refractive_index !== undefined) {
    refractiveIndex = readNumber(render.attrs.refractive_index, "折射率", { min: 1.000001, max: 10, line: render.line });
  } else {
    diagnostics.push(diagnostic("warning", "DEFAULT_REFRACTIVE_INDEX", "文件未声明折射率，将使用 1.54。"));
  }
  const colors = render?.children.filter((node) => node.name === "color") ?? [];
  if (colors.length > 1) fail("GCS_DUPLICATE_COLOR", "文件包含重复的颜色设置。");
  const infoNodes = root.children.filter((node) => node.name === "info");
  if (infoNodes.length > 1) fail("GCS_INFO", "文件包含重复的说明信息。");
  const info = { ...(infoNodes[0]?.attrs ?? {}) };
  const title = String(info.title ?? "").trim();

  const design = {
    name: title || fileName.replace(/\.gcs$/i, "") || "Imported Gem Cut Studio Design",
    gear,
    symmetry: null,
    mirror: false,
    refractiveIndex,
    headings: [info.title, info.header2].filter((line) => line !== undefined && line !== ""),
    footnotes: [info.footer1, info.footer2].filter((line) => line !== undefined && line !== ""),
    tiers: markTable(tiers),
    extras: {
      gcs: {
        version: String(version),
        index: { base: indexAttrs.base ?? "0", symmetry: indexAttrs.symmetry ?? "1", mirror: indexAttrs.mirror ?? "0" },
        ...(render ? { render: { ...render.attrs }, ...(colors[0] ? { color: { ...colors[0].attrs } } : {}) } : {}),
        info,
      },
    },
  };
  return { status: statusFor(diagnostics), design, diagnostics, summary: designSummary(design) };
}

// GCS stores planes from the bounding-box centre. Every distance must stay
// positive from a point on the rotation axis, so an origin outside a strongly
// asymmetric stone moves along the axis only; indices never change.
function axisShift(planes) {
  const visible = planes.filter((plane) => plane.offset !== undefined);
  if (visible.every((plane) => plane.offset > EPSILON)) return 0;
  const reach = Math.max(1, ...visible.map((plane) => Math.abs(plane.offset)));
  const solid = clipPolyhedronByPlanes(createCenteredCube(reach * 8), visible.map((plane) => ({ normal: plane.normal, offset: plane.offset })));
  const dimensions = solidDimensions(solid);
  if (!dimensions) fail("GCS_EMPTY_SHAPE", "这些刻面不构成实体。");
  const shift = dimensions.center.z;
  if (visible.some((plane) => plane.offset - plane.normal.z * shift <= EPSILON)) {
    fail("GCS_AXIS_OUTSIDE", "宝石的旋转轴不经过实体内部，无法用机器分度表达这个设计。");
  }
  return shift;
}

function gcsPolar(tier) {
  if (tier.region === "girdle") return 90;
  if (tier.region === "crown") return Math.abs(tier.angle);
  return 180 - Math.abs(tier.angle);
}

/** Write a PlaneDesign as Gem Cut Studio XML, keeping the rotation axis at the
 * origin, centred vertically and scaled to a half height/width of 1 like real
 * saves. Every loss is reported. */
export function writeGcsDesign(design, { diagnostics = [] } = {}) {
  const { solid, open, dimensions } = planeDesignSolid(design);
  if (open) {
    diagnostics.push(diagnostic("error", "GCS_OPEN_DESIGN", "这个设计的切面还没有把宝石完全包住（缺少台面、底尖或一侧刻面）；Gem Cut Studio 会把未切到的部分当作原始方块，不能可靠转换。请先补齐切面，或改存 ASC。"));
    return { status: "error", text: "", diagnostics };
  }
  if (!dimensions) {
    diagnostics.push(diagnostic("error", "EMPTY_GEOMETRY", "这些切面不构成实体，无法写出 GCS。"));
    return { status: "error", text: "", diagnostics };
  }
  const reach = Math.max(...solid.vertices.map((point) => Math.max(Math.abs(point.x), Math.abs(point.y))));
  const shift = dimensions.center.z;
  const scale = 1 / Math.max(reach, dimensions.z / 2);
  const faces = new Map(solid.faces.map((face) => [face.id, face]));
  const visible = visibleTiers(design);
  const children = [{
    name: "index",
    attrs: {
      gear: String(design.gear),
      base: design.extras?.gcs?.index?.base ?? "0",
      symmetry: design.extras?.gcs?.index?.symmetry ?? String(design.symmetry || 1),
      mirror: design.extras?.gcs?.index?.mirror ?? "0",
    },
    children: [],
  }];

  let frosted = 0;
  let facetNames = 0;
  for (const tier of design.tiers) {
    const tierIndex = visible.indexOf(tier);
    const polar = gcsPolar(tier);
    const facets = tier.entries.map((entry, entryIndex) => {
      const normal = tierNormal(tier, entry.index, design.gear);
      const gcsNormal = toGcs(normal);
      const horizontal = Math.hypot(normal.x, normal.y) < 1e-10;
      const azimuth = mod360(Math.atan2(normal.y, normal.x) * DEG);
      const attrs = {
        nx: formatNumber(gcsNormal.x),
        ny: formatNumber(gcsNormal.y),
        nz: formatNumber(gcsNormal.z),
        index_angle: horizontal ? "0" : formatNumber(Number(expectedLabel(tier.region, azimuth).toFixed(10)) % 360),
      };
      if (entry.finish?.state === "frosted") {
        frosted += 1;
        attrs.frosting = Number(entry.gcs?.frosting) > 0 ? entry.gcs.frosting : "0.5";
      } else if (entry.gcs?.frosting !== undefined && !(Number(entry.gcs.frosting) > 0)) {
        attrs.frosting = entry.gcs.frosting;
      }
      const face = tierIndex >= 0 ? faces.get(`${tierIndex}:${entryIndex}`) : null;
      const vertices = face ? face.vertexIndices.map((vertexIndex) => solid.vertices[vertexIndex]) : [];
      return {
        name: "facet",
        attrs,
        children: vertices.map((point) => {
          const gcsPoint = toGcs({ x: point.x * scale, y: point.y * scale, z: (point.z - shift) * scale });
          return { name: "vertex", attrs: { x: formatNumber(gcsPoint.x), y: formatNumber(gcsPoint.y), z: formatNumber(gcsPoint.z) }, children: [] };
        }),
      };
    });
    facetNames += individualFacetNames(tier).length;
    const normal = tierNormal(tier, tier.entries[0].index, design.gear);
    const depth = (Math.abs(tier.distance) - normal.z * shift) * scale;
    children.push({
      name: "tier",
      attrs: {
        angle: formatNumber(polar),
        depth: formatNumber(depth),
        name: tier.name || (tier.table ? "T" : `${{ crown: "C", girdle: "G", pavilion: "P" }[tier.region]}${children.length}`),
        instructions: tier.instructions ?? "",
        visible: tier.hidden ? "false" : "true",
        guide: tier.gcs?.guide ?? "false",
      },
      children: facets,
    });
  }

  const gcs = design.extras?.gcs ?? {};
  const renderAttrs = { ...(gcs.render ?? {}), refractive_index: formatNumber(design.refractiveIndex) };
  children.push({ name: "render", attrs: renderAttrs, children: gcs.color ? [{ name: "color", attrs: { ...gcs.color }, children: [] }] : [] });
  const info = { ...(gcs.info ?? {}) };
  const headings = textLines(design.headings);
  const footnotes = textLines(design.footnotes);
  info.title = headings[0] ?? design.name;
  if (headings[1] !== undefined) info.header2 = headings[1]; else delete info.header2;
  ["footer1", "footer2"].forEach((key, index) => {
    if (footnotes[index] !== undefined) info[key] = footnotes[index]; else delete info[key];
  });
  children.push({ name: "info", attrs: info, children: [] });

  if (headings.length > 2 || footnotes.length > 2) {
    diagnostics.push(diagnostic("warning", "GCS_TEXT_LIMIT", "Gem Cut Studio 只有两行标题（title、header2）和两行脚注；其余行不会写入。"));
  }
  if (frosted) {
    diagnostics.push(diagnostic("warning", "GCS_FROST_ON_OFF", `${frosted} 个磨砂面写为 Gem Cut Studio 磨砂；它只有“磨砂／抛光”两种状态，本软件中的磨砂粗细（α）不会写入。`));
  }
  if (facetNames) {
    diagnostics.push(diagnostic("warning", "FACET_NAMES_OMITTED", `${facetNames} 个单独命名的刻面名称不会写入；Gem Cut Studio 只保存层名。`));
  }
  const text = `<?xml version="1.0" encoding="UTF-8"?>\n${writeXml({ name: "GemCutStudio", attrs: { version: "1000" }, children })}\n`;
  return { status: statusFor(diagnostics), text, diagnostics };
}
