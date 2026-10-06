import { tierToolPlanes } from "./composite/tierTools.js";
import { fancyToolPlanes, arcWeaveRowLimit } from "./composite/fancyTools.js";
import { toothSnappedShape } from "./composite/toothSnap.js";
import { RING_CUT_LIMITS } from "./ringCut.js";
import { GRID_CUT_LIMITS } from "./gridCut.js";

/*
 * Composite tools ("复合刀具"): one parametric pattern of planes that is placed
 * on the stone as a whole, like a hood lowered over it, and cut as one CUT
 * layer. Every generated plane is still one ordinary machine setting: index,
 * industry angle and depth on the project wheel.
 *
 * The registry below is the single list of composite tools for the editor and
 * its plans. Ring cuts and grid cuts keep their own engines and draft fields
 * (`ring`, `grid`); every other tool uses the shared `composite` engine:
 *
 *   tool frame planes (rim radius 1, axis away from the girdle)
 *     → slope (edge angle) → apex shift → radius (extent × reference radius)
 *     → whole-tooth rotation → optional whole-tooth snapping
 *     → { index, industry angle, depth } per facet on the crown or pavilion.
 *
 * Whole-tooth snapping (metadata version 2, composite/toothSnap.js) rounds
 * each symmetry orbit once and joint-solves every meet of four or more faces,
 * like grid cuts; it is solved once per tool shape and wheel. Version 1 layers
 * (each facet pivoted about its anchor) regenerate with that rule so they stay
 * editable; saving them again writes version 2.
 *
 * Placement is region-free: a tool cuts the crown or the pavilion by the same
 * construction, mirrored. The CUT draft carries the placement (industryAngle =
 * main or edge angle, depth = apex depth below the reference top or bottom,
 * baseIndex = whole-tooth rotation); `draft.composite` carries the tool, its
 * shape parameters, extent and snapping policy.
 *
 * Pure geometry: no faceting import (faceting validates composite metadata).
 */

export const COMPOSITE_TOOL_VERSION = 2;
/** Saved versions that still regenerate: 1 pivots each facet about its anchor, 2 solves the meets. */
export const COMPOSITE_TOOL_VERSIONS = Object.freeze([1, 2]);
/** Meets solved closer than this (relative to the tool radius) count as exact. */
export const COMPOSITE_MEET_TOLERANCE = 1e-9;
/** Meet points moved further than this (relative to the tool radius) are reported. */
export const COMPOSITE_MEET_SHIFT_LIMIT = 0.05;

/** Library categories, in the order the editor lists them. */
export const COMPOSITE_CATEGORIES = Object.freeze([
  Object.freeze({ id: "ring", label: "环形母形", hint: "沿多边形或圆弧轮廓的一圈刻面，可用于冠、亭和腰部" }),
  Object.freeze({ id: "tier", label: "圈层组合", hint: "台面、星面、阶梯等成套冠亭组件，来自冠亭预设实验室" }),
  Object.freeze({ id: "lattice", label: "晶格面网", hint: "整面铺排的网格刻面；整齿取整后多面交点联合求解" }),
  Object.freeze({ id: "fancy", label: "花式研究", hint: "花冠、风车、螺旋、准晶、弧织等研究刀具" }),
]);

/** Parameter groups, identical for every tool so each panel reads the same way. */
export const COMPOSITE_PARAM_GROUPS = Object.freeze([
  Object.freeze({ id: "symmetry", label: "对称" }),
  Object.freeze({ id: "form", label: "造型" }),
  Object.freeze({ id: "placement", label: "放置" }),
  Object.freeze({ id: "machining", label: "加工" }),
]);

const int = (key, label, min, max, group = "form", extra = {}) => ({ key, label, type: "int", min, max, step: 1, group, ...extra });
const num = (key, label, min, max, step, group = "form", extra = {}) => ({ key, label, type: "number", min, max, step, group, ...extra });
const choice = (key, label, options, group = "form", extra = {}) => ({ key, label, type: "choice", options, group, ...extra });
const bool = (key, label, group = "form", extra = {}) => ({ key, label, type: "bool", group, ...extra });

const TIER_REGION_ANGLES = { crown: 34.5, pavilion: 41 };

/**
 * Every composite tool. `engine` picks the construction; `angle` and `depth`
 * name what the CUT draft's angle and depth control for this tool; `order`
 * returns its rotational symmetry (for the index ring and the wheel check).
 */
