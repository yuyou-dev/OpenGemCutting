import { FORMAT_LIMITS, diagnostic, fail, statusFor } from "./shared.js";
import { cleanIndex, designSummary, markTable } from "./planeDesign.js";

/*
 * GemCad's binary .gem save, read-only. The layout has no published
 * specification; it follows the MIT-licensed reader by Mike Parker
 * (github.com/mbparker/gemcad-file-reader) and was checked against .gem/.asc
 * pairs saved by GemCad. All values are little-endian:
 *
 * facet   f64×3 plane vector p (p·x = 1 in GemCad's frame), i32 tier number,
 *         u8 length + "name\tinstructions", i32, then polygon vertices
 *         (f64×3 + i32 "more") until "more" is 0;
 * trailer i32 0, 4 bytes, i32 symmetry, i32 mirror 0/1, i32 signed gear,
 *         f64 refractive index, 4 bytes, f64 gear location, then u8-length
 *         text lines: headings, a blank line, footnotes; "preform" starts a
 *         preform section.
 *
 * GemCad's frame maps to this project's by swapping X and Y, the same
 * reflection that keeps ASC index numbers unchanged.
 */

const DEG = 180 / Math.PI;
const mod360 = (value) => ((value % 360) + 360) % 360;

function reader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const need = (count) => {
    if (offset + count > bytes.byteLength) fail("GEM_TRUNCATED", "GEM 文件不完整或已损坏。");
  };
  return {
    get offset() { return offset; },
    set offset(value) { offset = value; },
    remaining: () => bytes.byteLength - offset,
    i32() { need(4); const value = view.getInt32(offset, true); offset += 4; return value; },
    u8() { need(1); const value = view.getUint8(offset); offset += 1; return value; },
    f64() {
      need(8);
      const value = view.getFloat64(offset, true);
      offset += 8;
      if (!Number.isFinite(value) || Math.abs(value) > FORMAT_LIMITS.coordinate) fail("GEM_INVALID_NUMBER", "GEM 文件含无效数字。");
      return value;
    },
    text() {
      const length = this.u8();
      need(length);
      const value = new TextDecoder("windows-1252").decode(bytes.subarray(offset, offset + length));
      offset += length;
      return value;
    },
    peekTrailer() {
      if (bytes.byteLength - offset < 40) return false;
      const zero = view.getInt32(offset, true);
      const marker = view.getUint32(offset + 4, true);
      const folds = view.getInt32(offset + 8, true);
      const mirror = view.getInt32(offset + 12, true);
      const gear = view.getInt32(offset + 16, true);
      const ri = view.getFloat64(offset + 20, true);
      return zero === 0 && marker !== 0 && folds >= 1 && folds <= 360 && (mirror === 0 || mirror === 1)
        && gear !== 0 && Math.abs(gear) <= 360 && ri > 1 && ri < 10;
    },
  };
}

function parseGem(bytes) {
  if (bytes.byteLength > FORMAT_LIMITS.bytes) fail("FILE_TOO_LARGE", "文件超过 20 MB。");
  const input = reader(bytes);
  const records = [];
  let vertexTotal = 0;
  while (!input.peekTrailer()) {
    if (input.remaining() < 29) fail("GEM_NO_TRAILER", "没有找到 GEM 文件的设计设置，文件可能不是 GemCad 存档或已损坏。");
    if (records.length >= FORMAT_LIMITS.facets) fail("GEM_FACET_BUDGET", "刻面数量超出限制。");
    const plane = { x: input.f64(), y: input.f64(), z: input.f64() };
    const tier = input.i32();
    if (tier < 1 || tier > FORMAT_LIMITS.tiers) fail("GEM_INVALID_TIER", "GEM 文件的层编号无效。");
    const length = Math.hypot(plane.x, plane.y, plane.z);
    if (length < 1e-12) fail("GEM_ZERO_PLANE", "GEM 文件含无效切面。");
    const [name = "", ...instructions] = input.text().split("\t");
    input.i32();
    let more = 1;
    let vertices = 0;
    while (more !== 0) {
      input.f64(); input.f64(); input.f64();
      more = input.i32();
      vertices += 1;
      vertexTotal += 1;
      if (vertices > FORMAT_LIMITS.polygonVertices || vertexTotal > FORMAT_LIMITS.totalVertices) fail("GEM_VERTEX_BUDGET", "顶点数量超出限制。");
    }
    records.push({ plane, tier, name: name.trim(), instructions: instructions.join(" ").trim() });
  }
  if (!records.length) fail("GEM_NO_FACETS", "GEM 文件没有任何刻面。");

  input.i32();
  input.i32();
  const symmetry = input.i32();
  const mirror = input.i32() === 1;
  const gear = input.i32();
  const refractiveIndex = input.f64();
  input.i32();
  const location = input.f64();
  const headings = [];
  const footnotes = [];
  let lines = headings;
  while (input.remaining() > 0) {
    const line = input.text();
    if (/^preform$/i.test(line.trim())) fail("UNSUPPORTED_PREFORM", "GemCad 预形无法由当前模型无损表示。请先在 GemCad 中把预形复制为真实刻面。");
    if (!line.trim()) {
      if (lines === footnotes) break;
      lines = footnotes;
      continue;
    }
    lines.push(line);
  }
  return { records, symmetry, mirror, gear, refractiveIndex, location, headings, footnotes };
}

