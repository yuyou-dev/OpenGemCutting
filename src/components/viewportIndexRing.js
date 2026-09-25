import { INDEX_TEETH, generateFacetIndices, generateMirrorAxes, normalizeIndex } from "../domain/faceting.js";
import { normalizeIndexTeeth } from "../domain/indexing.js";

/** Ring geometry uses authoring teeth; smooth drawing samples are not snap targets. */
export function ringPoint(center, radius, tooth, indexTeeth = INDEX_TEETH) {
  const angle = tooth * Math.PI * 2 / indexTeeth;
  return [
    center[0] + Math.cos(angle) * radius,
    center[1] + Math.sin(angle) * radius,
    center[2],
  ];
}

export function indexRingLayout({ indexTeeth = INDEX_TEETH, baseIndex = 0, repeat = 1, mirror = 0 } = {}) {
  const teeth = normalizeIndexTeeth(indexTeeth);
  const base = normalizeIndex(baseIndex, teeth);
  const count = Math.min(360, Math.max(1, Math.round(repeat)));
  const offset = Math.min(teeth / 2, Math.max(0, mirror));
  return {
    indexTeeth: teeth,
    sampleCount: Math.max(96, teeth),
    baseIndex: base,
    repeat: count,
    mirror: offset,
    rotationIndices: generateFacetIndices({ baseIndex: base, repeat: count, indexTeeth: teeth }),
    mirroredIndices: generateFacetIndices({ baseIndex: base + offset * 2, repeat: count, indexTeeth: teeth }),
    axes: generateMirrorAxes({ baseIndex: base, repeat: count, mirror: offset, indexTeeth: teeth }),
    // Odd wheels have a fractional half-turn endpoint; keep that endpoint exact.
    mirrorOffsets: Array.from({ length: Math.ceil(teeth / 2) + 1 }, (_, ordinal) => Math.min(ordinal, teeth / 2)),
  };
}