export const COMPOSITE_TOOLS = Object.freeze([
  {
    id: "ring-fan", engine: "ring", kind: "fan", category: "ring", label: "扇形环切", short: "环切",
    summary: "L 边母形的每条边切一组扇形刻面，整组同角同深。",
    regions: ["crown", "pavilion", "girdle"],
    angle: { label: "行业角", min: 0, max: 90 }, depth: { label: "切入深度", hint: "主切面深度" },
    params: [
      int("symmetry", "对称数", ...RING_CUT_LIMITS.symmetry, "symmetry"),
      int("subdivisions", "每边细分", ...RING_CUT_LIMITS.subdivisions),
      num("spacingDeg", "细分间距 °", ...RING_CUT_LIMITS.spacingDeg, 0.5),
    ],
    defaults: { symmetry: 3, subdivisions: 3, spacingDeg: 15 },
    presets: [
      { id: "l3", label: "三边 · 3 细分", params: { symmetry: 3, subdivisions: 3, spacingDeg: 15 } },
      { id: "l4", label: "四边 · 3 细分", params: { symmetry: 4, subdivisions: 3, spacingDeg: 12 } },
      { id: "l6", label: "六边 · 2 细分", params: { symmetry: 6, subdivisions: 2, spacingDeg: 10 } },
    ],
    order: (p) => p.symmetry,
  },
  {
    id: "ring-arc", engine: "ring", kind: "arc", category: "ring", label: "弧形环切", short: "弧切",
    summary: "把母形的边鼓成圆弧再等分成弦，联合求解各级深度，交点落在弧上。",
    regions: ["crown", "pavilion", "girdle"],
    angle: { label: "行业角", min: 0, max: 90 }, depth: { label: "切入深度", hint: "主切面（最外一级）深度" },
    params: [
      int("symmetry", "对称数", ...RING_CUT_LIMITS.symmetry, "symmetry"),
      int("subdivisions", "每弧分段", ...RING_CUT_LIMITS.subdivisions),
      num("bulge", "凸度", ...RING_CUT_LIMITS.bulge, 0.01, "form", { hint: "0 直边 · 1 整圆" }),
    ],
    defaults: { symmetry: 3, subdivisions: 3, bulge: 0.5 },
    presets: [
      { id: "l3", label: "三弧 · 凸度 .5", params: { symmetry: 3, subdivisions: 3, bulge: 0.5 } },
      { id: "l2", label: "橄榄 · 两弧", params: { symmetry: 2, subdivisions: 4, bulge: 0.6 } },
      { id: "l4", label: "四弧 · 凸度 .35", params: { symmetry: 4, subdivisions: 3, bulge: 0.35 } },
    ],
    order: (p) => p.symmetry,
  },
  {
    id: "grid", engine: "grid", category: "lattice", label: "网格切", short: "网格",
    summary: "穹顶刀具的切平面铺成方格、蜂窝或三角网格；整齿取整后联合求解，每个格点精确相交。",
    regions: ["crown", "pavilion"],
    angle: { label: "边缘角", min: GRID_CUT_LIMITS.edgeAngle[0], max: GRID_CUT_LIMITS.edgeAngle[1] }, depth: { label: "顶点深度", hint: "刀具顶点到参考顶面" },
    params: [
      choice("symmetry", "对称", [[1, "一次"], [2, "二次"], [3, "三次"], [4, "四次"], [6, "六次"]], "symmetry"),
      bool("mirror", "镜像对称", "symmetry"),
      choice("lattice", "网格", [["square", "方格"], ["hex", "蜂窝"], ["tri", "三角"]], "form", { options: (p) => (p.symmetry === 3 || p.symmetry === 6 ? [["hex", "蜂窝"], ["tri", "三角"]] : [["square", "方格"]]) }),
      int("columns", "行列数", ...GRID_CUT_LIMITS.columns, "form", { when: (p) => p.lattice === "square", label: (p) => (p.symmetry === 4 ? "行列数" : "列数") }),
      int("rows", "行数", ...GRID_CUT_LIMITS.rows, "form", { when: (p) => p.lattice === "square" && p.symmetry !== 4 }),
      int("rings", "圈数", ...GRID_CUT_LIMITS.rings, "form", { when: (p) => p.lattice !== "square" }),
      choice("scope", "范围", [["face", "整面"], ["row", "单行"]], "form"),
      int("row", "第几行", 0, 24, "form", { when: (p) => p.scope === "row", offset: 1, hint: "从下往上数" }),
      bool("rowCopies", "含对称副本", "form", { when: (p) => p.scope === "row" }),
    ],
    defaults: { symmetry: 4, mirror: true, lattice: "square", columns: 6, rows: 6, rings: 3, scope: "face", row: 0, rowCopies: true },
    presets: [
      { id: "square6", label: "四次方格 6×6", params: { symmetry: 4, lattice: "square", columns: 6 } },
      { id: "hex3", label: "六次蜂窝 3 圈", params: { symmetry: 6, lattice: "hex", rings: 3 } },
      { id: "tri3", label: "六次三角 3 圈", params: { symmetry: 6, lattice: "tri", rings: 3 } },
      { id: "square2", label: "二次方格 4×6", params: { symmetry: 2, lattice: "square", columns: 4, rows: 6 } },
    ],
    order: (p) => p.symmetry,
  },
  {
    id: "brilliant", engine: "tier", family: "brilliant", category: "tier", label: "明亮式", short: "明亮",
    summary: "主面加星面与上腰面（或下腰面），各级角度由交点解析求出。",
    regions: ["crown", "pavilion"],
    angle: { label: "主面角", min: 5, max: 80, region: TIER_REGION_ANGLES }, depth: { label: "顶点深度", hint: "台面（或尖底）到参考顶面" },
    params: [
      int("symmetry", "对称数", 3, 32, "symmetry"),
      choice("style", "构造", [["star", "星面 + 上腰"], ["lower", "下腰面"]], "form"),
      num("inner", "台面开合", 0.06, 0.92, 0.01, "form", { percent: true, when: (p) => p.style === "star" }),
      num("star", "星面舒展", 0.15, 0.85, 0.01, "form", { percent: true, when: (p) => p.style === "star" }),
      num("lower", "下腰延伸", 0.25, 0.9, 0.01, "form", { percent: true, when: (p) => p.style === "lower" }),
      num("inner", "尖底截平", 0, 0.4, 0.01, "form", { percent: true, when: (p) => p.style === "lower" }),
    ],
    defaults: { symmetry: 8, style: "star", inner: 0.56, star: 0.5, lower: 0.75 },
    regionDefaults: { pavilion: { style: "lower", inner: 0 } },
    presets: [
      { id: "eight", label: "经典八向", params: { symmetry: 8 } },
      { id: "six", label: "六向", params: { symmetry: 6 } },
      { id: "twelve", label: "十二向", params: { symmetry: 12 } },
      { id: "sixteen", label: "十六向", params: { symmetry: 16 } },
    ],
    order: (p) => p.symmetry,
  },
  {
    id: "step", engine: "tier", family: "step", category: "tier", label: "阶梯式", short: "阶梯",
    summary: "同相位的同心阶梯；逐层角度与层宽决定高度。",
    regions: ["crown", "pavilion"],
    angle: { label: "主面角", min: 5, max: 80, region: { crown: 36, pavilion: 45 } }, depth: { label: "顶点深度", hint: "台面（或尖底）到参考顶面" },
    params: [
      int("symmetry", "对称数", 3, 32, "symmetry"),
      choice("outline", "轮廓", [["round", "圆形"], ["emerald", "截角"]], "symmetry"),
      int("layers", "层数", 1, 8),
      num("spread", "层间角差 °", 0, 60, 0.5),
      choice("rhythm", "层带节奏", [["even", "均匀"], ["outer", "外圈宽"], ["inner", "内圈宽"]]),
      num("inner", "台面开合", 0, 0.92, 0.01, "form", { percent: true }),
      num("bevel", "截角", 0.05, 0.8, 0.01, "form", { when: (p) => p.outline === "emerald" }),
    ],
    defaults: { symmetry: 8, outline: "round", layers: 3, spread: 20, rhythm: "even", inner: 0.56, bevel: 0.3 },
    regionDefaults: { pavilion: { inner: 0 } },
    presets: [
      { id: "oct3", label: "八角三阶", params: { symmetry: 8, layers: 3 } },
      { id: "sq3", label: "方形三阶", params: { symmetry: 4, layers: 3 } },
      { id: "round4", label: "圆形四阶", params: { symmetry: 16, layers: 4 } },
      { id: "emerald4", label: "截角四阶", params: { symmetry: 8, layers: 4, outline: "emerald" } },
    ],
    order: (p) => (p.outline === "emerald" ? 4 : p.symmetry),
  },
  {
    id: "stagger", engine: "tier", family: "stagger", category: "tier", label: "错层环式", short: "错层",
    summary: "层间按扇区交错错位，葡萄牙式的节奏探索。",
    regions: ["crown", "pavilion"],
    angle: { label: "主面角", min: 5, max: 80, region: { crown: 37, pavilion: 47 } }, depth: { label: "顶点深度", hint: "台面（或尖底）到参考顶面" },
    params: [
      int("symmetry", "对称数", 3, 32, "symmetry"),
      int("layers", "层数", 1, 8),
      num("spread", "层间角差 °", 0, 60, 0.5),
      num("twist", "错位（扇区）", -1, 1, 0.05),
      choice("rhythm", "层带节奏", [["even", "均匀"], ["outer", "外圈宽"], ["inner", "内圈宽"]]),
      num("inner", "台面开合", 0, 0.92, 0.01, "form", { percent: true }),
    ],
    defaults: { symmetry: 8, layers: 4, spread: 24, twist: 0.5, rhythm: "even", inner: 0.56 },
    regionDefaults: { pavilion: { inner: 0 } },
    presets: [
      { id: "eight", label: "八向错层", params: { symmetry: 8 } },
      { id: "twelve", label: "十二向错层", params: { symmetry: 12 } },
      { id: "sixteen", label: "十六向错层", params: { symmetry: 16 } },
    ],
    order: (p) => p.symmetry,
  },
  {
    id: "radial", engine: "tier", family: "fan", category: "tier", label: "放射主面", short: "放射",
    summary: "单圈主面加台面或尖底，最少面数的基础结构。",
    regions: ["crown", "pavilion"],
    angle: { label: "主面角", min: 5, max: 80, region: { crown: 32, pavilion: 42 } }, depth: { label: "顶点深度", hint: "台面（或尖底）到参考顶面" },
    params: [
      int("symmetry", "对称数", 3, 32, "symmetry"),
      num("inner", "台面开合", 0, 0.92, 0.01, "form", { percent: true }),
    ],
    defaults: { symmetry: 8, inner: 0.56 },
    regionDefaults: { pavilion: { inner: 0 } },
    presets: [
      { id: "eight", label: "八主面", params: { symmetry: 8 } },
      { id: "six", label: "六主面", params: { symmetry: 6 } },
      { id: "sixteen", label: "十六主面", params: { symmetry: 16 } },
    ],
    order: (p) => p.symmetry,
  },
  {
    id: "scissor", engine: "tier", family: "scissor", category: "tier", label: "剪式节奏", short: "剪式", experimental: true,
    summary: "每层两条相位轨道交叉的实验节奏，不代表标准 Princess／Chevron。",
    regions: ["crown", "pavilion"],
    angle: { label: "主面角", min: 5, max: 80, region: { crown: 36, pavilion: 45 } }, depth: { label: "顶点深度", hint: "台面（或尖底）到参考顶面" },
    params: [
      int("symmetry", "对称数", 3, 32, "symmetry"),
      int("layers", "层数", 1, 8),
      num("spread", "层间角差 °", 0, 60, 0.5),
      num("twist", "剪式张角（扇区）", -1, 1, 0.05),
      num("inner", "台面开合", 0, 0.92, 0.01, "form", { percent: true }),
    ],
    defaults: { symmetry: 8, layers: 3, spread: 18, twist: 0.5, inner: 0.56 },
    regionDefaults: { pavilion: { inner: 0 } },
    presets: [{ id: "eight", label: "八向剪式", params: { symmetry: 8 } }, { id: "four", label: "四向剪式", params: { symmetry: 4 } }],
    order: (p) => p.symmetry,
  },
  {
    id: "keel", engine: "tier", family: "keel", category: "tier", label: "龙骨阶梯", short: "龙骨",
    summary: "截角长方的阶梯面在底部汇成一条真实龙骨棱，而不是拉长的尖点。",
    regions: ["crown", "pavilion"],
    angle: { label: "主面角", min: 5, max: 80, region: { crown: 40, pavilion: 44 } }, depth: { label: "顶点深度", hint: "龙骨到参考底面" },
    params: [
      int("layers", "层数", 1, 8),
      num("spread", "层间角差 °", 0, 60, 0.5),
      num("keel", "龙骨长度", 0, 1.5, 0.01),
      num("bevel", "截角", 0.05, 0.8, 0.01),
      num("inner", "尖底截平", 0, 0.4, 0.01, "form", { percent: true }),
    ],
    defaults: { layers: 3, spread: 14, keel: 0.5, bevel: 0.3, inner: 0 },
    presets: [{ id: "k50", label: "龙骨 0.50 · 三阶", params: { keel: 0.5, layers: 3 } }, { id: "k100", label: "龙骨 1.00 · 四阶", params: { keel: 1, layers: 4 } }],
    order: () => 2,
  },
  {
    id: "rose", engine: "tier", family: "rose", category: "tier", label: "三角玫瑰冠", short: "玫瑰",
    summary: "交错顶点环上的凸支持面，无台面的浅拱三角刻面。",
    regions: ["crown", "pavilion"],
    angle: { label: "边缘角", min: 5, max: 60, region: { crown: 29, pavilion: 35 } }, depth: { label: "顶点深度", hint: "拱顶到参考顶面" },
    params: [
      int("symmetry", "对称数", 3, 24, "symmetry"),
      int("layers", "环数", 1, 6),
    ],
    defaults: { symmetry: 8, layers: 2 },
    presets: [{ id: "r82", label: "八向 · 两环", params: { symmetry: 8, layers: 2 } }, { id: "r123", label: "十二向 · 三环", params: { symmetry: 12, layers: 3 } }],
    order: (p) => p.symmetry,
  },
  {
    id: "rosette", engine: "fancy", family: "rosette", category: "fancy", label: "错层花冠", short: "花冠",
    summary: "每圈按半个扇区交替错列，形成有共同镜像轴的多层花冠。",
    regions: ["crown", "pavilion"],
    angle: { label: "边缘角", min: 10, max: 60, region: { crown: 35, pavilion: 40 } }, depth: { label: "顶点深度", hint: "刀具顶点到参考顶面" },
    params: [
      int("symmetry", "对称数", 3, 24, "symmetry"),
      int("rings", "圈数", 2, 9),
      num("inner", "内圈半径", 0.05, 0.45, 0.01),
      num("spacing", "圈距指数", 0.5, 2, 0.05),
      num("table", "中心截平", 0, 0.4, 0.01),
    ],
    defaults: { symmetry: 9, rings: 5, inner: 0.13, spacing: 1, table: 0.06 },
    presets: [{ id: "nine", label: "九重花冠", params: { symmetry: 9, rings: 5 } }, { id: "six", label: "六重花冠", params: { symmetry: 6, rings: 4 } }],
    order: (p) => p.symmetry,
  },
  {
    id: "pinwheel", engine: "fancy", family: "pinwheel", category: "fancy", label: "手性风车", short: "风车",
    summary: "相邻圈持续同向转动；保留旋转对称，可选镜像。",
    regions: ["crown", "pavilion"],
    angle: { label: "边缘角", min: 10, max: 60, region: { crown: 33, pavilion: 40 } }, depth: { label: "顶点深度", hint: "刀具顶点到参考顶面" },
    params: [
      int("symmetry", "对称数", 3, 24, "symmetry"),
      bool("mirror", "镜像补全", "symmetry"),
      int("rings", "圈数", 2, 9),
      num("twist", "每圈转角 °", -30, 30, 0.5),
      num("inner", "内圈半径", 0.05, 0.45, 0.01),
      num("spacing", "圈距指数", 0.5, 2, 0.05),
      num("table", "中心截平", 0, 0.4, 0.01),
    ],
    defaults: { symmetry: 8, mirror: false, rings: 6, twist: 11, inner: 0.13, spacing: 1, table: 0 },
    presets: [{ id: "eight", label: "八重右旋", params: { symmetry: 8, twist: 11 } }, { id: "twelve", label: "十二重左旋", params: { symmetry: 12, twist: -9 } }],
    order: (p) => p.symmetry,
  },
  {
    id: "split", engine: "fancy", family: "split", category: "fancy", label: "主面分裂", short: "分裂",
    summary: "一个母面分成对称的两翼，分裂量、圈数与切角联动。",
    regions: ["crown", "pavilion"],
    angle: { label: "边缘角", min: 10, max: 60, region: { crown: 35, pavilion: 41 } }, depth: { label: "顶点深度", hint: "刀具顶点到参考顶面" },
    params: [
      int("symmetry", "对称数", 3, 24, "symmetry"),
      int("rings", "圈数", 2, 9),
      num("split", "分裂量", 0.025, 0.45, 0.005),
      num("inner", "内圈半径", 0.05, 0.45, 0.01),
      num("spacing", "圈距指数", 0.5, 2, 0.05),
      num("table", "中心截平", 0, 0.4, 0.01),
    ],
    defaults: { symmetry: 8, rings: 4, split: 0.18, inner: 0.18, spacing: 1, table: 0.1 },
    presets: [{ id: "eight", label: "八重分裂", params: { symmetry: 8 } }, { id: "six", label: "六重分裂", params: { symmetry: 6 } }],
    order: (p) => p.symmetry,
  },
  {
    id: "twist", engine: "fancy", family: "twist", category: "fancy", label: "螺旋层切", short: "螺旋",
    summary: "以半径的对数控制相位，圈距按幂律变化，构成同轴螺旋层。",
    regions: ["crown", "pavilion"],
    angle: { label: "边缘角", min: 10, max: 60, region: { crown: 36, pavilion: 41 } }, depth: { label: "顶点深度", hint: "刀具顶点到参考顶面" },
    params: [
      int("symmetry", "对称数", 3, 24, "symmetry"),
      bool("mirror", "镜像补全", "symmetry"),
      int("rings", "圈数", 2, 9),
      num("twist", "螺旋强度 °", -30, 30, 0.5),
      num("inner", "内圈半径", 0.05, 0.45, 0.01),
      num("spacing", "圈距指数", 0.5, 2, 0.05),
      num("table", "中心截平", 0, 0.4, 0.01),
    ],
    defaults: { symmetry: 12, mirror: false, rings: 7, twist: 14, inner: 0.11, spacing: 1.6, table: 0 },
    presets: [{ id: "twelve", label: "十二臂螺旋", params: { symmetry: 12 } }, { id: "eight", label: "八臂螺旋", params: { symmetry: 8, rings: 6 } }],
    order: (p) => p.symmetry,
  },
  {
    id: "honeycomb", engine: "fancy", family: "honeycomb", category: "lattice", label: "拉伸蜂窝", short: "蜂窝",
    summary: "可拉伸的蜂窝晶胞；不拉伸时请用网格切的蜂窝（交点按整齿联合求解）。",
    regions: ["crown", "pavilion"],
    angle: { label: "边缘角", min: 10, max: 60, region: { crown: 33, pavilion: 40 } }, depth: { label: "顶点深度", hint: "刀具顶点到参考顶面" },
    params: [
      int("density", "密度", 2, 5),
      num("stretch", "晶胞长宽", 0.65, 1.6, 0.01),
    ],
    defaults: { density: 4, stretch: 1.3 },
    presets: [{ id: "stretch", label: "长宽 1.3", params: { stretch: 1.3 } }, { id: "wide", label: "长宽 0.8", params: { stretch: 0.8 } }],
    order: (p) => (Math.abs(p.stretch - 1) < 1e-9 ? 6 : 2),
  },
  {
    id: "oblique", engine: "fancy", family: "oblique", category: "lattice", label: "偏斜织网", short: "织网",
    summary: "两个方向的凸折线相加，得到任意交角的平行四边形刻面。",
    regions: ["crown", "pavilion"],
    angle: { label: "边缘角", min: 10, max: 60, region: { crown: 33, pavilion: 40 } }, depth: { label: "顶点深度", hint: "刀具顶点到参考顶面" },
    params: [
      int("density", "密度", 2, 5),
      num("crossAngle", "交角 °", 40, 90, 0.5),
    ],
    defaults: { density: 4, crossAngle: 68 },
    presets: [{ id: "net68", label: "六十八度织网", params: { crossAngle: 68 } }, { id: "net90", label: "正交织网", params: { crossAngle: 90 } }],
    order: (p) => (Math.abs(p.crossAngle - 90) < 1e-9 ? 4 : 2),
  },
  {
    id: "asanoha", engine: "fancy", family: "asanoha", category: "lattice", label: "麻叶细分", short: "麻叶",
    summary: "晶格顶点、边中点与抬升的中心三点共面，切出真实的三角叶片。",
    regions: ["crown", "pavilion"],
    angle: { label: "边缘角", min: 10, max: 60, region: { crown: 32, pavilion: 40 } }, depth: { label: "顶点深度", hint: "刀具顶点到参考顶面" },
    params: [
      choice("lattice", "晶格", [["tri", "三角 · 六向"], ["square", "方形 · 八叶"]], "symmetry"),
      int("density", "密度", 2, 5),
      num("lift", "叶脊抬升", 0.05, 0.95, 0.01),
    ],
    defaults: { lattice: "tri", density: 3, lift: 0.5 },
    presets: [{ id: "tri", label: "六向麻叶", params: { lattice: "tri" } }, { id: "square", label: "八向叶片", params: { lattice: "square" } }],
    order: (p) => (p.lattice === "square" ? 4 : 6),
  },
  {
    id: "pentagrid", engine: "fancy", family: "pentagrid", category: "lattice", label: "五重准晶", short: "准晶",
    summary: "五组网格的对偶生成非周期的粗细菱形，四角共面、整组五重对称。",
    regions: ["crown", "pavilion"],
    angle: { label: "边缘角", min: 10, max: 60, region: { crown: 34, pavilion: 40 } }, depth: { label: "顶点深度", hint: "刀具顶点到参考顶面" },
    params: [
      int("density", "菱形密度", 2, 6),
      choice("offset", "内部相位", [[0.2, "0.2 · 拼接 A"], [0.4, "0.4 · 拼接 B"], [0.6, "0.6"], [0.8, "0.8"]]),
    ],
    defaults: { density: 3, offset: 0.2 },
    presets: [{ id: "a", label: "五重准晶 A", params: { offset: 0.2 } }, { id: "b", label: "五重准晶 B", params: { offset: 0.4 } }],
    order: () => 5,
  },
  {
    id: "arcweave", engine: "fancy", family: "arcweave", category: "fancy", label: "弧织面网", short: "弧织",
    summary: "两族短直边沿对数螺旋连续相接，每个四边形严格共面。",
    regions: ["crown", "pavilion"],
    angle: { label: "边缘角", min: 10, max: 60, region: { crown: 32, pavilion: 40 } }, depth: { label: "顶点深度", hint: "刀具顶点到参考顶面" },
    params: [
      int("symmetry", "对称数", 8, 24, "symmetry"),
      num("shear", "偏旋", -0.7, 0.7, 0.05, "symmetry", { hint: "0 左右对等；正负为两种手性" }),
      int("rows", "层数", 4, 32),
    ],
    defaults: { symmetry: 12, shear: 0, rows: 10 },
    presets: [{ id: "d12", label: "十二重双向", params: { symmetry: 12, shear: 0 } }, { id: "c12", label: "十二重偏旋", params: { symmetry: 12, shear: 0.55, rows: 12 } }],
    order: (p) => p.symmetry,
  },
  {
    id: "spiro", engine: "fancy", family: "spiro", category: "fancy", label: "回旋轨迹", short: "回旋",
    summary: "有理双频闭合曲线上的对称采样点生成刻面；曲线只是构造轨迹。",
    regions: ["crown", "pavilion"],
    angle: { label: "边缘角", min: 10, max: 60, region: { crown: 32, pavilion: 40 } }, depth: { label: "顶点深度", hint: "刀具顶点到参考顶面" },
    params: [
      int("lobes", "瓣数 P", 3, 24, "symmetry"),
      int("turns", "绕数 Q", 1, 23),
      num("amplitude", "振幅", 0.08, 0.6, 0.01),
      int("samples", "每瓣采样", 3, 16),
    ],
    defaults: { lobes: 12, turns: 5, amplitude: 0.38, samples: 6 },
    presets: [{ id: "twelve", label: "十二瓣回旋", params: { lobes: 12, turns: 5 } }, { id: "eight", label: "八瓣回旋", params: { lobes: 8, turns: 3 } }],
    order: (p) => p.lobes / gcd(p.lobes, p.turns),
  },
  {
    id: "bars", engine: "fancy", family: "bars", category: "fancy", label: "平行条带", short: "条带",
    summary: "沿一条直径排列的平行条带；冠部与亭部各切一组、转开角度即为对向条带。",
    regions: ["crown", "pavilion"],
    angle: { label: "边缘角", min: 10, max: 60, region: { crown: 29, pavilion: 38 } }, depth: { label: "顶点深度", hint: "刀具顶点到参考顶面" },
    params: [int("density", "条带数（单侧）", 1, 8)],
    defaults: { density: 5 },
    presets: [{ id: "five", label: "十一条带", params: { density: 5 } }, { id: "three", label: "七条带", params: { density: 3 } }],
    order: () => 2,
  },
]);

