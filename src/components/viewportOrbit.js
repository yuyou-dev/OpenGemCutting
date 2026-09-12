import { crossVectors as cross, normalizeVector } from '../utils/vector3.js';
import { clamp } from '../utils/format.js';

// Inputs are screen directions in radians: right and down are positive.
// p5 rotates the model; the optical renderer orbits its camera. Keep their
// coordinate adapters here so pointer and keyboard navigation agree.
export function editorOrbitAfterInput({ yaw, pitch }, horizontal, vertical) {
  return {
    yaw: yaw + horizontal,
    pitch: clamp(pitch - vertical, -Math.PI / 2, Math.PI / 2),
  };
}

export function opticsOrbitAfterInput({ yaw, elevation }, horizontal, vertical) {
  // Optical navigation can cross a pole. Its horizontal orbit then reverses
  // relative to screen right; compensate without restricting vertical motion.
  const facing = Math.cos(elevation) < 0 ? -1 : 1;
  return {
    yaw: yaw - horizontal * facing,
    elevation: elevation + vertical,
  };
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

