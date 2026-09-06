import { mkdir, readFile, rm, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportFacetingJSON, importFacetingJSON } from "../src/domain/faceting.js";
import { inspectGemCadAsc } from "../src/domain/gemcadAsc.js";
import { CURATION_EXCLUSIONS, CURATION_EXCLUSION_HASHES } from "../src/domain/presetLibrary.js";
import { inspectPresetSolid } from "../src/domain/presetQuality.js";
import { TECHNICAL_PREVIEW_VIEWS, technicalPreviewSvg } from "../src/domain/technicalPreview.js";
import { readPresetArchive, sha256, validatePresetProvenance } from "./lib/presetArchive.mjs";

const REJECTED_WARNINGS = new Set(["ROUGH_STOCK_REMAINS", "UNKNOWN_RECORD", "UNKNOWN_TIER_TOKEN"]);
const EMAIL_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
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
  baguette: "Baguette 长阶梯形", barrel: "Barrel 桶形", "calfs-head": "Calfs Head 牛头形",
  "cushion-triangle": "Cushion Triangle 三角垫形", "cut-corner-triangle": "Cut Corner Triangle 切角三角形",
  epaulette: "Epaulette 肩章形", keystone: "Keystone 拱心石形", kite: "Kite 风筝形",
  "old-mine": "Old Mine 老矿式", "semi-navette": "Semi Navette 半马眼",
  "tapered-pentagon": "Tapered Pentagon 收尖五边形", trapeze: "Trapeze 梯形",
  whistle: "Whistle 哨形", unknown: "Unknown 未分类", other: "Other 其他",
};

function optionsFrom(argv) {
  const options = { archive: "", limit: Infinity, min: 50, allowPartial: false, report: "tmp/preset-library-audit.json" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--archive") options.archive = argv[++index] ?? "";
    else if (arg === "--limit") options.limit = Number(argv[++index]);
    else if (arg === "--min") options.min = Number(argv[++index]);
    else if (arg === "--report") options.report = argv[++index];
    else if (arg === "--allow-partial") options.allowPartial = true;
    else throw new Error(`未知选项：${arg}`);
  }
  if (!options.archive) throw new Error("用法：npm run presets:build -- --archive <解压后的归档目录> [--report tmp/preset-library-audit.json]");
  if (options.limit !== Infinity && (!Number.isInteger(options.limit) || options.limit < 1)) throw new Error("--limit 必须是正整数；省略时收录全部合格项。");
  if (!Number.isInteger(options.min) || options.min < 1) throw new Error("--min 必须是正整数。");
  return options;
}
const shapeKey = (value = "") => value.replace(/^shape-diagram-\d+-/, "") || "unknown";
const slug = (value) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 54) || "preset";
const counts = (items, key) => Object.fromEntries([...new Set(items.map(key))].sort().map((value) => [value, items.filter((item) => key(item) === value).length]));

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

