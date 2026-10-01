// Host rendering controls shared by validation and the comparison UI.
export const RENDER_CHOICES = { resolution: [128, 256, 384, 512, 768], targetSamples: [32, 64, 128, 256, 512, 1024, 2048], maxBounces: [16, 32, 64], toneMapping: ['aces', 'reinhard', 'linear'], spectral: ['mono', 'rgb', 'spectral'] };
export const RENDER_RANGES = { exposure: [-4, 4], headAngle: [0, 30] };
export const INITIAL_RENDER = { resolution: 384, targetSamples: 128, maxBounces: 32, exposure: 0, toneMapping: 'aces', background: '#eceeef', spectral: 'rgb', headEnabled: false, headAngle: 10, showEdges: false, nee: true, denoise: true };

export function renderSettings(current, patch) {
  const next = { ...current };
  for (const key of ['headEnabled', 'showEdges', 'nee', 'denoise']) if (typeof patch[key] === 'boolean') next[key] = patch[key];
  for (const [key, values] of Object.entries(RENDER_CHOICES)) if (values.includes(patch[key])) next[key] = patch[key];
  for (const [key, [min, max]] of Object.entries(RENDER_RANGES)) if (Number.isFinite(patch[key])) next[key] = Math.max(min, Math.min(max, patch[key]));
  if (/^#[0-9a-f]{6}$/i.test(patch.background)) next.background = patch.background;
  return next;
}

