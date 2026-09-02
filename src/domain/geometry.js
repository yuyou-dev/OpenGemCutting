/**
 * Convex-polyhedron geometry for the faceting workbench.
 *
 * A clipping plane keeps the half-space `dot(normal, point) <= d`. Plane
 * normals may be objects or `[x, y, z]` arrays; `offset` and `constant` are
 * accepted as aliases for `d` so operation records can be passed directly.
 */

const DEFAULT_GEOMETRY_TOLERANCE = 1e-9;

function vector3(value, label = "vector") {
  const x = Array.isArray(value) ? value[0] : value?.x;
  const y = Array.isArray(value) ? value[1] : value?.y;
  const z = Array.isArray(value) ? value[2] : value?.z;

  if (![x, y, z].every(Number.isFinite)) {
    throw new TypeError(`${label} must contain three finite coordinates`);
  }

  return { x, y, z };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(vector, scalar) {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function length(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function distance(a, b) {
  return length(subtract(a, b));
}

function normalize(vector, label = "normal") {
  const magnitude = length(vector);
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new RangeError(`${label} must have non-zero length`);
  }
  return scale(vector, 1 / magnitude);
}

function averagePoints(points) {
  if (points.length === 0) return { x: 0, y: 0, z: 0 };
  const total = points.reduce((sum, point) => add(sum, point), {
    x: 0,
    y: 0,
    z: 0,
  });
  return scale(total, 1 / points.length);
}

function geometryExtent(polyhedron) {
  if (polyhedron.vertices.length === 0) return 0;

  const first = polyhedron.vertices[0];
  let minX = first.x;
  let minY = first.y;
  let minZ = first.z;
  let maxX = first.x;
  let maxY = first.y;
  let maxZ = first.z;

  for (const point of polyhedron.vertices.slice(1)) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    minZ = Math.min(minZ, point.z);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
    maxZ = Math.max(maxZ, point.z);
  }

  return Math.max(maxX - minX, maxY - minY, maxZ - minZ);
}

function coordinateMagnitude(polyhedron) {
  return polyhedron.vertices.reduce(
    (maximum, point) => Math.max(maximum, Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)),
    0,
  );
}

function resolveTolerance(polyhedron, requestedTolerance) {
  const floatingPointFloor = Number.EPSILON * Math.max(1, coordinateMagnitude(polyhedron)) * 8;
  if (requestedTolerance !== undefined) {
    if (!Number.isFinite(requestedTolerance) || requestedTolerance <= 0) {
      throw new RangeError("tolerance must be a positive finite number");
    }
    return Math.max(requestedTolerance, floatingPointFloor);
  }

  return Math.max(
    DEFAULT_GEOMETRY_TOLERANCE * Math.max(1, geometryExtent(polyhedron)),
    floatingPointFloor,
  );
}

function normalizedPlane(input) {
  const plane = input?.plane ?? input;
  if (!plane || typeof plane !== "object") {
    throw new TypeError("plane must be an object");
  }
  if (plane.keep && plane.keep !== "less-than-or-equal") {
    throw new RangeError("only the <= half-space is supported");
  }

  const rawNormal = vector3(plane.normal ?? plane.n, "plane normal");
  const normalLength = length(rawNormal);
  if (normalLength === 0) {
    throw new RangeError("plane normal must have non-zero length");
  }

  const rawDistance = plane.d ?? plane.offset ?? plane.constant;
  if (!Number.isFinite(rawDistance)) {
    throw new TypeError("plane d (or offset/constant) must be finite");
  }

  return {
    normal: scale(rawNormal, 1 / normalLength),
    d: rawDistance / normalLength,
    descriptor: plane,
    record: input,
  };
}

function polygonAreaVector(points) {
  if (points.length === 0) return { x: 0, y: 0, z: 0 };
  const origin = points[0];
  let total = { x: 0, y: 0, z: 0 };
  for (let index = 0; index < points.length; index += 1) {
    total = add(total, cross(
      subtract(points[index], origin),
      subtract(points[(index + 1) % points.length], origin),
    ));
  }
  return total;
}

function polygonNormal(points) {
  const areaVector = polygonAreaVector(points);
  const magnitude = length(areaVector);
  return magnitude === 0 ? null : scale(areaVector, 1 / magnitude);
}

