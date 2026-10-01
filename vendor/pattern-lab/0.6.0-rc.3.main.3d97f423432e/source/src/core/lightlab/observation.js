import { dot, rad } from './math.js';

// Axisymmetric reference viewers. Angles are from the viewing axis, not horizon.
export const OBSERVATION_KINDS = ['none', 'hearts', 'aset', 'idealscope'];
export const OBSERVATION_LABELS = {none:'摄影布光',hearts:'八心八箭观察镜',aset:'ASET 角域参考',idealscope:'红白漏光观察'};
export const observationDefaults = (kind='none') => ({kind,aperture:kind==='hearts'?16.3:10,minAngle:kind==='hearts'?5.3:0,backlight:1});
export function observationRGB(profile, direction, axis) {
  const z = dot(direction, axis);
  if (profile.kind === 'hearts') {
    if(z>Math.cos(rad(profile.minAngle)))return [0,0,0];
    if(z>Math.cos(rad(profile.aperture)))return [1,1,1];
    return [1,.01,.025].map(v=>v*profile.backlight);
  }
  if (z < 0) return [1,1,1].map(v => v * profile.backlight);
  if (profile.kind === 'aset') {
    if (z > Math.cos(rad(15))) return [0.02,0.05,1];
    if (z > Math.cos(rad(45))) return [1,0.01,0.025];
    return [0.015,0.8,0.04];
  }
  const axial = z > Math.cos(rad(profile.aperture));
  if (axial) return [0,0,0];
  return [1,0.01,0.025];
}
