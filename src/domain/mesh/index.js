import { add, cross, dot, length, normalize, sub } from './vectors.js';
import { PolyhedronError, polyhedronTolerance } from './types.js';
import { cutPolyhedron } from './cut.js';
import { validatePolyhedron } from './validate.js';
import { validateMeshEmbedding } from './embedding.js';
import { importRoughObj } from './import-obj.js';

const validatedSolids = new WeakSet();

function faceNormal(vertices, ids) {
  let area = { x: 0, y: 0, z: 0 };
  const anchor = vertices[ids[0]];
  for (let i = 1; i + 1 < ids.length; i++) {
    area = add(area, cross(sub(vertices[ids[i]], anchor), sub(vertices[ids[i + 1]], anchor)));
  }
  if (!length(area)) throw new PolyhedronError('invalid-mesh', 'Face has zero area');
  return normalize(area);
}

/** Validate once at the stock boundary. Solver outputs preserve the invariant. */
export function validateMeshSolid(solid, { embedding = true } = {}) {
  const topology = validatePolyhedron(solid);
  const spatial = embedding ? validateMeshEmbedding(solid) : {};
  if (embedding) validatedSolids.add(solid);
  return { ...topology, ...spatial };
}

/** Create an immutable-by-contract, indexed, oriented material boundary. */
export function createMeshSolid(input, { convex = false } = {}) {
  if (!Array.isArray(input?.vertices) || !Array.isArray(input?.faces)) throw new PolyhedronError('invalid-mesh', 'Mesh requires vertices and faces');
  if (!input.vertices.length || !input.faces.length) throw new PolyhedronError('invalid-mesh', 'Starting crystal must contain a closed material volume');
  const vertices = input.vertices.map(p => Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : { x: p.x, y: p.y, z: p.z });
  const faces = input.faces.map((face, index) => {
    const record = Array.isArray(face) ? {} : face;
    const vertexIndices = [...(Array.isArray(face) ? face : face.vertexIndices)];
    return { ...record, id: record.id ?? `rough:patch:${index}`, vertexIndices };
  });
  const solid = { kind: 'mesh', vertices, faces };
  const topology = validateMeshSolid(solid, { embedding: !convex });
  const identities = new Set();
  for (const face of faces) {
    if (identities.has(face.id)) throw new PolyhedronError('invalid-mesh', 'Repeated patch identity');
    identities.add(face.id);
    face.normal = faceNormal(vertices, face.vertexIndices);
  }
  if (convex) {
    // A single closed spherical boundary of convex planar patches is embedded
    // when every vertex is inside every outward half-space. This avoids BVH
    // pair degeneration at a high-valence apex; imported roughs use embedding.
    if (topology.shells !== 1 || topology.euler !== 2) throw new PolyhedronError('invalid-mesh', 'Preview source is not a single convex boundary');
    const eps = polyhedronTolerance(vertices);
    for (const face of faces) {
      const anchor = vertices[face.vertexIndices[0]];
      if (vertices.some(point => dot(face.normal, sub(point, anchor)) > eps)) throw new PolyhedronError('invalid-mesh', 'Preview source is not convex');
    }
    validatedSolids.add(solid);
  }
  return solid;
}

/** OBJ seams weld only identical positions; concave planar polygons triangulate. */
export function parseMeshOBJ(text, options) {
  const { solid, sourceFaces } = importRoughObj(text, options);
  const validation = validateMeshSolid(solid);
  return { vertices: solid.vertices, faces: solid.faces.map(face => face.vertexIndices), sourceFaces, validation };
}

/** Geometry facade supplies its existing normalization, tolerance and metadata. */
export function clipMeshSolid(solid, plane, { tolerance, facetId, convexCaps = false, ...faceMetadata }) {
  if (!validatedSolids.has(solid)) validateMeshSolid(solid);
  const result = cutPolyhedron(solid, { normal: plane.normal, offset: plane.d }, {
    trustedInput: true, tolerance, facetId, faceMetadata, convexCaps,
  }).solid;
  validatedSolids.add(result);
  return result;
}

export { PolyhedronError } from './types.js';
