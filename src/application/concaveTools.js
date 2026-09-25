import { normalizeConcaveCuts } from '../domain/concaveCuts.js';
import { getCuttingReference } from '../domain/faceting.js';

export const CONCAVE_PRESETS = Object.freeze([
  { id: 'bowl', label: '球形凹坑', type: 'sphere', radiusRatio: .175 },
  { id: 'flute', label: '圆弧槽', type: 'cylinder', radiusRatio: .175 },
  { id: 'v-groove', label: 'V 形尖槽', type: 'v-wheel', radiusRatio: .35 },
  { id: 'triangle-groove', label: '三角柱尖槽', type: 'triangular-prism', radiusRatio: .175 },
  { id: 'fine-flute', label: '细槽', type: 'cylinder', radiusRatio: .09 },
]);

// Depth is measured from the fixed machine envelope, never the current result.
function cuttingEnvelope(document) {
  const stock = getCuttingReference(document);
  return { radius: stock.kind === 'mesh' ? stock.envelope.radius : stock.size / 2,
    minZ: stock.center[2] - (stock.envelope?.halfHeight ?? stock.size / 2),
    maxZ: stock.center[2] + (stock.envelope?.halfHeight ?? stock.size / 2) };
}
function radialPosition(document, cut) {
  const [x, y] = cut.position.map((v, i) => v - getCuttingReference(document).center[i]);
  const distance = Math.hypot(x, y);
  return { distance, direction: distance ? [x / distance, y / distance] : [1, 0] };
}
export function concaveToolDepth(document, cut) {
  return cuttingEnvelope(document).radius + cut.radius - radialPosition(document, cut).distance;
}

/** Presets and edits share the same persisted cutter model as imported tools.
 * Editing changes only repetition, phase and radial depth; custom axes/size/Z survive. */
export function updateConcaveTool(document, { toolId, preset, repeat, toolDepth, phaseDeg, width, tipAngle, length }) {
  const cuts = document.concaveCuts ?? [];
  let cut = cuts.find(item => item.id === toolId);
  if (!cut) {
    const choice = CONCAVE_PRESETS.find(item => item.id === preset);
    if (!choice) throw new RangeError('请选择凹切刀具。');
    const envelope = cuttingEnvelope(document);
    const radius = getCuttingReference(document).size * choice.radiusRatio;
    cut = { id: toolId, label: choice.label, type: choice.type, enabled: true,
      radius, ...(choice.type === 'triangular-prism' ? { width: radius * 4, tipAngle: 90 } : {}), length: choice.type === 'v-wheel' ? 2 * radius : envelope.maxZ - envelope.minZ + 2 * radius,
      position: [getCuttingReference(document).center[0] + envelope.radius + radius, getCuttingReference(document).center[1], (envelope.minZ + envelope.maxZ) / 2],
      axis: choice.type === 'v-wheel' ? [0, 1, 0] : [0, 0, 1], repeat: 5, phaseDeg: 0, segments: 24 };
    toolDepth ??= envelope.radius * .2 + radius * .4;
  }
  if ([width, tipAngle, length].some(value => value !== undefined)) {
    if (cut.type !== 'triangular-prism') throw new RangeError('尖角、宽度与长度调整只适用于三角柱刀具。');
    toolDepth ??= concaveToolDepth(document, cut);
    [cut] = normalizeConcaveCuts([{ ...cut, ...(width === undefined ? {} : { width }), ...(tipAngle === undefined ? {} : { tipAngle }), ...(length === undefined ? {} : { length }) }]);
  }
  if (phaseDeg !== undefined) cut = { ...cut, phaseDeg };
  if (repeat !== undefined) cut = { ...cut, repeat };
  if (toolDepth !== undefined) {
    if (!Number.isFinite(toolDepth)) throw new TypeError('切割深度必须是有限数值。');
    const { direction } = radialPosition(document, cut);
    const radius = cuttingEnvelope(document, direction).radius + cut.radius - toolDepth;
    if (radius < 0) throw new RangeError('刀具中心不能越过旋转轴。');
    cut = { ...cut, position: [getCuttingReference(document).center[0] + direction[0] * radius, getCuttingReference(document).center[1] + direction[1] * radius, cut.position[2]] };
  }
  return normalizeConcaveCuts(cuts.some(item => item.id === toolId)
    ? cuts.map(item => item.id === toolId ? cut : item) : [...cuts, cut]);
}