function dedupeConsecutive(points, tolerance) {
  const result = [];
  for (const point of points) {
    if (result.length === 0 || distance(point, result[result.length - 1]) > tolerance) {
      result.push(point);
    }
  }
  if (result.length > 1 && distance(result[0], result[result.length - 1]) <= tolerance) {
    result.pop();
  }
  return result;
}

function simplifyPolygon(inputPoints, tolerance) {
  let points = dedupeConsecutive(inputPoints, tolerance);
  let changed = true;

  while (changed && points.length >= 3) {
    changed = false;
    const kept = [];

    for (let index = 0; index < points.length; index += 1) {
      const previous = points[(index - 1 + points.length) % points.length];
      const current = points[index];
      const next = points[(index + 1) % points.length];
      const chord = subtract(next, previous);
      const chordLength = length(chord);

      if (chordLength <= tolerance) {
        changed = true;
        continue;
      }

      const distanceFromChord = length(cross(subtract(current, previous), chord)) / chordLength;
      const liesBetween = dot(subtract(current, previous), subtract(current, next)) <= tolerance ** 2;
      if (distanceFromChord <= tolerance && liesBetween) {
        changed = true;
        continue;
      }

      kept.push(current);
    }

    points = dedupeConsecutive(kept, tolerance);
  }

  return points;
}

function segmentPlaneIntersection(start, end, startDistance, endDistance, normal, d) {
  const denominator = startDistance - endDistance;
  const interpolation = denominator === 0 ? 0.5 : startDistance / denominator;
  const point = add(start, scale(subtract(end, start), Math.min(1, Math.max(0, interpolation))));

  // Project once to keep all generated cap vertices exactly coplanar.
  return subtract(point, scale(normal, dot(normal, point) - d));
}

function clipPolygon(points, normal, d, tolerance) {
  if (points.length < 3) return [];
  const output = [];

  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const startDistance = dot(normal, start) - d;
    const endDistance = dot(normal, end) - d;
    const startInside = startDistance <= tolerance;
    const endInside = endDistance <= tolerance;

    if (startInside && endInside) {
      output.push(end);
    } else if (startInside && !endInside) {
      output.push(segmentPlaneIntersection(start, end, startDistance, endDistance, normal, d));
    } else if (!startInside && endInside) {
      output.push(segmentPlaneIntersection(start, end, startDistance, endDistance, normal, d));
      output.push(end);
    }
  }

  return simplifyPolygon(output, tolerance);
}

function planeBasis(normal) {
  const helper = Math.abs(normal.x) < 0.8 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const u = normalize(cross(helper, normal));
  const v = cross(normal, u);
  return { u, v };
}

function dedupePoints(points, tolerance) {
  const result = [];
  for (const point of points) {
    if (!result.some((candidate) => distance(point, candidate) <= tolerance)) {
      result.push(point);
    }
  }
  return result;
}

function convexHullOnPlane(points, normal, tolerance) {
  const uniquePoints = dedupePoints(points, tolerance);
  if (uniquePoints.length < 3) return [];

  const { u, v } = planeBasis(normal);
  const projected = uniquePoints
    .map((point) => ({ point, x: dot(point, u), y: dot(point, v) }))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const xCoordinates = projected.map(({ x }) => x);
  const yCoordinates = projected.map(({ y }) => y);
  const coordinateSpan = Math.max(
    Math.max(...xCoordinates) - Math.min(...xCoordinates),
    Math.max(...yCoordinates) - Math.min(...yCoordinates),
    tolerance,
  );
  const areaTolerance = tolerance * coordinateSpan;
  const turn = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

  const lower = [];
  for (const point of projected) {
    while (lower.length >= 2 && turn(lower.at(-2), lower.at(-1), point) <= areaTolerance) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper = [];
  for (const point of [...projected].reverse()) {
    while (upper.length >= 2 && turn(upper.at(-2), upper.at(-1), point) <= areaTolerance) {
      upper.pop();
    }
    upper.push(point);
  }

  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)].map(({ point }) => point);
  return simplifyPolygon(hull, tolerance);
}

class VertexPool {
  constructor(tolerance) {
    this.tolerance = tolerance;
    this.vertices = [];
    this.cells = new Map();
  }

  cellCoordinates(point) {
    return [
      Math.floor(point.x / this.tolerance),
      Math.floor(point.y / this.tolerance),
      Math.floor(point.z / this.tolerance),
    ];
  }

  key(x, y, z) {
    return `${x},${y},${z}`;
  }