/** Read a GemCad .gem file into a PlaneDesign. */
export function readGemDesign(input, { fileName = "Imported GemCad Design.gem" } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const parsed = parseGem(bytes);
  const diagnostics = [];
  const gear = Math.abs(parsed.gear);
  const tiers = [];
  let current = null;
  for (const record of parsed.records) {
    const length = Math.hypot(record.plane.x, record.plane.y, record.plane.z);
    const normal = { x: record.plane.y / length, y: record.plane.x / length, z: record.plane.z / length };
    const distance = 1 / length;
    const horizontal = Math.hypot(normal.x, normal.y) < 1e-10;
    const polar = Math.acos(Math.max(-1, Math.min(1, normal.z))) * DEG;
    const region = Math.abs(polar - 90) < 1e-7 ? "girdle" : polar > 90 ? "pavilion" : "crown";
    const industry = region === "girdle" ? 90 : region === "crown" ? polar : 180 - polar;
    const culet = region === "pavilion" && industry < 1e-9;
    const angle = region === "girdle" ? -90 : region === "pavilion" ? (culet ? 0 : -industry) : industry;
    const signedDistance = culet ? -distance : distance;
    const azimuth = horizontal ? 0 : mod360(Math.atan2(normal.y, normal.x) * DEG);
    const index = horizontal ? 0 : cleanIndex(azimuth * gear / 360, gear);
    const token = horizontal ? String(gear) : String(cleanIndex(((parsed.location + Math.sign(parsed.gear) * index) % gear + gear) % gear, gear));
    const same = current && current.tierNumber === record.tier && current.region === region
      && Math.abs(current.angle - angle) < 1e-7 && Math.abs(current.distance - signedDistance) < 1e-9 * Math.max(1, distance);
    if (!same) {
      current = {
        tierNumber: record.tier,
        angle: Number(angle.toFixed(10)),
        distance: signedDistance,
        region,
        table: false,
        name: "",
        instructions: "",
        entries: [],
        hidden: false,
      };
      tiers.push(current);
    }
    if (!current.name && record.name) current.name = record.name;
    if (!current.instructions && record.instructions) current.instructions = record.instructions;
    if (current.entries.some((entry) => Math.abs(entry.index - index) < 1e-9)) {
      diagnostics.push(diagnostic("warning", "DUPLICATE_INDEX", "该层包含重复方向；已去重。"));
      continue;
    }
    current.entries.push({ index, token, name: record.name, finish: null });
  }
  if (Math.abs(parsed.location) > 1e-9 || parsed.gear < 0) {
    diagnostics.push(diagnostic("info", "GEAR_OFFSET_APPLIED", `按源 ${parsed.gear} 齿盘应用方位偏移 ${parsed.location}，保留精确方向与小数分度；文档使用 ${gear} 齿正向标记。`));
  }
  const design = {
    name: parsed.headings.find((line) => line.trim())?.trim() || fileName.replace(/\.gem$/i, "") || "Imported GemCad Design",
    gear,
    symmetry: parsed.symmetry,
    mirror: parsed.mirror,
    refractiveIndex: parsed.refractiveIndex,
    headings: parsed.headings,
    footnotes: parsed.footnotes,
    tiers: markTable(tiers.map(({ tierNumber: _tier, ...tier }) => tier)),
    extras: { asc: { sourceFormat: "gem", sourceGear: parsed.gear, sourceGearOffset: parsed.location } },
  };
  return { status: statusFor(diagnostics), design, diagnostics, summary: designSummary(design) };
}
