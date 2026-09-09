const vec3 = (x, y, z) => ({ x, y, z });
const add = (a, b) => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
const scale = (a, s) => vec3(a.x * s, a.y * s, a.z * s);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const length = (a) => Math.sqrt(dot(a, a));
const normalize = (a) => {
  const len = length(a);
  return len === 0 ? vec3(0, 0, 0) : scale(a, 1 / len);
};
const negate = (a) => vec3(-a.x, -a.y, -a.z);
const distance = (a, b) => length(sub(a, b));
const lerp = (a, b, t) => vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
const near = (a, b, eps) => distance(a, b) <= eps;
export {
  add,
  cross,
  distance,
  dot,
  length,
  lerp,
  near,
  negate,
  normalize,
  scale,
  sub,
  vec3
};
