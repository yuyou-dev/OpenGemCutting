import { millimetersPerModelUnit } from "./labsContract/validation.js";

// Real-world size of a solid when its document carries a physical scale
// (`metadata.physicalScale.millimetersPerModelUnit`, see docs/labs/CONTRACT.md).
// Returns null without a scale: millimetres are never guessed.
export function physicalMeasures(document, { vertices, volume }) {
  const mm = millimetersPerModelUnit(document);
  if (!mm || !vertices?.length) return null;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const vertex of vertices) {
    for (const axis of ["x", "y", "z"]) {
      min[axis] = Math.min(min[axis], vertex[axis]);
      max[axis] = Math.max(max[axis], vertex[axis]);
    }
  }
  return {
    millimetersPerModelUnit: mm,
    size: { x: (max.x - min.x) * mm, y: (max.y - min.y) * mm, z: (max.z - min.z) * mm },
    volume: volume * mm ** 3,
  };
}