async function main() {
  const options = optionsFrom(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const outputRoot = path.join(repoRoot, "public/presets");
  const rows = await readPresetArchive(path.resolve(options.archive));
  const audit = [];
  const candidates = [];
  const seenBytes = new Map();
  const excludedHashes = new Set([...CURATION_EXCLUSION_HASHES, ...rows.filter((row) => CURATION_EXCLUSIONS.has(String(row.post_id))).map((row) => row.sha256)]);
  // Sequential reads bound peak memory; every manifest row receives a disposition.
  for (const row of rows) {
    const record = { postId: row.post_id, name: row.title, file: row.local_relpath || row.original_filename,
      sourcePageUrl: row.page_url, sourceSha256: row.sha256, extension: row.extension, shape: shapeKey(row.shape_class), status: "rejected", reasons: [] };
    audit.push(record);
    if (!row.eligible) { record.reasons = ["NOT_DOWNLOADED"]; continue; }
    let bytes;
    try { bytes = await readFile(row.file); }
    catch { record.reasons = ["MISSING_FILE"]; continue; }
    if (sha256(bytes) !== row.sha256) { record.reasons = ["HASH_MISMATCH"]; continue; }
    if (row.extension === "asc") {
      record.reasons = validatePresetProvenance(row, bytes);
      if (excludedHashes.has(row.sha256)) record.reasons.push("CURATION_EXCLUSION");
      if (record.reasons.length) continue;
    }
    if (seenBytes.has(row.sha256)) {
      record.status = "duplicate-file"; record.duplicateOf = seenBytes.get(row.sha256); continue;
    }
    seenBytes.set(row.sha256, record.file);
    if (row.extension !== "asc") { record.status = "unsupported-format"; record.reasons = [row.extension.toUpperCase()]; continue; }
    const inspection = inspectGemCadAsc(bytes.toString("utf8"), { fileName: row.original_filename });
    record.diagnostics = inspection.diagnostics;
    record.reasons = [...new Set(inspection.diagnostics.filter((d) => d.severity === "error" || REJECTED_WARNINGS.has(d.code)).map((d) => d.code))];
    if (!inspection.document || record.reasons.length) continue;
    const quality = inspectPresetSolid(inspection.document);
    record.geometryChecks = { issues: quality.issues, volume: quality.metrics?.volume,
      dimensions: quality.metrics?.dimensions, eulerCharacteristic: quality.metrics?.eulerCharacteristic,
      topologyTolerance: quality.metrics?.topologyTolerance, faceCount: quality.facetCount };
    record.reasons = quality.issues.map((issue) => issue.code);
    const { lengthToWidth: ratio, heightToWidth: height } = inspection.summary.dimensions;
    if (!Number.isFinite(ratio) || !Number.isFinite(height) || ratio < 0.95 || ratio > 4 || height < 0.12 || height > 1.6) record.reasons.push("ABNORMAL_PROPORTIONS");
    if (record.reasons.length) continue;
    const normalized = exportFacetingJSON(inspection.document);
    const roundTrip = inspectPresetSolid(importFacetingJSON(normalized));
    if (roundTrip.issues.length || roundTrip.fingerprint !== quality.fingerprint) { record.reasons = ["ROUNDTRIP_GEOMETRY_CHANGED"]; continue; }
    record.geometryHash = sha256(quality.fingerprint);
    record.status = "candidate";
    candidates.push({ row, record, inspection, quality, geometryHash: record.geometryHash });
    if (audit.length % 200 === 0) console.log(`Inspected ${audit.length}/${rows.length} attachments…`);
  }
  // Stable priority: native 96 gear, fewer warnings, then source id/name/hash.
  candidates.sort((a, b) => (Math.abs(b.inspection.summary.sourceGear) === 96) - (Math.abs(a.inspection.summary.sourceGear) === 96)
    || a.inspection.diagnostics.length - b.inspection.diagnostics.length
    || Number(a.row.post_id) - Number(b.row.post_id) || a.row.sha256.localeCompare(b.row.sha256));
  const byGeometry = new Map();
  for (const item of candidates) {
    const prior = byGeometry.get(item.geometryHash);
    if (prior) { item.record.status = "duplicate-geometry"; item.record.duplicateOf = prior.row.sha256; }
    else byGeometry.set(item.geometryHash, item);
  }
  const unique = [...byGeometry.values()].sort((a, b) => shapeKey(a.row.shape_class).localeCompare(shapeKey(b.row.shape_class)) || a.row.title.localeCompare(b.row.title) || a.row.sha256.localeCompare(b.row.sha256));
  const selected = unique.slice(0, options.limit);
  unique.slice(options.limit).forEach((item) => { item.record.status = "limited"; });
  selected.forEach((item) => { item.record.status = "accepted"; });
  const report = { schemaVersion: 1, policy: "all compatible unique ASC; normalized oriented final-plane fingerprint at 1e-8; no rotation equivalence", attachments: rows.length,
    accepted: selected.length, dispositions: counts(audit, (row) => row.status),
    exclusionReasons: counts(audit.flatMap((row) => row.reasons.map((code) => ({ code }))), (row) => row.code),
    shapes: counts(selected, (item) => shapeKey(item.row.shape_class)), records: audit };
  await mkdir(path.dirname(path.resolve(options.report)), { recursive: true });
  await writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`);
  if (!options.allowPartial && selected.length < options.min) throw new Error(`只有 ${selected.length} 个候选通过门槛；要求至少 ${options.min} 个。详见 ${options.report}`);
  const staging = `${outputRoot}.staging`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(path.join(staging, "documents"), { recursive: true });
  await mkdir(path.join(staging, "previews"), { recursive: true });
  const catalog = [];
  const usedIds = new Set();
  for (const item of selected) {
    let id = `${item.row.post_id}-${slug(item.inspection.document.name || item.row.title)}`;
    if (usedIds.has(id)) id += `-${item.row.sha256.slice(0, 8)}`;
    usedIds.add(id);
    const key = shapeKey(item.row.shape_class);
    const sourceHashes = new Set([item.row.sha256, ...audit.filter((entry) => entry.status === "duplicate-geometry" && entry.duplicateOf === item.row.sha256).map((entry) => entry.sourceSha256)]);
    const aliases = rows.filter((row) => sourceHashes.has(row.sha256)).flatMap((row) => [
      { name: row.title, sourcePageUrl: row.page_url, sourceSha256: row.sha256 },
      ...(row.associations ?? []).map((entry) => ({ name: entry.title, sourcePageUrl: entry.url, sourceSha256: row.sha256 })),
    ]).filter((entry) => entry.sourcePageUrl !== item.row.page_url || entry.sourceSha256 !== item.row.sha256);
    const duplicateSources = [...new Map(aliases.map((entry) => [`${entry.sourcePageUrl}:${entry.sourceSha256}`, entry])).values()];
    const sourceDocument = publicDocument(item.inspection.document);
    const document = { ...sourceDocument,
      name: item.inspection.document.name === path.parse(item.row.original_filename).name ? item.row.title : item.inspection.document.name,
      metadata: { ...sourceDocument.metadata,
      preset: { id, provider: "builtin", sourcePageUrl: item.row.page_url, sourceDownloadUrl: item.row.source_url,
        openDeclaration: item.row.open_declaration, designer: item.row.designer, sourceSha256: item.row.sha256, duplicateSources } } };
    await writeFile(path.join(staging, "documents", `${id}.json`), exportFacetingJSON(document));
    const previews = {};
    for (const view of TECHNICAL_PREVIEW_VIEWS) {
      const file = `previews/${id}-${view}.svg`; previews[view] = file;
      await writeFile(path.join(staging, file), technicalPreviewSvg(item.quality.solid, view));
    }
    catalog.push({ id, name: document.name, designer: item.row.designer, shape: SHAPE_NAMES[key] ?? key.replaceAll("-", " "), shapeKey: key,
      facetCount: item.quality.facetCount, tierCount: item.quality.tierCount,
      sourceGear: item.inspection.summary.sourceGear, refractiveIndex: item.inspection.summary.refractiveIndex,
      lengthToWidth: item.inspection.summary.dimensions.lengthToWidth, heightToWidth: item.inspection.summary.dimensions.heightToWidth,
      openDeclaration: item.row.open_declaration, sourceReference: item.row.source_reference, sourcePageUrl: item.row.page_url,
      sourceDownloadUrl: item.row.source_url, sourceSha256: item.row.sha256, geometryHash: item.geometryHash, duplicateSources,
      document: `documents/${id}.json`, previews });
  }
  await writeFile(path.join(staging, "catalog.json"), `${JSON.stringify({ schemaVersion: 1, count: catalog.length, presets: catalog }, null, 2)}\n`);
  await rm(outputRoot, { recursive: true, force: true });
  await rename(staging, outputRoot);
  console.log(JSON.stringify({ selected: catalog.length, dispositions: report.dispositions, reasons: report.exclusionReasons, shapes: report.shapes }, null, 2));
}
await main();
