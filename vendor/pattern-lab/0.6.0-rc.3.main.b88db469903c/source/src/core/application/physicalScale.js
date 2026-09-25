/** Axis-aligned dimensions in the laboratory's common cutting frame.
 * Calibration changes mm/model-unit, never the imported plane coordinates. */
export function physicalDimensions(compiled) {
  const points = compiled.faces.flatMap(face => face.points);
  const units = [0, 1, 2].map(axis => Math.max(...points.map(p => p[axis])) - Math.min(...points.map(p => p[axis])));
  const mm = compiled.audit.mmPerUnit;
  return { units, millimetres: mm === null ? null : units.map(value => value * mm) };
}
export function scaleForWidth(compiled, widthMm) {
  const width = Number(widthMm);
  if (!Number.isFinite(width) || width <= 0) throw new Error('请输入测量得到的正数宽度（毫米）。');
  return width / physicalDimensions(compiled).units[0];
}
