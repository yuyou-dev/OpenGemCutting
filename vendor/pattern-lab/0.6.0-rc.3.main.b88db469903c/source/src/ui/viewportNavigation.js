/** Shared navigation policy, independent of React, DOM and geometry.
 * Matches the main workbench's cutting viewport; provenance in docs/labs/NAVIGATION.md.
 * All distances are CSS pixels. The host owns pointer capture and frame scheduling.
 */
export const navigationVersion = '1.0.0';
export const navigationPolicy = Object.freeze({ rotate: .008, wheel: .0012, minZoom: .48, maxZoom: 2.8 });
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export function createViewportCamera({ yaw = -.72, pitch = -.52, zoom = 1, panX = 0, panY = 8 } = {}) {
  return { yaw, pitch, zoom, panX, panY, targetYaw: yaw, targetPitch: pitch, targetZoom: zoom, targetPanX: panX, targetPanY: panY, transition: null };
}
export function orbitViewport(camera, horizontal, vertical) {
  camera.transition = null;
  camera.targetYaw += horizontal;
  camera.targetPitch = clamp(camera.targetPitch - vertical, -Math.PI / 2, Math.PI / 2);
}
export function dragViewport(camera, dx, dy, pan = false) {
  camera.transition = null;
  if (pan) { camera.targetPanX += dx; camera.targetPanY += dy; }
  else orbitViewport(camera, dx * navigationPolicy.rotate, dy * navigationPolicy.rotate);
}
export function zoomViewport(camera, deltaY) {
  camera.transition = null;
  camera.targetZoom = clamp(camera.targetZoom * Math.exp(-deltaY * navigationPolicy.wheel), navigationPolicy.minZoom, navigationPolicy.maxZoom);
}
export function resetViewport(camera, pose) { Object.assign(camera, createViewportCamera(pose)); }
export function keyViewport(camera, key, shift = false, resetPose) {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', '0'].includes(key)) camera.transition = null;
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[key]) {
    const [x, y] = arrows[key];
    if (shift) dragViewport(camera, x * 14, y * 14, true);
    else orbitViewport(camera, x * .12, y * .1);
  } else if (['+', '=', '-', '_'].includes(key)) {
    const factor = key === '-' || key === '_' ? 1 / 1.12 : 1.12;
    camera.targetZoom = clamp(camera.targetZoom * factor, navigationPolicy.minZoom, navigationPolicy.maxZoom);
  } else if (key === '0' || key === 'Home') resetViewport(camera, resetPose);
  else return false;
  return true;
}
/** Same easing, settling thresholds and explicit transitions as the cutting view. */
export function advanceViewportCamera(camera, now = performance.now()) {
  let moving = false;
  const transition = camera.transition;
  if (transition) {
    const t = transition.duration > 0 ? clamp((now - transition.start) / transition.duration, 0, 1) : 1;
    const eased = t * t * (3 - 2 * t);
    camera.yaw = transition.yaw + (camera.targetYaw - transition.yaw) * eased;
    camera.pitch = transition.pitch + (camera.targetPitch - transition.pitch) * eased;
    moving = t < 1;
    if (!moving) { camera.transition = null; transition.onComplete?.(); }
  }
  for (const [key, rate, tolerance] of [['yaw', .16, 1e-6], ['pitch', .16, 1e-6], ['zoom', .16, 1e-6], ['panX', .18, 1e-3], ['panY', .18, 1e-3]]) {
    if (transition && (key === 'yaw' || key === 'pitch')) continue;
    const target = 'target' + key[0].toUpperCase() + key.slice(1), remaining = camera[target] - camera[key];
    if (Math.abs(remaining) <= tolerance) camera[key] = camera[target];
    else { camera[key] += remaining * rate; moving = true; }
  }
  return moving;
}
