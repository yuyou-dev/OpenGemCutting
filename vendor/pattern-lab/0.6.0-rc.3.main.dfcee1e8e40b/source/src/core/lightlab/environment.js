import { clamp } from './math.js';
import { OBSERVATION_KINDS, observationDefaults } from './observation.js';
import { createLight, environmentPreset, LIGHT_PRESETS, OBSERVATION_PRESETS } from './presets.js';

export const MAX_LIGHTS = 24;
export const LIGHT_NUMERIC_RANGES = {
  azimuth: [-360, 360], elevation: [-90, 90], width: [.5, 150], height: [.5, 150],
  roll: [-180, 180], ev: [-6, 8], temperature: [1800, 12000],
  softness: [0, .4], innerRatio: [.1, .95],
};
export const ENVIRONMENT_NUMERIC_RANGES = { ambient: [0, 2], lower: [0, 2], rotation: [-180, 180] };
export const OBSERVATION_NUMERIC_RANGES = { aperture: [5, 60], minAngle: [0, 30], backlight: [0, 1] };

function readNumbers(target, input, ranges) {
  for (const [key, range] of Object.entries(ranges)) {
    if (input[key] === undefined) continue;
    if (!Number.isFinite(input[key])) throw new Error(`布光字段 ${key} 不是有限数值。`);
    target[key] = clamp(input[key], ...range);
  }
}

function readText(target, input, keys) {
  for (const key of keys) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string') throw new Error(`布光字段 ${key} 需要文字。`);
    target[key] = key === 'id' ? input[key] : input[key].slice(0, 80);
  }
}

/** Standalone version of LightLab's environment contract; no gem/session defaults. */
export function validateEnvironment(input) {
  if (!Array.isArray(input?.lights) || input.lights.length > MAX_LIGHTS) {
    throw new Error('布光需要有效光源列表，最多 24 盏。');
  }
  const environment = environmentPreset('studio');
  readNumbers(environment, input, ENVIRONMENT_NUMERIC_RANGES);
  readText(environment, input, ['preset', 'projectId', 'projectName']);
  const ids = new Set();
  environment.lights = input.lights.map((light, index) => {
    if (!light || typeof light !== 'object' || Array.isArray(light)) throw new Error('光源配置无效。');
    const clean = createLight({ id: `light-${index}`, name: `光源 ${index + 1}`, azimuth: 0, width: 30, height: 50 });
    readNumbers(clean, light, LIGHT_NUMERIC_RANGES);
    readText(clean, light, ['id', 'name', 'shape', 'tint']);
    for (const key of ['enabled', 'blocker']) {
      if (light[key] === undefined) continue;
      if (typeof light[key] !== 'boolean') throw new Error(`光源字段 ${key} 需要布尔值。`);
      clean[key] = light[key];
    }
    if (!['rect', 'disc', 'ring'].includes(clean.shape) || !/^#[0-9a-f]{6}$/i.test(clean.tint)) {
      throw new Error('光源形状或颜色无效。');
    }
    if (!/^[\w-]{1,80}$/.test(clean.id) || ids.has(clean.id)) throw new Error('光源 ID 无效或重复。');
    ids.add(clean.id);
    return clean;
  });

  const profile = input.observation ?? {};
  if (typeof profile !== 'object' || Array.isArray(profile)) throw new Error('观察环境配置无效。');
  const kind = profile.kind ?? 'none';
  if (!OBSERVATION_KINDS.includes(kind)) throw new Error('未知观察环境。');
  environment.observation = observationDefaults(kind);
  readNumbers(environment.observation, profile, OBSERVATION_NUMERIC_RANGES);
  if (kind === 'hearts' && environment.observation.minAngle >= environment.observation.aperture) {
    throw new Error('白光内角必须小于外角。');
  }
  if (!input.projectId) {
    environment.projectId = input.preset ?? 'custom';
    environment.projectName = [...LIGHT_PRESETS, ...OBSERVATION_PRESETS].find(p => p.id === environment.projectId)?.label ?? '导入的布光';
  }
  environment.solo = ids.has(input.solo) ? input.solo : null;
  return environment;
}
