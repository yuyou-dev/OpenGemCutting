import { createUpdateOpticsCommand } from "./faceting.js";

// 折射率（钠 D 线）与色散（宝石学 B–G 约定）数值参考宝石学标准资料，
// 与 GemCad 生态经典材质表一致；彩色预设的体色由线性 RGB 转为 sRGB 十六进制。
export const OPTICAL_PRESETS = Object.freeze({
  diamond: Object.freeze({
    id: "diamond",
    label: "无色钻石",
    ior: 2.417,
    dispersion: 0.044,
    bodyColor: "#ffffff",
    absorption: 0,
  }),
  cubicZirconia: Object.freeze({
    id: "cubicZirconia",
    label: "立方氧化锆",
    ior: 2.17,
    dispersion: 0.06,
    bodyColor: "#ffffff",
    absorption: 0,
  }),
  moissanite: Object.freeze({
    id: "moissanite",
    label: "无色莫桑石",
    ior: 2.65,
    dispersion: 0.104,
    bodyColor: "#fbffff",
    absorption: 0.02,
  }),
  ruby: Object.freeze({
    id: "ruby",
    label: "红宝石（刚玉）",
    ior: 1.766,
    dispersion: 0.018,
    bodyColor: "#ff599e",
    absorption: 0.08,
  }),
  blueSapphire: Object.freeze({
    id: "blueSapphire",
    label: "蓝色蓝宝石（刚玉）",
    ior: 1.766,
    dispersion: 0.018,
    bodyColor: "#5987f2",
    absorption: 0.08,
  }),
  sapphire: Object.freeze({
    id: "sapphire",
    label: "白色蓝宝石",
    ior: 1.77,
    dispersion: 0.018,
    bodyColor: "#f4f8ff",
    absorption: 0.025,
  }),
  quartz: Object.freeze({
    id: "quartz",
    label: "石英（水晶）",
    ior: 1.544,
    dispersion: 0.013,
    bodyColor: "#ffffff",
    absorption: 0,
  }),
  amethyst: Object.freeze({
    id: "amethyst",
    label: "紫水晶",
    ior: 1.544,
    dispersion: 0.013,
    bodyColor: "#c994e6",
    absorption: 0.06,
  }),
  citrine: Object.freeze({
    id: "citrine",
    label: "黄水晶",
    ior: 1.544,
    dispersion: 0.013,
    bodyColor: "#ffe07a",
    absorption: 0.06,
  }),
  spinel: Object.freeze({
    id: "spinel",
    label: "尖晶石",
    ior: 1.718,
    dispersion: 0.02,
    bodyColor: "#ffffff",
    absorption: 0,
  }),
  topaz: Object.freeze({
    id: "topaz",
    label: "托帕石",
    ior: 1.62,
    dispersion: 0.014,
    bodyColor: "#ffffff",
    absorption: 0,
  }),
  garnet: Object.freeze({
    id: "garnet",
    label: "铁铝榴石",
    ior: 1.79,
    dispersion: 0.027,
    bodyColor: "#e1596b",
    absorption: 0.08,
  }),
  demantoid: Object.freeze({
    id: "demantoid",
    label: "翠榴石",
    ior: 1.888,
    dispersion: 0.057,
    bodyColor: "#94ed87",
    absorption: 0.06,
  }),
  emerald: Object.freeze({
    id: "emerald",
    label: "祖母绿（绿柱石）",
    ior: 1.577,
    dispersion: 0.014,
    bodyColor: "#59e69e",
    absorption: 0.08,
  }),
  aquamarine: Object.freeze({
    id: "aquamarine",
    label: "海蓝宝石（绿柱石）",
    ior: 1.577,
    dispersion: 0.014,
    bodyColor: "#b0edf2",
    absorption: 0.05,
  }),
  peridot: Object.freeze({
    id: "peridot",
    label: "橄榄石",
    ior: 1.654,
    dispersion: 0.02,
    bodyColor: "#c9ed6b",
    absorption: 0.06,
  }),
  tourmaline: Object.freeze({
    id: "tourmaline",
    label: "碧玺",
    ior: 1.624,
    dispersion: 0.018,
    bodyColor: "#ffffff",
    absorption: 0,
  }),
  tanzanite: Object.freeze({
    id: "tanzanite",
    label: "坦桑石（黝帘石）",
    ior: 1.695,
    dispersion: 0.019,
    bodyColor: "#9e94ed",
    absorption: 0.07,
  }),
  opal: Object.freeze({
    id: "opal",
    label: "欧泊",
    ior: 1.45,
    dispersion: 0,
    bodyColor: "#ffffff",
    absorption: 0,
  }),
  zircon: Object.freeze({
    id: "zircon",
    label: "锆石",
    ior: 1.95,
    dispersion: 0.039,
    bodyColor: "#ffffff",
    absorption: 0,
  }),
  sphene: Object.freeze({
    id: "sphene",
    label: "榍石",
    ior: 1.95,
    dispersion: 0.051,
    bodyColor: "#ffffff",
    absorption: 0,
  }),
  yag: Object.freeze({
    id: "yag",
    label: "YAG 钇铝榴石",
    ior: 1.833,
    dispersion: 0.028,
    bodyColor: "#ffffff",
    absorption: 0,
  }),
  ggg: Object.freeze({
    id: "ggg",
    label: "GGG 钆镓榴石",
    ior: 2.02,
    dispersion: 0.038,
    bodyColor: "#ffffff",
    absorption: 0,
  }),
  crownGlass: Object.freeze({
    id: "crownGlass",
    label: "冕牌玻璃",
    ior: 1.523,
    dispersion: 0.01,
    bodyColor: "#ffffff",
    absorption: 0,
  }),
  custom: Object.freeze({
    id: "custom",
    label: "自定义材质",
    ior: 2.417,
    dispersion: 0.044,
    bodyColor: "#ffffff",
    absorption: 0,
  }),
});