const TOOL_BY_ID = new Map(COMPOSITE_TOOLS.map((tool) => [tool.id, tool]));
export const compositeTool = (id) => TOOL_BY_ID.get(id) ?? null;

function gcd(a, b) {
  let x = Math.round(Math.abs(a)), y = Math.round(Math.abs(b));
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const optionValues = (param, values) => (typeof param.options === "function" ? param.options(values) : param.options).map(([value]) => value);

/** Default shape parameters of a tool for a region (crown unless given). */
export function compositeToolDefaults(id, region = "crown") {
  const tool = compositeTool(id);
  if (!tool) throw new RangeError(`未知复合刀具：${id}`);
  return { ...tool.defaults, ...(tool.regionDefaults?.[region] ?? {}) };
}

/** Default placement angle of a tool for a region. */
export function compositeToolAngle(id, region = "crown") {
  const tool = compositeTool(id);
  return tool?.angle.region?.[region] ?? tool?.angle.region?.crown ?? (tool?.engine === "grid" ? 36 : 32);
}

/** Complete, valid shape parameters of a tool (clamped, with defaults and tool constraints). */
export function normalizeCompositeParams(id, input = {}) {
  const tool = compositeTool(id);
  if (!tool) throw new RangeError(`未知复合刀具：${id}`);
  const values = { ...tool.defaults, ...input };
  // Choices first (in list order): which numeric fields apply can depend on them.
  for (const param of tool.params) {
    if (param.type !== "choice") continue;
    const allowed = optionValues(param, values);
    if (!allowed.includes(values[param.key])) values[param.key] = allowed.includes(tool.defaults[param.key]) ? tool.defaults[param.key] : allowed[0];
  }
  // A key may have several fields (e.g. table or culet size by construction); only the active one clamps it.
  for (const param of tool.params) {
    if (param.type === "choice" || (param.when && !param.when(values))) continue;
    const raw = values[param.key];
    if (param.type === "int") values[param.key] = Math.round(clamp(Number.isFinite(Number(raw)) ? Number(raw) : tool.defaults[param.key], param.min, param.max));
    else if (param.type === "number") values[param.key] = Number(clamp(Number.isFinite(Number(raw)) ? Number(raw) : tool.defaults[param.key], param.min, param.max).toFixed(6));
    else if (param.type === "bool") values[param.key] = Boolean(raw);
  }
  if (tool.id === "arcweave") values.rows = Math.min(values.rows, arcWeaveRowLimit(values.symmetry, values.shear));
  if (tool.id === "spiro") values.turns = Math.min(values.turns, values.lobes - 1);
  if (tool.id === "brilliant" && values.style === "star") values.inner = Math.max(0.06, values.inner);
  if (tool.id === "keel") Object.assign(values, { symmetry: 8, outline: "emerald" });
  const known = new Set(tool.params.map((param) => param.key));
  return Object.fromEntries(Object.entries(values).filter(([key]) => known.has(key) || (tool.id === "keel" && ["symmetry", "outline"].includes(key))));
}

/** Rotational symmetry of a tool with these parameters. */
export function compositeToolOrder(id, params) {
  const tool = compositeTool(id);
  return tool ? tool.order(normalizeCompositeParams(id, params)) : 1;
}

// One generated shape per tool, parameters and (for tier tools) angle; dragging
// the depth, rotation or a dome tool's edge angle never regenerates a shape.
const shapeCache = new Map();
function toolShape(tool, params, angle) {
  const key = JSON.stringify([tool.id, params, tool.engine === "tier" ? angle : null]);
  if (shapeCache.has(key)) return shapeCache.get(key);
  const planes = tool.engine === "tier"
    ? tierToolPlanes(tool.family, { ...params, angle, spread: params.spread ?? 0, twist: params.twist ?? 0, inner: params.inner ?? 0, rhythm: params.rhythm ?? "even", outline: params.outline ?? "round" })
    : fancyToolPlanes(tool.family, params);
  if (planes.length > 1200) throw new RangeError(`刀具生成 ${planes.length} 个平面，超过 1200；请降低密度或圈数。`);
  const shape = planes
    .filter((plane) => plane.n[2] > 1e-9)
    .map((plane) => ({
      cell: plane.cell, tier: plane.tier,
      g: [plane.n[0] / plane.n[2], plane.n[1] / plane.n[2]],
      c: plane.d / plane.n[2],
      anchor: plane.anchor,
    }));
  if (shapeCache.size > 48) shapeCache.delete(shapeCache.keys().next().value);
  shapeCache.set(key, shape);
  return shape;
}

const normalizeTooth = (index, teeth) => {
  const value = ((index % teeth) + teeth) % teeth;
  return Math.abs(value - teeth) < 1e-9 ? 0 : value;
};

// One tooth-snapped shape per tool, parameters, wheel and (for tier tools) angle.
// The meet equations are homogeneous in slope and placement is rigid, so a dome
// tool's edge angle, the apex depth, the extent and the rotation never re-solve.
const snapCache = new Map();
function snappedShape(tool, params, angle, teeth, shape) {
  const key = JSON.stringify([tool.id, params, tool.engine === "tier" ? angle : null, teeth]);
  if (snapCache.has(key)) return snapCache.get(key);
  const snapped = toothSnappedShape(shape, { order: tool.order(params), teeth, pinFirst: tool.engine === "tier" });
  if (snapCache.size > 48) snapCache.delete(snapCache.keys().next().value);
  snapCache.set(key, snapped);
  return snapped;
}

/**
 * The tool in its own frame (rim radius 1, unit edge slope for dome tools):
 * the ideal planes z = c - g·(x, y) and their tooth-snapped version 2 planes
 * with the meet report. For diagnostics and tests; layouts place the same data.
 */
export function compositeToolFrame(composite, { indexTeeth = 96, angle } = {}) {
  const tool = compositeTool(composite?.tool);
  if (!tool || !["tier", "fancy"].includes(tool.engine)) throw new RangeError("未知或不受此引擎管理的复合刀具。");
  const params = normalizeCompositeParams(tool.id, composite.params);
  const toolAngle = clamp(Number.isFinite(angle) ? angle : compositeToolAngle(tool.id), tool.angle.min, tool.angle.max);
  const shape = toolShape(tool, params, toolAngle);
  return { shape, snapped: snappedShape(tool, params, toolAngle, indexTeeth, shape) };
}

/**
 * A composite tool placed on a reference (cube stock or cutting reference):
 * one entry per facet that reaches the reference envelope, in tool order.
 *
 * `angle` is the main (tier tools) or edge angle (dome tools), `depth` the
 * apex depth below the reference top (crown) or above its bottom (pavilion),
 * `rotation` whole teeth. `composite.snap` is "tooth" (whole teeth: each
 * symmetry orbit rounded once, meets of four or more faces joint-solved) or
 * "exact" (keep fractional indices). `version` 1 regenerates a layer saved
 * with the earlier tooth rule (each facet pivoted about its anchor point).
 */
export function compositeToolLayout(composite, { indexTeeth = 96, reference = { size: 2, center: [0, 0, 0] }, angle, depth = 0, rotation = 0, version = composite?.version ?? COMPOSITE_TOOL_VERSION } = {}) {
  if (!COMPOSITE_TOOL_VERSIONS.includes(version)) throw new RangeError("不支持此复合刀具算法版本。");
  const tool = compositeTool(composite?.tool);
  if (!tool || !["tier", "fancy"].includes(tool.engine)) throw new RangeError("未知或不受此引擎管理的复合刀具。");
  const params = normalizeCompositeParams(tool.id, composite.params);
  const toolAngle = clamp(Number.isFinite(angle) ? angle : compositeToolAngle(tool.id), tool.angle.min, tool.angle.max);
  const extent = clamp(Number.isFinite(composite.extent) ? composite.extent : 1, 0.2, 1.5);
  const snap = composite.snap === "exact" ? "exact" : "tooth";
  const teeth = indexTeeth;
  if (!Number.isInteger(rotation)) throw new RangeError("复合刀具只能按整齿旋转。");
  const shape = toolShape(tool, params, toolAngle);
  const slope = tool.engine === "fancy" ? Math.tan((toolAngle * Math.PI) / 180) : 1;
  const radius = reference.envelope?.radius ?? reference.size / 2;
  const center = reference.center ?? [0, 0, 0];
  const width = extent * radius;
  const facets = [];
  let dropped = 0, maxSnapDeg = 0, fractional = 0, meets = null;
  const place = (plane, index, g, c, m = Math.hypot(g[0], g[1])) => {
    const norm = Math.hypot(m, 1);
    const facetDepth = (g[0] * center[0] + g[1] * center[1] + radius * m + depth - c) / norm;
    if (!(facetDepth >= 0)) { dropped += 1; return; }
    facets.push({
      cell: plane.cell, tier: plane.tier, index,
      industryAngleDeg: Number(((Math.atan(m) * 180) / Math.PI).toFixed(12)),
      depth: Number(facetDepth.toFixed(12)),
      flat: m < 1e-12,
    });
  };
  if (snap === "tooth" && version >= 2) {
    const snapped = snappedShape(tool, params, toolAngle, teeth, shape);
    const apex = Math.min(...snapped.planes.map((plane) => plane.c * slope));
    snapped.planes.forEach((plane, k) => {
      const index = normalizeTooth(plane.index + rotation, teeth), phi = (index * 2 * Math.PI) / teeth, m = plane.flat ? 0 : plane.m * slope;
      place(shape[k], plane.flat ? normalizeTooth(rotation, teeth) : index, [m * Math.cos(phi), m * Math.sin(phi)], (plane.c * slope - apex) * width);
    });
    maxSnapDeg = snapped.report.maxSnapDeg;
    const r = snapped.report;
    meets = {
      meets: r.meets,
      // Absolute units on the placed tool; the flags compare tool-frame values with the tool radius.
      meetResidual: r.meetResidual * slope * width,
      maxShift: r.maxShift * width,
      meetsExact: r.meetResidual <= COMPOSITE_MEET_TOLERANCE * Math.max(1, ...snapped.planes.map((plane) => Math.abs(plane.c))),
      meetShiftLarge: r.maxShift > COMPOSITE_MEET_SHIFT_LIMIT,
      lostMeets: r.lostMeets, mergedFacets: r.mergedFacets, newShortEdge: Boolean(r.newShortEdge),
      shortestEdge: r.shortestEdge === null ? null : r.shortestEdge * width,
      separated: r.separated, symmetry: r.symmetry,
    };
  } else {
    // Exact indices, and the version 1 tooth rule kept verbatim for older layers.
    const apex = Math.min(...shape.map((plane) => plane.c * slope));
    const turn = (rotation * 2 * Math.PI) / teeth;
    for (const plane of shape) {
      let g = [plane.g[0] * slope, plane.g[1] * slope];
      let c = (plane.c * slope - apex) * width;
      const az = (plane.anchor[2] * slope - apex) * width;
      // Rotate the plane (and its anchor) by the whole-tooth rotation.
      const cos = Math.cos(turn), sin = Math.sin(turn);
      g = [g[0] * cos - g[1] * sin, g[0] * sin + g[1] * cos];
      const ax = (plane.anchor[0] * cos - plane.anchor[1] * sin) * width, ay = (plane.anchor[0] * sin + plane.anchor[1] * cos) * width;
      const m = Math.hypot(g[0], g[1]);
      let index;
      if (m < 1e-12) {
        index = normalizeTooth(rotation, teeth);
        g = [0, 0];
      } else {
        const raw = normalizeTooth((Math.atan2(g[1], g[0]) * teeth) / (2 * Math.PI), teeth);
        const nearest = normalizeTooth(Math.round(raw), teeth);
        const error = Math.abs(raw - Math.round(raw)) * 360 / teeth;
        if (snap === "tooth" && error > 1e-9) {
          index = nearest;
          maxSnapDeg = Math.max(maxSnapDeg, error);
          const phi = (index * 2 * Math.PI) / teeth;
          g = [m * Math.cos(phi), m * Math.sin(phi)];
          // Version 1: pivot about the anchor so the facet keeps passing through its own point.
          c = az + g[0] * ax + g[1] * ay;
        } else {
          index = error < 1e-9 ? nearest : Number(raw.toFixed(9));
          if (error >= 1e-9) fractional += 1;
        }
      }
      place(plane, index, g, c, m);
    }
  }
  const levels = layoutLevels(facets);
  return {
    version, tool: tool.id, params, angle: toolAngle, depth, rotation: normalizeTooth(rotation, teeth), extent, snap,
    facets, levels,
    report: {
      planes: shape.length, facets: facets.length, dropped, levels: levels.length, maxSnapDeg, fractional,
      order: tool.order(params),
      exactSymmetry: teeth % tool.order(params) === 0,
      // Tooth snapping (version 2): ≥4-face meets solved, their worst residual and largest point
      // move, meets a neighbour now cuts off, merged facets and a new short edge in top view.
      meets: meets?.meets ?? 0, meetResidual: meets?.meetResidual ?? 0, maxShift: meets?.maxShift ?? 0,
      meetsExact: meets?.meetsExact ?? true, meetShiftLarge: meets?.meetShiftLarge ?? false,
      lostMeets: meets?.lostMeets ?? 0, mergedFacets: meets?.mergedFacets ?? 0, newShortEdge: meets?.newShortEdge ?? false,
      shortestEdge: meets?.shortestEdge ?? null, separated: meets?.separated ?? false, symmetry: meets?.symmetry ?? null,
    },
  };
}

/** Machining groups: one per industry angle and depth, in first-seen order. */
export function layoutLevels(facets) {
  const levels = new Map();
  for (const facet of facets) {
    const key = `${facet.industryAngleDeg.toFixed(6)}|${facet.depth.toFixed(6)}`;
    if (!levels.has(key)) levels.set(key, { key, industryAngleDeg: facet.industryAngleDeg, depth: facet.depth, cells: [], indices: [] });
    const level = levels.get(key);
    level.cells.push(facet.cell);
    level.indices.push(facet.index);
  }
  return [...levels.values()];
}

/** Gears (from `candidates`) on which every placed facet lands on a whole tooth. */
export function compositeExactGears(layout, indexTeeth, candidates) {
  const azimuths = layout.facets.filter((facet) => !facet.flat).map((facet) => (facet.index * 360) / indexTeeth);
  return candidates.filter((teeth) => azimuths.every((azimuth) => {
    const index = (azimuth * teeth) / 360;
    return Math.abs(index - Math.round(index)) < 1e-6;
  }));
}

export function compositeToolMetadata({ composite, angle, depth, rotation }) {
  const tool = compositeTool(composite.tool);
  return {
    version: composite.version ?? COMPOSITE_TOOL_VERSION,
    tool: tool.id,
    params: normalizeCompositeParams(tool.id, composite.params),
    extent: Number.isFinite(composite.extent) ? composite.extent : 1,
    snap: composite.snap === "exact" ? "exact" : "tooth",
    angle, depth, rotation,
  };
}

export function validateCompositeToolMetadata(value, path, addError) {
  if (value === undefined) return;
  const tool = compositeTool(value?.tool);
  const valid = value && typeof value === "object" && COMPOSITE_TOOL_VERSIONS.includes(value.version) && tool && ["tier", "fancy"].includes(tool.engine)
    && value.params && typeof value.params === "object" && !Array.isArray(value.params)
    && Number.isFinite(value.extent) && ["tooth", "exact"].includes(value.snap)
    && Number.isFinite(value.angle) && Number.isFinite(value.depth) && Number.isInteger(value.rotation);
  if (!valid) addError(path, `must be a version ${COMPOSITE_TOOL_VERSIONS.join(" or ")} composite tool (tool, params, extent, snap, angle, depth, rotation)`);
}

/**
 * The saved tool of a layer, or null once its facets no longer match the
 * regenerated tool (a hand edit, a rescale, a fractional rotation or a wheel
 * whose rounding differs). Reopening, editing and saving retain the authored
 * algorithm version; merely saving a design must never upgrade its geometry.
 */
export function compositeToolFromFacets(facets, reference) {
  const saved = facets[0]?.metadata?.composite;
  if (!saved || !COMPOSITE_TOOL_VERSIONS.includes(saved.version) || !compositeTool(saved.tool)) return null;
  const teeth = facets[0].indexTeeth ?? 96;
  try {
    const layout = compositeToolLayout(saved, { indexTeeth: teeth, reference, angle: saved.angle, depth: saved.depth, rotation: saved.rotation, version: saved.version });
    const byCell = new Map(facets.map((facet) => [facet.metadata?.compositeCell, facet]));
    const same = layout.facets.length === facets.length && layout.facets.every((cell) => {
      const facet = byCell.get(cell.cell);
      return facet && Math.abs(normalizeTooth(facet.index, teeth) - cell.index) < 1e-7
        && Math.abs(facet.industryAngleDeg - cell.industryAngleDeg) < 1e-7 && Math.abs(facet.depth - cell.depth) < 1e-7;
    });
    if (!same) return null;
    return { ...saved };
  } catch {
    return null;
  }
}

/**
 * Composite parameters own a CUT draft in composite mode (like a grid tool):
 * the draft's index is the whole-tooth rotation, its angle the tool's main or
 * edge angle and its depth the apex depth. Choosing another mode, a ring or a
 * grid leaves the tool; the facets stay.
 */
export function compositeDraftPatch(draft, patch) {
  const leaving = patch.composite === null || patch.ring || patch.grid
    || ("patternMode" in patch && patch.patternMode !== "composite" && !("composite" in patch));
  if (leaving) return draft.composite || "composite" in patch ? { ...patch, composite: null } : patch;
  const composite = "composite" in patch ? patch.composite : draft.composite;
  if (!composite) return patch;
  const tool = compositeTool(composite.tool);
  if (!tool || !["tier", "fancy"].includes(tool.engine)) return { ...patch, composite: null };
  const teeth = patch.indexTeeth ?? draft.indexTeeth ?? 96;
  const angle = "industryAngle" in patch ? patch.industryAngle : draft.industryAngle;
  return {
    ...patch,
    composite: {
      version: composite.version ?? COMPOSITE_TOOL_VERSION,
      tool: tool.id,
      params: normalizeCompositeParams(tool.id, composite.params),
      extent: clamp(Number.isFinite(composite.extent) ? composite.extent : 1, 0.2, 1.5),
      snap: composite.snap === "exact" ? "exact" : "tooth",
    },
    patternMode: "composite",
    ring: null,
    grid: null,
    baseIndex: normalizeTooth(Math.round("baseIndex" in patch ? patch.baseIndex : draft.baseIndex), teeth),
    industryAngle: clamp(Number.isFinite(angle) ? angle : compositeToolAngle(tool.id), tool.angle.min, tool.angle.max),
  };
}
