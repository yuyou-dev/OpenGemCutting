/** Independent, immutable subtractive-tool parameters in fixed machine coordinates. */
export const CONCAVE_TOOL_TYPES = Object.freeze(['sphere', 'cylinder', 'v-wheel', 'triangular-prism']);
export const CONCAVE_TOOL_DEFAULTS = Object.freeze({
  type: 'sphere', enabled: true, radius: 0.35, length: 2,
  position: Object.freeze([0.9, 0, 0]), axis: Object.freeze([0, 0, 1]),
  repeat: 1, phaseDeg: 0, segments: 24,
});
export const CONCAVE_CUT_LIMITS = Object.freeze({ operations: 64, repeat: 120, minSegments: 12, maxSegments: 64, generatedPatches: 60000 });
const normalized = new WeakSet();

function vector(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new TypeError(`${label} must contain three finite coordinates.`);
  }
  return [...value];
}

function positive(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive and finite.`);
  return value;
}

/** No timestamps, generated mesh or planar CUT state belong in this parameter group. */
export function normalizeConcaveCuts(cuts = []) {
  if (!Array.isArray(cuts)) throw new TypeError('concaveCuts must be an array.');
  if (normalized.has(cuts)) return cuts;
  if (cuts.length > CONCAVE_CUT_LIMITS.operations) throw new RangeError(`At most ${CONCAVE_CUT_LIMITS.operations} concave operations are supported.`);
  const ids = new Set();
  let generatedPatches = 0;
  const result = cuts.map((input, index) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError(`concaveCuts[${index}] must be an object.`);
    const value = { ...CONCAVE_TOOL_DEFAULTS, ...input };
    if (typeof value.id !== 'string' || !value.id.trim() || ids.has(value.id) || ['rough-cube', 'rough-mesh'].includes(value.id)) throw new TypeError('Every concave operation requires a unique nonempty, non-reserved id.');
    ids.add(value.id);
    if (!CONCAVE_TOOL_TYPES.includes(value.type)) throw new RangeError('Concave tool type must be sphere, cylinder, v-wheel or triangular-prism.');
    if (typeof value.enabled !== 'boolean') throw new TypeError('Concave tool enabled must be boolean.');
    if (!Number.isInteger(value.repeat) || value.repeat < 1 || value.repeat > CONCAVE_CUT_LIMITS.repeat) throw new RangeError(`Concave repeat must be an integer from 1 to ${CONCAVE_CUT_LIMITS.repeat}.`);
    if (!Number.isInteger(value.segments) || value.segments < CONCAVE_CUT_LIMITS.minSegments || value.segments > CONCAVE_CUT_LIMITS.maxSegments || value.segments % 4) throw new RangeError('Concave segments must be a multiple of 4 from 12 to 64.');
    if (!Number.isFinite(value.phaseDeg)) throw new TypeError('Concave phaseDeg must be finite.');
    const position = vector(value.position, 'Concave tool position');
    const axis = vector(value.axis, 'Concave tool axis');
    const axisScale = Math.max(...axis.map(Math.abs));
    if (!axisScale) throw new RangeError('Concave tool axis must have nonzero length.');
    const scaledAxis = axis.map(v => v / axisScale);
    const magnitude = Math.hypot(...scaledAxis);
    const width = value.type === 'triangular-prism' ? positive(value.width ?? .7, 'Triangular cutter width') : undefined;
    const tipAngle = value.type === 'triangular-prism' ? value.tipAngle ?? 90 : undefined;
    if (tipAngle !== undefined && (!Number.isFinite(tipAngle) || tipAngle <= 0 || tipAngle >= 180)) throw new RangeError('Triangular cutter tip angle must be between 0 and 180 degrees.');
    if (value.enabled) generatedPatches += value.repeat * (value.type === 'triangular-prism' ? 5 : value.type === 'sphere' ? value.segments ** 2 / 2 : value.type === 'v-wheel' ? value.segments * 2 : value.segments + 2);
    return Object.freeze({
      id: value.id, type: value.type, enabled: value.enabled,
      ...(input.label === undefined ? {} : { label: String(input.label) }),
      position: Object.freeze(position), axis: Object.freeze(scaledAxis.map(v => v / magnitude)),
      radius: positive(width === undefined ? value.radius : width / (4 * Math.tan(tipAngle * Math.PI / 360)), 'Concave tool radius'),
      ...(width === undefined ? {} : { width, tipAngle }),
      length: positive(value.length, 'Concave tool length'),
      repeat: value.repeat, phaseDeg: ((value.phaseDeg % 360) + 360) % 360, segments: value.segments,
    });
  });
  if (generatedPatches > CONCAVE_CUT_LIMITS.generatedPatches) throw new RangeError('Concave tool resolution and repeat count exceed the geometric processing budget.');
  Object.freeze(result);
  normalized.add(result);
  return result;
}

/** Rotate each tool center and cylinder axis about the stock's machine Z axis. */
export function expandConcaveCuts(cuts, center = [0, 0, 0]) {
  const origin = vector(center, 'Machine center');
  return normalizeConcaveCuts(cuts).filter(cut => cut.enabled).flatMap(cut => Array.from({ length: cut.repeat }, (_, repeatIndex) => {
    const radians = (cut.phaseDeg + 360 * repeatIndex / cut.repeat) * Math.PI / 180;
    const c = Math.cos(radians), s = Math.sin(radians);
    const rotate = ([x, y, z]) => [c * x - s * y, s * x + c * y, z];
    return {
      ...cut, instanceId: `${cut.id}:${repeatIndex}`, repeatIndex,
      position: rotate(cut.position.map((v, i) => v - origin[i])).map((v, i) => v + origin[i]),
      axis: rotate(cut.axis),
    };
  }));
}
