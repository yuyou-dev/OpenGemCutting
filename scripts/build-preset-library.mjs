import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportFacetingJSON } from "../src/domain/faceting.js";
import { inspectGemCadAsc } from "../src/domain/gemcadAsc.js";
import { clipPolyhedronByPlanes, createCenteredCube, measurePolyhedron } from "../src/domain/geometry.js";
import { CURATION_EXCLUSIONS } from "../src/domain/presetLibrary.js";
import { TECHNICAL_PREVIEW_VIEWS, technicalPreviewSvg } from "../src/domain/technicalPreview.js";

const REJECTED_WARNINGS = new Set(["ROUGH_STOCK_REMAINS", "REDUNDANT_TIER", "UNKNOWN_RECORD", "DUPLICATE_INDEX"]);
const EMAIL_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const SHAPE_PRIORITY = [
  "round", "oval", "emerald", "pear", "antique-cushion", "square-antique-cushion", "heart",
  "square", "square-emerald", "triangle", "octagon", "hexagon", "shield", "navette-marquise",
  "rectangle", "long-octagon", "long-hexagon", "star", "pentagon", "dodecagon-12",
];
const SHAPE_NAMES = {
  round: "Round 圆形", oval: "Oval 椭圆", "navette-marquise": "Navette Marquise 马眼",
  emerald: "Emerald 祖母绿", pear: "Pear 水滴", rectangle: "Rectangle 长方形",
  "square-emerald": "Square Emerald 方形祖母绿", "antique-cushion": "Antique Cushion 古垫形",
  "square-antique-cushion": "Square Cushion 方垫形", heart: "Heart 心形", square: "Square 方形", lozenge: "Lozenge 菱形",
  triangle: "Triangle 三角形", octagon: "Octagon 八边形", hexagon: "Hexagon 六边形",
  shield: "Shield 盾形", star: "Star 星形", pentagon: "Pentagon 五边形",
  "long-hexagon": "Long Hexagon 长六边形", "long-octagon": "Long Octagon 长八边形",
  "dodecagon-12": "Dodecagon 十二边形", coffin: "Coffin 棺形", rhomboid: "Rhomboid 菱形",
  "navette-oval": "Navette Oval 马眼椭圆", fan: "Fan 扇形", "freeform-small": "Freeform 小型异形",
  "freeform-large": "Freeform 大型异形", "heptagon-7": "Heptagon 七边形", "nonagon-9": "Nonagon 九边形",
  "undecagon-11": "Undecagon 十一边形", "decagon-10": "Decagon 十边形",
};

function optionsFrom(argv) {
  const options = { archive: "", limit: 72, min: 50, allowPartial: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--archive") options.archive = argv[++index] ?? "";
    else if (argv[index] === "--limit") options.limit = Number(argv[++index]);
    else if (argv[index] === "--min") options.min = Number(argv[++index]);
    else if (argv[index] === "--allow-partial") options.allowPartial = true;
  }
  if (!options.archive) {
    throw new Error(
      "用法：npm run presets:build -- --archive <facetdiagrams archive> [--limit 72]\n"
        + "facetdiagrams 开放归档只存在于本机被 git 忽略的 tmp/facetdiagrams-open-archive/，"
        + "换机或清理后需重新从 facetdiagrams.org 获取归档再运行。",
    );
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) throw new Error("--limit 必须是 1–100 的整数。");
  return options;
}

function shapeKey(value = "") {
  return value.replace(/^shape-diagram-\d+-/, "") || "other";
}

function slug(value) {
  return value.toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 54) || "preset";
}

function publicDocument(source) {
  const asc = source.metadata?.asc;
  if (!asc) return source;
  const sanitizeNotes = (lines = []) => lines.filter((line) => (
    !EMAIL_ADDRESS.test(line) && !/contact me at email/i.test(line)
  ));
  return {
    ...source,
    metadata: {
      ...source.metadata,
      asc: {
        ...asc,
        headings: sanitizeNotes(asc.headings),
        footnotes: sanitizeNotes(asc.footnotes),
        comments: sanitizeNotes(asc.comments),
      },
    },
  };
}

function fingerprint(document) {
  const planes = document.facets.map((facet) => [
    facet.plane.normal.x, facet.plane.normal.y, facet.plane.normal.z, facet.plane.offset,
  ].map((value) => Number(value).toFixed(8)).join(":"));
  return createHash("sha256").update(planes.sort().join("|")).digest("hex");
}

function score(item) {
  const summary = item.inspection.summary;
  const warnings = item.inspection.diagnostics.filter((entry) => entry.severity === "warning").length;
  return (Math.abs(summary.sourceGear) === 96 ? 24 : 0)
    + (item.inspection.parsed.formatVersion === "5.0" ? 8 : 0)
    + (item.row.designer ? 4 : 0)
    + (item.row.source_reference ? 3 : 0)
    + (summary.facetCount >= 24 && summary.facetCount <= 128 ? 8 : 0)
    + (summary.tierCount >= 3 && summary.tierCount <= 24 ? 6 : 0)
    - warnings * 2;
}