export const OPTICAL_ENVIRONMENTS = Object.freeze([
  { id: "studio", label: "柔光摄影棚" },
  { id: "jewelry", label: "珠宝灯箱" },
  { id: "contrast", label: "高反差棚" },
  { id: "hearts", label: "八心八箭观察镜" },
]);

export const OPTICAL_BACKGROUNDS = Object.freeze([
  { id: "mist", label: "雾白", color: "#eff1f1" },
  { id: "paper", label: "纸白", color: "#faf9f5" },
  { id: "graphite", label: "石墨", color: "#222629" },
]);

export const DEFAULT_OPTICS_SETTINGS = Object.freeze({
  material: Object.freeze({ ...OPTICAL_PRESETS.diamond }),
  view: Object.freeze({
    environment: "studio",
    background: "mist",
    exposure: 0,
    environmentRotation: 18,
  }),
  advanced: Object.freeze({
    maxBounces: 6,
  }),
});

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, number))
    : fallback;
}

export function resolveOpticsSettings(value = {}) {
  const preset = OPTICAL_PRESETS[value?.material?.preset ?? value?.material?.id]
    ?? (Number(value?.refractiveIndex) > 1 ? OPTICAL_PRESETS.custom : OPTICAL_PRESETS.diamond);
  const material = value?.material ?? {};
  const view = value?.view ?? {};
  const advanced = value?.advanced ?? {};
  const environment = OPTICAL_ENVIRONMENTS.some((item) => item.id === view.environment)
    ? view.environment
    : DEFAULT_OPTICS_SETTINGS.view.environment;
  const background = OPTICAL_BACKGROUNDS.some((item) => item.id === view.background)
    ? view.background
    : DEFAULT_OPTICS_SETTINGS.view.background;

  return {
    material: {
      preset: preset.id,
      label: preset.label,
      ior: clamp(material.ior ?? value?.refractiveIndex, 1.001, 3.5, preset.ior),
      dispersion: clamp(material.dispersion, 0, 0.15, preset.dispersion),
      bodyColor: /^#[0-9a-f]{6}$/i.test(material.bodyColor ?? "")
        ? material.bodyColor
        : preset.bodyColor,
      absorption: clamp(material.absorption, 0, 2, preset.absorption),
    },
    view: {
      environment,
      background,
      exposure: clamp(view.exposure, -2, 2, DEFAULT_OPTICS_SETTINGS.view.exposure),
      environmentRotation: clamp(
        view.environmentRotation,
        -180,
        180,
        DEFAULT_OPTICS_SETTINGS.view.environmentRotation,
      ),
    },
    advanced: {
      maxBounces: Math.round(clamp(advanced.maxBounces, 2, 8, 6)),
    },
  };
}

export function createDocumentOpticsCommand(settings) {
  const { material, advanced } = resolveOpticsSettings(settings);
  return createUpdateOpticsCommand({ material, advanced });
}

export function applyOpticalPreset(settings, presetId) {
  const preset = OPTICAL_PRESETS[presetId] ?? OPTICAL_PRESETS.diamond;
  return resolveOpticsSettings({
    ...settings,
    material: { ...preset, preset: preset.id },
  });
}

export function criticalAngleDegrees(ior) {
  const resolved = clamp(ior, 1.001, 3.5, OPTICAL_PRESETS.diamond.ior);
  return (Math.asin(1 / resolved) * 180) / Math.PI;
}

export function backgroundColor(settings) {
  const resolved = resolveOpticsSettings(settings);
  return OPTICAL_BACKGROUNDS.find((item) => item.id === resolved.view.background)?.color
    ?? OPTICAL_BACKGROUNDS[0].color;
}
