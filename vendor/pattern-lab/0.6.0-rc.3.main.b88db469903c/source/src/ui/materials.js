/** Gemstone material presets and the dispersion/absorption wavelength model.
 * Pure DOM-free module (node-testable). Values follow the LightLab preset list;
 * body colors are creative presets, NOT measured absorption spectra.
 * Material state is preview-only: never in plan JSON, history or localStorage. */

const rows = [
  ['diamond', '无色钻石', 2.417, 0.044, '#ffffff', 0],
  ['cubicZirconia', '立方氧化锆', 2.17, 0.06, '#ffffff', 0],
  ['moissanite', '无色莫桑石', 2.65, 0.104, '#fbffff', 0.02],
  ['ruby', '红宝石（刚玉）', 1.766, 0.018, '#ff599e', 0.08],
  ['blueSapphire', '蓝色蓝宝石（刚玉）', 1.766, 0.018, '#5987f2', 0.08],
  ['sapphire', '白色蓝宝石', 1.77, 0.018, '#f4f8ff', 0.025],
  ['quartz', '石英（水晶）', 1.544, 0.013, '#ffffff', 0],
  ['amethyst', '紫水晶', 1.544, 0.013, '#c994e6', 0.06],
  ['citrine', '黄水晶', 1.544, 0.013, '#ffe07a', 0.06],
  ['spinel', '尖晶石', 1.718, 0.02, '#ffffff', 0],
  ['topaz', '托帕石', 1.62, 0.014, '#ffffff', 0],
  ['garnet', '铁铝榴石', 1.79, 0.027, '#e1596b', 0.08],
  ['demantoid', '翠榴石', 1.888, 0.057, '#94ed87', 0.06],
  ['emerald', '祖母绿（绿柱石）', 1.577, 0.014, '#59e69e', 0.08],
  ['aquamarine', '海蓝宝石（绿柱石）', 1.577, 0.014, '#b0edf2', 0.05],
  ['peridot', '橄榄石', 1.654, 0.02, '#c9ed6b', 0.06],
  ['tourmaline', '碧玺', 1.624, 0.018, '#ffffff', 0],
  ['tanzanite', '坦桑石（黝帘石）', 1.695, 0.019, '#9e94ed', 0.07],
  ['opal', '欧泊 · 均匀透明近似', 1.45, 0, '#ffffff', 0],
  ['zircon', '锆石', 1.95, 0.039, '#ffffff', 0],
  ['sphene', '榍石', 1.95, 0.051, '#ffffff', 0],
  ['yag', 'YAG 钇铝榴石', 1.833, 0.028, '#ffffff', 0],
  ['ggg', 'GGG 钆镓榴石', 2.02, 0.038, '#ffffff', 0],
  ['crownGlass', '冕牌玻璃', 1.523, 0.01, '#ffffff', 0],
  ['custom', '自定义材质', 2.417, 0.044, '#ffffff', 0],
];

export const MATERIAL_CUSTOM = 'custom';

export const MATERIALS = rows.map(([preset, label, ior, dispersion, bodyColor, absorption]) => ({
  preset,
  label,
  ior,
  dispersion,
  bodyColor,
  absorption,
  referenceMm: 8,
}));

/** Copy of the named preset; unknown ids fall back to amethyst. */
export function materialPreset(id) {
  return { ...(MATERIALS.find((m) => m.preset === id) ?? MATERIALS.find((m) => m.preset === 'amethyst')) };
}

/** sRGB 0–1 channel → linear-light (IEC 61966-2-1). */
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Beer–Lambert extinction per RGB channel (mm⁻¹): the body color is the
 * transmittance after `referenceMm`, so σ_c = (−log(max(lin_c, .0001)) + τ) / referenceMm. */
export function absorptionRGB(material) {
  if (material.sigmaOverride) return [...material.sigmaOverride];
  const hex = material.bodyColor.replace('#', '');
  const reference = material.referenceMm ?? 8;
  return [0, 1, 2].map((i) => {
    const linear = srgbToLinear(parseInt(hex.slice(i * 2, i * 2 + 2), 16) / 255);
    return (-Math.log(Math.max(linear, 0.0001)) + material.absorption) / reference;
  });
}

/** Piecewise-linear extinction at wavelength nm, anchored σR@610 / σG@550 / σB@460. */
export function sigmaAt(sigmaRGB, nm) {
  const [r, g, b] = sigmaRGB;
  if (nm <= 460) return b;
  if (nm < 550) return b + (g - b) * ((nm - 460) / 90);
  if (nm < 610) return g + (r - g) * ((nm - 550) / 60);
  return r;
}

/** Cauchy two-coefficient fit through n_D (589.3 nm) and gemological Δn_BG
 * (n(430.8) − n(686.7); NOT n_F − n_C). */
export function indexAtWavelength(ior, dispersion, nm) {
  const b = dispersion / (1 / 0.4308 ** 2 - 1 / 0.6867 ** 2);
  const l = nm / 1000;
  return ior + b * (1 / (l * l) - 1 / 0.5893 ** 2);
}

/** Returns a new material with `patch` applied; any physical-parameter change
 * flips the preset to custom so the select reflects the edited state. */
export function withCustomFlip(material, patch) {
  const next = { ...material, ...patch };
  if (['bodyColor', 'absorption', 'referenceMm'].some(key => key in patch)) delete next.sigmaOverride;
  const physical = ['ior', 'dispersion', 'bodyColor', 'absorption', 'referenceMm'];
  if (physical.some((k) => k in patch && patch[k] !== material[k])) next.preset = MATERIAL_CUSTOM;
  return next;
}
