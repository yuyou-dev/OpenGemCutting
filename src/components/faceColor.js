/** Coplanar Boolean patches share a normal and therefore one monochrome fill.
 * No centroid/height thresholds: triangulation must never split a face's color. */
export function faceColor(face, renderMode, highlightOperationId, activeOperationId, previewOperationId) {
  const facing = Math.abs(face.normal[2]);
  const alpha = renderMode === 'xray' ? 112 : 255;
  if (activeOperationId && face.operationId === activeOperationId)
    return [249 + facing * 3, 168 + facing * 16, 198 + facing * 12, renderMode === 'xray' ? 155 : 255];
  if (previewOperationId && face.operationId === previewOperationId)
    return [148 + facing * 12, 203 + facing * 12, 240 + facing * 8, renderMode === 'xray' ? 150 : 255];
  if (highlightOperationId && face.operationId === highlightOperationId)
    return [237 + facing * 8, 34 + facing * 12, 93 + facing * 20, renderMode === 'xray' ? 150 : 255];
  const light = Math.max(0, face.normal[0] * .3 - face.normal[1] * .4 + face.normal[2] * .866);
  const shade = 222 + 28 * light;
  return [shade, shade, shade, alpha];
}
