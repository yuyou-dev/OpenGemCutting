import { individualFacetNames, textLines } from "./planeDesign.js";

/*
 * What each format can hold, in designers' terms. The comparison table reads
 * `support`; a report for one design reads the writer's own diagnostics
 * (`codes`), so what the page promises is exactly what the file received.
 * support: keep | approx | lose | block | readonly
 */

export const FORMATS = Object.freeze([
  { id: "json", label: "本软件项目", extension: ".json", apps: "Facet 96 / OpenGemCutting", read: true, write: true,
    note: "唯一完整的文件：切割工序、Meet 构造、磨砂、光学设置都在里面。" },
  { id: "asc", label: "GemCAD 文本", extension: ".asc", apps: "GemCAD 5、Gem Cut Studio、在线切型图库", read: true, write: true,
    note: "业内最通用的切型文本，只记录切面、分度、说明与折射率。" },
  { id: "gem", label: "GemCAD 存档", extension: ".gem", apps: "GemCAD（Windows）", read: true, write: false,
    note: "GemCAD 自己的存档，只能读取；要交回 GemCAD 请存为 .asc。" },
  { id: "gcs", label: "Gem Cut Studio", extension: ".gcs", apps: "Gem Cut Studio 1.x", read: true, write: true,
    note: "记录切面、分度、磨砂开关、材质颜色与两行标题。" },
]);