  add(point) {
    const [cellX, cellY, cellZ] = this.cellCoordinates(point);

    for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
      for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
        for (let zOffset = -1; zOffset <= 1; zOffset += 1) {
          const candidates = this.cells.get(this.key(
            cellX + xOffset,
            cellY + yOffset,
            cellZ + zOffset,
          ));
          if (!candidates) continue;
          for (const index of candidates) {
            if (distance(this.vertices[index], point) <= this.tolerance) return index;
          }
        }
      }
    }

    const index = this.vertices.length;
    this.vertices.push({ x: point.x, y: point.y, z: point.z });
    const cellKey = this.key(cellX, cellY, cellZ);
    const cell = this.cells.get(cellKey) ?? [];
    cell.push(index);
    this.cells.set(cellKey, cell);
    return index;
  }
}

function cleanIndices(indices) {
  const result = [];
  for (const index of indices) {
    if (result.at(-1) !== index) result.push(index);
  }
  if (result.length > 1 && result[0] === result.at(-1)) result.pop();
  return result;
}

function buildPolyhedron(source, polygons, tolerance) {
  const pool = new VertexPool(tolerance);
  const faces = [];

  for (const polygon of polygons) {
    const points = simplifyPolygon(polygon.points, tolerance);
    if (points.length < 3) continue;

    let vertexIndices = cleanIndices(points.map((point) => pool.add(point)));
    if (new Set(vertexIndices).size < 3) continue;

    let orderedPoints = vertexIndices.map((index) => pool.vertices[index]);
    let computedNormal = polygonNormal(orderedPoints);
    if (!computedNormal) continue;

    let desiredNormal = computedNormal;
    if (polygon.normal !== undefined) {
      desiredNormal = normalize(vector3(polygon.normal, "face normal"), "face normal");
      if (dot(computedNormal, desiredNormal) < 0) {
        vertexIndices = [...vertexIndices].reverse();
        orderedPoints = vertexIndices.map((index) => pool.vertices[index]);
        computedNormal = polygonNormal(orderedPoints);
      }
    }

    const { points: discardedPoints, ...faceMetadata } = polygon;
    void discardedPoints;
    faces.push({
      ...faceMetadata,
      vertexIndices,
      normal: computedNormal ?? desiredNormal,
    });
  }

  const usedIndices = [...new Set(faces.flatMap((face) => face.vertexIndices))].sort((a, b) => a - b);
  const remap = new Map(usedIndices.map((oldIndex, newIndex) => [oldIndex, newIndex]));

  return {
    ...source,
    vertices: usedIndices.map((index) => pool.vertices[index]),
    faces: faces.map((face) => ({
      ...face,
      vertexIndices: face.vertexIndices.map((index) => remap.get(index)),
    })),
  };
}

function emptyPolyhedron(source) {
  return { ...source, vertices: [], faces: [] };
}

