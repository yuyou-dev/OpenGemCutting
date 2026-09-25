import { crossVectors as cross, normalizeVector } from '../utils/vector3.js';
import { createViewportCamera, orbitViewport } from './viewportNavigation.js';

// Inputs are screen directions in radians: right and down are positive.
// p5 rotates the model; the optical renderer orbits its camera. Keep their
// coordinate adapters here so pointer and keyboard navigation agree.
export function editorOrbitAfterInput({ yaw, pitch }, horizontal, vertical) {
  const camera = createViewportCamera({ yaw, pitch });
  orbitViewport(camera, horizontal, vertical);
  return { yaw: camera.targetYaw, pitch: camera.targetPitch };
}

// Coordinate adapters only: the common controller uses the cutting view axes.
export function opticsOrbitAfterInput({ yaw, elevation }, horizontal, vertical) {
  const next = editorOrbitAfterInput({ yaw: -yaw, pitch: -elevation }, horizontal, vertical);
  return { yaw: -next.yaw, elevation: -next.pitch };
}
export function opticsCameraFromViewport(camera, height) {
  return { yaw: -camera.yaw, elevation: -camera.pitch, zoom: camera.zoom,
    panX: 2 * camera.panX / Math.max(height, 1), panY: -2 * camera.panY / Math.max(height, 1) };
}

export function opticsCameraFrame(camera) {
  const orbit = camera;
  const horizontal = Math.cos(orbit.elevation);
  const position = [
    Math.sin(orbit.yaw) * horizontal * 4.4,
    -Math.cos(orbit.yaw) * horizontal * 4.4,
    Math.sin(orbit.elevation) * 4.4,
  ];
  const forward = normalizeVector(position.map((item) => -item));
  const right = [Math.cos(orbit.yaw), Math.sin(orbit.yaw), 0];
  const up = normalizeVector(cross(right, forward));
  return { position, forward, right, up };
}