export const CONCEPTS = Object.freeze([
  { id: "geometry", label: "切面形状", hint: "角度、分度与深度，决定宝石形状",
    support: { json: "keep", asc: "keep", gem: "keep", gcs: "keep" } },
  { id: "wheel", label: "小数分度与其他齿盘", hint: "96 齿以外的齿盘，或落在两齿之间的方向",
    support: { json: "keep", asc: "keep", gem: "keep", gcs: "keep" } },
  { id: "frost", label: "磨砂面", hint: "只研磨不抛光的面",
    support: { json: "keep", asc: "lose", gem: "lose", gcs: "approx" },
    notes: { asc: "写成普通抛光面", gem: "没有磨砂", gcs: "只有磨砂／抛光开关，磨砂粗细不保存" },
    codes: { lose: ["FROSTED_FINISH_OMITTED"], approx: ["GCS_FROST_ON_OFF"] } },
  { id: "names", label: "层名与切割说明", hint: "每一层的名字和施工备注",
    support: { json: "keep", asc: "approx", gem: "keep", gcs: "keep" },
    notes: { asc: "层名须为一个英文单词，其余会改成 C1、P2 这类代号" },
    codes: { approx: ["LAYER_NAME_NORMALIZED"] } },
  { id: "facetNames", label: "单个刻面名称", hint: "给个别刻面单独起的名字",
    support: { json: "keep", asc: "keep", gem: "keep", gcs: "lose" },
    notes: { gcs: "只保存层名" }, codes: { lose: ["FACET_NAMES_OMITTED"] } },
  { id: "titles", label: "标题与脚注", hint: "图纸上方的标题和下方的备注",
    support: { json: "keep", asc: "approx", gem: "keep", gcs: "approx" },
    notes: { asc: "各保留前 4 行", gcs: "各保留前 2 行" },
    codes: { approx: ["TEXT_LINES_TRUNCATED", "GCS_TEXT_LIMIT"] } },
  { id: "refractiveIndex", label: "折射率", hint: "材料折射率",
    support: { json: "keep", asc: "keep", gem: "keep", gcs: "keep" } },
  { id: "optics", label: "色散、体色与观察环境", hint: "光学仿真的材料与环境设置",
    support: { json: "keep", asc: "lose", gem: "lose", gcs: "lose" },
    notes: { asc: "只保存折射率", gcs: "只保存折射率" }, codes: { lose: ["OPTICS_METADATA_OMITTED"] } },
  { id: "gcsRender", label: "Gem Cut Studio 材质与颜色", hint: "来自 Gem Cut Studio 的渲染设置",
    support: { json: "keep", asc: "lose", gem: "lose", gcs: "keep" }, codes: { lose: ["GCS_RENDER_OMITTED"] } },
  { id: "hiddenTiers", label: "Gem Cut Studio 隐藏层", hint: "在 Gem Cut Studio 中暂时不切的层",
    support: { json: "keep", asc: "lose", gem: "lose", gcs: "keep" }, codes: { lose: ["HIDDEN_TIERS_OMITTED"] } },
  { id: "parametric", label: "重复与镜像关系", hint: "一组面按对称整体修改的关系",
    support: { json: "keep", asc: "approx", gem: "approx", gcs: "approx" },
    notes: { asc: "展开为逐个分度，形状不变", gcs: "展开为逐个分度，形状不变" },
    codes: { approx: ["PARAMETRIC_RELATIONSHIP_FLATTENED"] } },
  { id: "history", label: "被后续切割覆盖的工序", hint: "已不在宝石表面的早期切割",
    support: { json: "keep", asc: "lose", gem: "lose", gcs: "lose" },
    notes: { asc: "只写最终留在宝石上的面", gcs: "只写最终留在宝石上的面" }, codes: { lose: ["OVERWRITTEN_FACETS_OMITTED"] } },
  { id: "meet", label: "Meet / Jump 构造", hint: "按顶点或棱线对齐求出的深度来源",
    support: { json: "keep", asc: "lose", gem: "lose", gcs: "lose" },
    notes: { asc: "只保留求出的切面", gcs: "只保留求出的切面" }, codes: { lose: ["MEET_CONSTRUCTION_OMITTED"] } },
  { id: "preform", label: "预形工序标记", hint: "只为施工定位、最终不保留的工序",
    support: { json: "keep", asc: "lose", gem: "lose", gcs: "lose" }, codes: { lose: ["PREFORM_PURPOSE_OMITTED"] } },
  { id: "roughStock", label: "未切到的毛坯面", hint: "仍保留原始毛坯表面的部分",
    support: { json: "keep", asc: "lose", gem: "lose", gcs: "lose" },
    notes: { asc: "其他软件会显示为未切到", gcs: "其他软件会显示为未切到" }, codes: { lose: ["ROUGH_STOCK_REMAINS"] } },
  { id: "concave", label: "凹切", hint: "用轮刀切出的凹面",
    support: { json: "keep", asc: "block", gem: "lose", gcs: "block" },
    notes: { asc: "不能转换", gcs: "不能转换" },
    codes: { block: ["CONCAVE_CUTS_UNSUPPORTED"], lose: ["DISABLED_CONCAVE_CUTS_OMITTED"] } },
  { id: "meshStock", label: "导入的晶体毛坯", hint: "从三维扫描或模型导入的原石",
    support: { json: "keep", asc: "block", gem: "lose", gcs: "block" },
    notes: { asc: "不能转换", gcs: "不能转换" }, codes: { block: ["MESH_STOCK_UNSUPPORTED"] } },
  { id: "tableless", label: "没有唯一台面", hint: "无台面或有多个水平面的设计", condition: true,
    support: { json: "block", asc: "keep", gem: "keep", gcs: "keep" },
    notes: { json: "工作台需要唯一固定台面，可直接转换为 ASC 或 GCS" }, codes: { block: ["MISSING_TABLE", "AMBIGUOUS_TABLE"] } },
  { id: "open", label: "未闭合的形状", hint: "切面没有把宝石完全包住", condition: true,
    support: { json: "keep", asc: "keep", gem: "keep", gcs: "block" },
    notes: { gcs: "不能可靠转换" }, codes: { block: ["GCS_OPEN_DESIGN"] } },
]);

// Diagnostics that never describe design data (editor sessions, UI symmetry).
const QUIET = new Set(["EDITOR_STATE_OMITTED", "SYMMETRY_NORMALIZED"]);
// Diagnostics a designer should double-check in the other program.
const VERIFY = { UNICODE_TEXT: "文字编码" };

