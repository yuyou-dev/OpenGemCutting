// Adapted from gemcut-core experimental kernel (MIT); see LICENSE.
class PolyhedronError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "PolyhedronError";
  }
}
const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
function polyhedronTolerance(vertices) {
  if (vertices.length === 0) return 1e-10;
  let loX = Infinity, loY = Infinity, loZ = Infinity;
  let hiX = -Infinity, hiY = -Infinity, hiZ = -Infinity;
  for (const p of vertices) {
    loX = Math.min(loX, p.x);
    loY = Math.min(loY, p.y);
    loZ = Math.min(loZ, p.z);
    hiX = Math.max(hiX, p.x);
    hiY = Math.max(hiY, p.y);
    hiZ = Math.max(hiZ, p.z);
  }
  const extent = Math.max(hiX - loX, hiY - loY, hiZ - loZ);
  const magnitude = Math.max(Math.abs(loX), Math.abs(loY), Math.abs(loZ), Math.abs(hiX), Math.abs(hiY), Math.abs(hiZ));
  return Math.max(extent * 1e-10, magnitude * Number.EPSILON * 16, Number.MIN_VALUE);
}
export {
  PolyhedronError,
  edgeKey,
  polyhedronTolerance
};
