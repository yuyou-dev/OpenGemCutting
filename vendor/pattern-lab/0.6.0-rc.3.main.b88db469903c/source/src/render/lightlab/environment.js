import { packLights, planckRelative } from '../../core/lightlab/lighting.js';

/** A cone containing the complete angular footprint, including rectangular corners.
 * A uniform sphere component supplies the ambient and keeps support everywhere.
 */
export function lightConeCosine(u, v, shape) {
  return shape === 0 ? 1 / Math.sqrt(1 + Math.tan(u) ** 2 + Math.tan(v) ** 2) : Math.cos(u);
}

export function packLightLabEnvironment(environment) {
  const packed = packLights(environment);
  for (let i = 0; i < packed.count; i++) {
    const at = i * 6;
    packed.data[at + 4][3] = lightConeCosine(packed.data[at + 1][3], packed.data[at + 2][3], packed.data[at + 3][3]);
  }
  return packed;
}

/** CPU counterpart of the shader's mixture density, used for transport validation. */
export function lightLabEnvironmentPdf(direction, packed) {
  if (!packed.count) return 1 / (4 * Math.PI);
  let pdf = .25 / (4 * Math.PI);
  for (let i = 0; i < packed.count; i++) {
    const axis = packed.data[i * 6], cosine = packed.data[i * 6 + 4][3];
    if (direction.reduce((sum, value, k) => sum + value * axis[k], 0) >= cosine) pdf += .75 / (packed.count * 2 * Math.PI * (1 - cosine));
  }
  return pdf;
}

// Exact CIE approximation and XYZ conversion from LightLab core/optics.js, 883b139.
export function cieXYZ(w) {
  const g = (c, a, b) => Math.exp(-.5 * ((w - c) * (w < c ? a : b)) ** 2);
  return [.362*g(442,.0624,.0374)+1.056*g(599.8,.0264,.0323)-.065*g(501.1,.049,.0382),.821*g(568.8,.0213,.0247)+.286*g(530.9,.0613,.0322),1.217*g(437,.0845,.0278)+.681*g(459,.0385,.0725)];
}
export function xyzToRGB(v) {
  return [3.2406*v[0]-1.5372*v[1]-.4986*v[2],-.9689*v[0]+1.8758*v[1]+.0415*v[2],.0557*v[0]-.204*v[1]+1.057*v[2]];
}
export const spectralWhite = xyzToRGB(Array.from({ length: 12 }, (_, k) => {
  const wavelength = 405 + k * 30;
  return cieXYZ(wavelength).map(value => value * planckRelative(wavelength, 6500));
}).reduce((sum, xyz) => sum.map((value, k) => value + xyz[k]), [0, 0, 0]));