function uniqueFaceId(faces, desiredId) {
  const used = new Set(faces.map((face) => face.id));
  if (desiredId !== undefined && !used.has(desiredId)) return desiredId;

  const base = desiredId === undefined ? "cut" : String(desiredId);
  let suffix = 1;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function facePoints(polyhedron, faceOrIndex) {
  let face = faceOrIndex;
  if (typeof faceOrIndex === "number") face = polyhedron.faces[faceOrIndex];
  if (typeof faceOrIndex === "string") {
    face = polyhedron.faces.find((candidate) => candidate.id === faceOrIndex);
  }
  if (!face || !Array.isArray(face.vertexIndices)) {
    throw new TypeError("face must be a face object, face index, or face id");
  }

  return face.vertexIndices.map((index) => {
    const point = polyhedron.vertices[index];
    if (!point) throw new RangeError(`face references missing vertex ${index}`);
    return point;
  });
}

/** Create an outward-wound cube centered at the origin (or supplied center). */
export function createCenteredCube(size = 2, options = {}) {
  if (typeof size === "object") {
    options = size;
    size = options.size ?? 2;
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new RangeError("cube size must be a positive finite number");
  }

  const center = options.center ? vector3(options.center, "cube center") : { x: 0, y: 0, z: 0 };
  const half = size / 2;
  const localVertices = [
    [-half, -half, -half],
    [half, -half, -half],
    [half, half, -half],
    [-half, half, -half],
    [-half, -half, half],
    [half, -half, half],
    [half, half, half],
    [-half, half, half],
  ];
  const vertices = localVertices.map(([x, y, z]) => ({
    x: x + center.x,
    y: y + center.y,
    z: z + center.z,
  }));

  const optionalMetadata = {};
  if (options.sourceOperationId !== undefined) {
    optionalMetadata.sourceOperationId = options.sourceOperationId;
  }
  if (options.region !== undefined) optionalMetadata.region = options.region;

  const faces = [
    { id: "cube:-z", vertexIndices: [0, 3, 2, 1], normal: { x: 0, y: 0, z: -1 } },
    { id: "cube:+z", vertexIndices: [4, 5, 6, 7], normal: { x: 0, y: 0, z: 1 } },
    { id: "cube:-x", vertexIndices: [0, 4, 7, 3], normal: { x: -1, y: 0, z: 0 } },
    { id: "cube:+x", vertexIndices: [1, 2, 6, 5], normal: { x: 1, y: 0, z: 0 } },
    { id: "cube:-y", vertexIndices: [0, 1, 5, 4], normal: { x: 0, y: -1, z: 0 } },
    { id: "cube:+y", vertexIndices: [3, 7, 6, 2], normal: { x: 0, y: 1, z: 0 } },
  ].map((face) => ({ ...face, ...optionalMetadata }));

  return { vertices, faces };
}

/** Return a structural clone suitable for immutable editor state. */
function clonePolyhedron(polyhedron) {
  return {
    ...polyhedron,
    vertices: polyhedron.vertices.map((point) => ({ ...point })),
    faces: polyhedron.faces.map((face) => ({
      ...face,
      vertexIndices: [...face.vertexIndices],
      normal: { ...vector3(face.normal, "face normal") },
    })),
  };
}

/**
 * Clip a convex polyhedron to `dot(normal, point) <= d`.
 *
 * The generated cap is outward-wound and points along `+normal`. Existing face
 * ids and metadata survive clipping. A no-op cut returns a deep clone.
 */
export function clipPolyhedron(polyhedron, planeInput, options = {}) {
  if (!polyhedron || !Array.isArray(polyhedron.vertices) || !Array.isArray(polyhedron.faces)) {
    throw new TypeError("polyhedron must expose vertices and faces arrays");
  }
  if (polyhedron.vertices.length === 0) return emptyPolyhedron(polyhedron);

  const plane = normalizedPlane(planeInput);
  const tolerance = resolveTolerance(polyhedron, options.tolerance);
  const signedDistances = polyhedron.vertices.map((point) => dot(plane.normal, point) - plane.d);

  if (!signedDistances.some((signedDistance) => signedDistance > tolerance)) {
    return clonePolyhedron(polyhedron);
  }
  if (!signedDistances.some((signedDistance) => signedDistance < -tolerance)) {
    return emptyPolyhedron(polyhedron);
  }

  const polygons = [];
  const capCandidates = [];

  for (const face of polyhedron.faces) {
    const points = facePoints(polyhedron, face);
    const clippedPoints = clipPolygon(points, plane.normal, plane.d, tolerance);
    if (clippedPoints.length < 3) continue;

    polygons.push({ ...face, points: clippedPoints });
    for (const point of clippedPoints) {
      if (Math.abs(dot(plane.normal, point) - plane.d) <= tolerance * 4) {
        capCandidates.push(point);
      }
    }
  }

  const capPoints = convexHullOnPlane(capCandidates, plane.normal, tolerance * 2);
  if (capPoints.length >= 3) {
    const descriptor = plane.descriptor;
    const record = plane.record;
    const sourceOperationId = options.sourceOperationId
      ?? options.operationId
      ?? record?.sourceOperationId
      ?? record?.operationId
      ?? record?.id
      ?? descriptor.sourceOperationId
      ?? descriptor.operationId;
    const region = options.region ?? record?.region ?? descriptor.region;
    const requestedFaceId = options.faceId ?? record?.faceId ?? descriptor.faceId;
    const cap = {
      id: uniqueFaceId(polyhedron.faces, requestedFaceId),
      points: capPoints,
      normal: plane.normal,
    };
    if (sourceOperationId !== undefined) cap.sourceOperationId = sourceOperationId;
    if (region !== undefined) cap.region = region;
    polygons.push(cap);
  }

  const result = buildPolyhedron(polyhedron, polygons, tolerance * 2);
  const extent = geometryExtent(result);
  const degenerateVolume = tolerance * Math.max(extent ** 2, tolerance ** 2) * 8;
  if (result.faces.length < 4 || polyhedronVolume(result) <= degenerateVolume) {
    return emptyPolyhedron(polyhedron);
  }
  return result;
}

/** Apply clipping planes in array order. */
export function clipPolyhedronByPlanes(polyhedron, planes, options = {}) {
  if (!Array.isArray(planes)) throw new TypeError("planes must be an array");

  return planes.reduce((result, entry) => {
    if (result.vertices.length === 0) return result;
    const perPlaneOptions = entry?.options && typeof entry.options === "object"
      ? entry.options
      : {};
    return clipPolyhedron(result, entry, { ...options, ...perPlaneOptions });
  }, clonePolyhedron(polyhedron));
}

export const clipByPlanes = clipPolyhedronByPlanes;

/** Area of one face. */
export function faceArea(polyhedron, faceOrIndex) {
  const points = facePoints(polyhedron, faceOrIndex);
  if (points.length < 3) return 0;
  return length(polygonAreaVector(points)) / 2;
}

/** Area-weighted centroid of one convex face. */
export function faceCentroid(polyhedron, faceOrIndex) {
  const points = facePoints(polyhedron, faceOrIndex);
  if (points.length === 0) return { x: 0, y: 0, z: 0 };
  if (points.length < 3) return averagePoints(points);

  const anchor = points[0];
  let weightedCentroid = { x: 0, y: 0, z: 0 };
  let totalArea = 0;

  for (let index = 1; index < points.length - 1; index += 1) {
    const b = points[index];
    const c = points[index + 1];
    const area = length(cross(subtract(b, anchor), subtract(c, anchor))) / 2;
    const centroid = scale(add(add(anchor, b), c), 1 / 3);
    weightedCentroid = add(weightedCentroid, scale(centroid, area));
    totalArea += area;
  }

  return totalArea === 0 ? averagePoints(points) : scale(weightedCentroid, 1 / totalArea);
}

function massProperties(polyhedron) {
  if (polyhedron.vertices.length === 0) {
    return { volume: 0, centroid: { x: 0, y: 0, z: 0 } };
  }

  // A nearby reference point reduces cancellation for translated geometry.
  const reference = averagePoints(polyhedron.vertices);
  let signedVolume = 0;
  let weightedCentroid = { x: 0, y: 0, z: 0 };

  for (const face of polyhedron.faces) {
    const points = facePoints(polyhedron, face);
    if (points.length < 3) continue;
    const anchor = points[0];

    for (let index = 1; index < points.length - 1; index += 1) {
      const b = points[index];
      const c = points[index + 1];
      const tetrahedronVolume = dot(
        subtract(anchor, reference),
        cross(subtract(b, reference), subtract(c, reference)),
      ) / 6;
      const tetrahedronCentroid = scale(add(add(add(reference, anchor), b), c), 1 / 4);
      signedVolume += tetrahedronVolume;
      weightedCentroid = add(
        weightedCentroid,
        scale(tetrahedronCentroid, tetrahedronVolume),
      );
    }
  }

  if (Math.abs(signedVolume) <= Number.EPSILON) {
    return { volume: 0, centroid: averagePoints(polyhedron.vertices) };
  }

  return {
    volume: Math.abs(signedVolume),
    centroid: scale(weightedCentroid, 1 / signedVolume),
  };
}

/** Enclosed volume of the polyhedron. */
export function polyhedronVolume(polyhedron) {
  return massProperties(polyhedron).volume;
}

/** Volume centroid of the polyhedron. */
export function polyhedronCentroid(polyhedron) {
  return massProperties(polyhedron).centroid;
}

export function polyhedronSurfaceArea(polyhedron) {
  return polyhedron.faces.reduce((sum, face) => sum + faceArea(polyhedron, face), 0);
}

/** Aggregate metrics used by the editor ledger/export layer. */
export function measurePolyhedron(polyhedron) {
  const { volume, centroid } = massProperties(polyhedron);
  return {
    volume,
    centroid,
    surfaceArea: polyhedronSurfaceArea(polyhedron),
    faces: polyhedron.faces.map((face) => ({
      id: face.id,
      area: faceArea(polyhedron, face),
      centroid: faceCentroid(polyhedron, face),
    })),
  };
}
