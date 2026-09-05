import { createUpdateOpticsCommand } from "./faceting.js";

export const OPTICAL_PRESETS = Object.freeze({
  diamond: Object.freeze({
    id: "diamond",
    label: "无色钻石",
    ior: 2.417,
    dispersion: 0.044,
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
  sapphire: Object.freeze({
    id: "sapphire",
    label: "白色蓝宝石",
    ior: 1.77,
    dispersion: 0.018,
    bodyColor: "#f4f8ff",
    absorption: 0.025,
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