function pickBalanced(candidates, limit) {
  const groups = new Map();
  candidates.forEach((candidate) => {
    const key = shapeKey(candidate.row.shape_class);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(candidate);
  });
  groups.forEach((items) => items.sort((left, right) => right.score - left.score || left.row.title.localeCompare(right.row.title)));
  const orderedGroups = [...groups.entries()].sort(([left], [right]) => {
    const leftRank = SHAPE_PRIORITY.indexOf(left); const rightRank = SHAPE_PRIORITY.indexOf(right);
    return (leftRank < 0 ? SHAPE_PRIORITY.length : leftRank) - (rightRank < 0 ? SHAPE_PRIORITY.length : rightRank)
      || left.localeCompare(right);
  }).map(([, items]) => items);
  const selected = [];
  const perShapeLimit = Math.max(6, Math.ceil(limit / 6));
  let round = 0;
  while (selected.length < limit) {
    let added = false;
    for (const items of orderedGroups) {
      const candidate = items[round];
      if (round >= perShapeLimit || !candidate || CURATION_EXCLUSIONS.has(String(candidate.row.post_id))) continue;
      selected.push(candidate);
      added = true;
      if (selected.length === limit) break;
    }
    if (!added) break;
    round += 1;
  }
  return selected;
}

async function main() {
  const options = optionsFrom(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const outputRoot = path.join(repoRoot, "public", "presets");
  const manifest = JSON.parse(await readFile(path.join(options.archive, "download-manifest.json"), "utf8"));
  const records = manifest.filter((row) => row.status === "downloaded");
  const inspected = await Promise.all(records.map(async (row) => {
    const source = await readFile(row.target_file, "utf8");
    const inspection = inspectGemCadAsc(source, { fileName: row.original_filename });
    if (!inspection.document || inspection.diagnostics.some((entry) => REJECTED_WARNINGS.has(entry.code))) return null;
    const stock = createCenteredCube(inspection.document.stock.size, { center: inspection.document.stock.center });
    const solid = clipPolyhedronByPlanes(stock, inspection.document.facets.map((facet) => facet.plane));
    const metrics = measurePolyhedron(solid);
    const ratio = inspection.summary.dimensions?.lengthToWidth;
    const height = inspection.summary.dimensions?.heightToWidth;
    if (!solid.vertices.length || metrics.volume <= 0.01 || ratio < 0.95 || ratio > 4 || height < 0.12 || height > 1.6) return null;
    return { row, source, inspection, solid, metrics };
  }));

  const bestByGeometry = new Map();
  inspected.filter(Boolean).forEach((item) => {
    const key = fingerprint(item.inspection.document);
    item.score = score(item);
    const current = bestByGeometry.get(key);
    if (!current || item.score > current.score) bestByGeometry.set(key, item);
  });
  const candidates = [...bestByGeometry.values()];
  const selected = pickBalanced(candidates, options.limit);
  if (!options.allowPartial && selected.length < options.min) {
    throw new Error(`只有 ${selected.length} 个候选通过完整质量门槛；至少需要 ${options.min} 个，请继续补充资料。`);
  }

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(path.join(outputRoot, "documents"), { recursive: true });
  await mkdir(path.join(outputRoot, "previews"), { recursive: true });
  const catalog = [];
  for (const item of selected) {
    const id = `${item.row.post_id}-${slug(item.inspection.document.name || item.row.title)}`;
    const key = shapeKey(item.row.shape_class);
    const sourceDocument = publicDocument(item.inspection.document);
    const document = {
      ...sourceDocument,
      metadata: {
        ...sourceDocument.metadata,
        preset: {
          id,
          provider: "builtin",
          sourcePageUrl: item.row.page_url,
          sourceDownloadUrl: item.row.source_url,
          openDeclaration: item.row.open_declaration,
          designer: item.row.designer,
          sourceSha256: item.row.sha256,
        },
      },
    };
    await writeFile(path.join(outputRoot, "documents", `${id}.json`), exportFacetingJSON(document), "utf8");
    const previews = {};
    for (const view of TECHNICAL_PREVIEW_VIEWS) {
      const file = `previews/${id}-${view}.svg`;
      previews[view] = file;
      await writeFile(path.join(outputRoot, file), technicalPreviewSvg(item.solid, view), "utf8");
    }
    catalog.push({
      id,
      name: document.name,
      designer: item.row.designer || "",
      shape: SHAPE_NAMES[key] ?? key.replaceAll("-", " "),
      shapeKey: key,
      facetCount: item.inspection.summary.facetCount,
      tierCount: item.inspection.summary.tierCount,
      sourceGear: item.inspection.summary.sourceGear,
      refractiveIndex: item.inspection.summary.refractiveIndex,
      lengthToWidth: item.inspection.summary.dimensions.lengthToWidth,
      heightToWidth: item.inspection.summary.dimensions.heightToWidth,
      openDeclaration: item.row.open_declaration,
      sourceReference: item.row.source_reference || "",
      sourcePageUrl: item.row.page_url,
      sourceDownloadUrl: item.row.source_url,
      sourceSha256: item.row.sha256,
      document: `documents/${id}.json`,
      previews,
    });
  }
  await writeFile(path.join(outputRoot, "catalog.json"), `${JSON.stringify({ schemaVersion: 1, count: catalog.length, presets: catalog }, null, 2)}\n`, "utf8");
  console.log(`Preset library built: ${catalog.length} selected from ${candidates.length} parsed candidates.`);
}

await main();
