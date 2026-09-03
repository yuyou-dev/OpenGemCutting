/**
 * Array-based `[x, y, z]` vector math shared by the viewport renderers.
 * The domain geometry module works on `{x, y, z}` objects; these helpers
 * serve code paths that keep vertices as plain arrays.
 */

export function addVectors(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function subtractVectors(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scaleVector(vector, amount) {
  return [vector[0] * amount, vector[1] * amount, vector[2] * amount];
}

export function crossVectors(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function vectorLength(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

/**
 * Normalize an array vector. `epsilon` treats near-zero magnitudes as
 * degenerate; `fallback` is returned for degenerate input, otherwise the
 * input is divided by `magnitude || 1` (a zero vector passes through).
 */
export function normalizeVector(vector, { epsilon = 0, fallback = null } = {}) {
  const magnitude = vectorLength(vector);
  if (magnitude > epsilon) return scaleVector(vector, 1 / magnitude);
  if (fallback) return [...fallback];
  return scaleVector(vector, 1 / (magnitude || 1));
}

export function averageVectors(points) {
  const total = points.reduce((sum, point) => addVectors(sum, point), [0, 0, 0]);
  return scaleVector(total, 1 / Math.max(points.length, 1));
}