export function formatById(id) {
  return FORMATS.find((format) => format.id === id) ?? null;
}

/** Concepts present in this design, from reader facts and the design itself. */
export function presentConcepts(design, facts = {}) {
  const tiers = design ? design.tiers.filter((tier) => !tier.hidden) : [];
  const entries = tiers.flatMap((tier) => tier.entries);
  const present = new Map();
  if (entries.length) present.set("geometry", `${tiers.length} 层 · ${entries.length} 面`);
  if (design && (design.gear !== 96 || entries.some((entry) => !Number.isInteger(Number(entry.index.toFixed(9)))))) {
    const fractional = entries.filter((entry) => !Number.isInteger(Number(entry.index.toFixed(9)))).length;
    present.set("wheel", fractional ? `${design.gear} 齿 · ${fractional} 个小数分度` : `${design.gear} 齿`);
  }
  const frosted = entries.filter((entry) => entry.finish?.state === "frosted").length;
  if (frosted) present.set("frost", `${frosted} 面`);
  const named = tiers.filter((tier) => tier.name || tier.instructions).length;
  if (named) present.set("names", `${named} 层`);
  const facetNames = tiers.reduce((sum, tier) => sum + individualFacetNames(tier).length, 0);
  if (facetNames) present.set("facetNames", `${facetNames} 面`);
  if (design && (textLines(design.headings).length > 1 || textLines(design.footnotes).length)) {
    present.set("titles", `${textLines(design.headings).length} 行标题 · ${textLines(design.footnotes).length} 行脚注`);
  }
  if (design) present.set("refractiveIndex", String(design.refractiveIndex));
  if (facts.optics?.length) present.set("optics", "已设置");
  if (design?.extras?.gcs?.render) present.set("gcsRender", "已设置");
  const hidden = design ? design.tiers.length - tiers.length : 0;
  if (hidden) present.set("hiddenTiers", `${hidden} 层`);
  if (facts.flattened) present.set("parametric", "有");
  if (facts.overwritten) present.set("history", `${facts.overwritten} 面`);
  if (facts.meet) present.set("meet", `${facts.meet} 面`);
  if (facts.preform) present.set("preform", `${facts.preform} 面`);
  if (facts.roughStock) present.set("roughStock", "有");
  if (facts.concave) present.set("concave", `${facts.concave} 处`);
  if (facts.meshStock) present.set("meshStock", "有");
  if (design && tiers.filter((tier) => tier.region === "crown" && Math.abs(tier.angle) <= 1e-9).length !== 1) present.set("tableless", "是");
  if (facts.open) present.set("open", "是");
  return present;
}

/**
 * A designer's report for writing `present` concepts to `target`, decided by
 * what the writer reported. Concepts nobody reported are kept.
 */
export function transferReport(target, present, diagnostics = []) {
  const emitted = new Set(diagnostics.map((item) => item.code));
  const report = { kept: [], approximate: [], lost: [], blocked: [], verify: [] };
  for (const concept of CONCEPTS) {
    if (!present.has(concept.id)) continue;
    const detail = present.get(concept.id);
    const item = { id: concept.id, label: concept.label, detail, note: concept.notes?.[target] ?? "" };
    const reported = (kind) => (concept.codes?.[kind] ?? []).some((code) => emitted.has(code));
    if (reported("block")) report.blocked.push(item);
    else if (reported("lose")) report.lost.push(item);
    else if (reported("approx")) report.approximate.push(item);
    else if (!concept.condition) report.kept.push({ ...item, note: "" });
  }
  for (const [code, label] of Object.entries(VERIFY)) {
    const found = diagnostics.find((item) => item.code === code);
    if (found) report.verify.push({ id: code, label, note: found.message });
  }
  return report;
}

export function isQuietDiagnostic(item) {
  return QUIET.has(item.code);
}
