import { rad, deg, clamp } from '../core/lightlab/math.js';

export const DOME_GEOMETRY = { width: 252, height: 247, cx: 126, cy: 123, radius: 92 };

export function domePoint(light, rotation = 0) {
  const { cx, cy, radius } = DOME_GEOMETRY;
  const angle = rad(light.azimuth + rotation - 90);
  const rho = (90 - Math.abs(light.elevation)) / 90 * radius;
  return { x: cx + Math.cos(angle) * rho, y: cy + Math.sin(angle) * rho };
}

/** SVG coordinates to local lamp angles; environment rotation stays independent. */
export function domeAngles(x, y, rotation = 0, hemisphere = 'upper') {
  const { cx, cy, radius } = DOME_GEOMETRY;
  const dx = x - cx, dy = y - cy;
  const azimuth = Math.round(((deg(Math.atan2(dy, dx)) + 90 - rotation + 720) % 360) * 10) / 10;
  const elevation = Math.round(clamp(90 - Math.hypot(dx, dy) / radius * 90, 0, 90) * 10) / 10;
  return { azimuth: azimuth % 360, elevation: hemisphere === 'lower' ? -elevation : elevation };
}

export function domeMarks(environment, selectedLight, hemisphere = 'upper') {
  const { radius } = DOME_GEOMETRY;
  return environment.lights.flatMap((light, index) => {
    if ((light.elevation < 0) !== (hemisphere === 'lower')) return [];
    return [{
      id: light.id, index, name: light.name,
      ...domePoint(light, environment.rotation),
      rx: Math.max(5, light.width / 180 * radius),
      ry: Math.max(5, (light.shape === 'rect' ? light.height : light.width) / 180 * radius),
      rotation: light.azimuth + light.roll, selected: light.id === selectedLight,
      enabled: light.enabled, blocker: light.blocker,
    }];
  });
}
