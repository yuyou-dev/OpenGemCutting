import { evaluateDocument } from "../documentGeometry.js";
import { millimetersPerModelUnit } from "../labsContract/validation.js";
import { positive, solidBounds } from "../sizeWeight.js";
import { fail, formatNumber } from "./shared.js";

/**
 * Wavefront OBJ 3D mesh exporter tailored for jewelry CAD & rendering workflows
 * (Rhino, MatrixGold, JewelCAD, Blender, KeyShot).
 *
 * Design invariants:
 *   1. Physical millimeter (`mm`) coordinates (`# Units: mm`): uses the stone's
 *      adopted `millimetersPerModelUnit` (from Size & Weight or calibrated rough
 *      stock), an explicit `targetWidthMm`, or a clean `10 mm` finished-width
 *      reference when the project has not saved a physical size yet.
 *   2. Crisp gemstone facet edges (`s off` + per-facet outward unit `vn`):
 *      normals are bound per planar face (`f v1//vn v2//vn ...`), never blended
 *      across shared vertices.
 *   3. Anatomical groups (`g table`, `crown`, `girdle`, `pavilion`, `concave`,
 *      `rough`) so jewelers can isolate the girdle for prong/bezel seat setup.
 */

export const DEFAULT_OBJ_WIDTH_MM = 10;
export const OBJ_GROUP_ORDER = Object.freeze([
  "table",
  "crown",
  "girdle",
  "pavilion",
  "concave",
  "rough",
  "body",
]);

const AREA_EPS_FACTOR = 1e-18;

function sanitizeHeaderLine(value, fallback = "gemstone") {
  const cleaned = String(value ?? "")
    .replace(/[\r\n\u2028\u2029#]+/g, " ")
    .replace(/[\x00-\x1f\x7f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

function safeObjectToken(value) {
  const cleaned = sanitizeHeaderLine(value, "gemstone")
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "gemstone";
}

function formatCoord(value) {
  return formatNumber(value);
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
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

function length(v) {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v) {
  const len = length(v);
  if (!Number.isFinite(len) || len === 0) return null;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function toVec3(raw) {
  if (!raw) return null;
  const x = Array.isArray(raw) ? raw[0] : raw.x;
  const y = Array.isArray(raw) ? raw[1] : raw.y;
  const z = Array.isArray(raw) ? raw[2] : raw.z;
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z };
}

/** Newell area vector (2x area) across the full closed polygon loop. */
function newellAreaVector(ring, vertices) {
  let x = 0;
  let y = 0;
  let z = 0;
  const count = ring.length;
  for (let i = 0; i < count; i += 1) {
    const curr = vertices[ring[i]];
    const next = vertices[ring[(i + 1) % count]];
    x += (curr.y - next.y) * (curr.z + next.z);
    y += (curr.z - next.z) * (curr.x + next.x);
    z += (curr.x - next.x) * (curr.y + next.y);
  }
  return { x, y, z };
}

function cleanVertexRing(indices, vertexCount) {
  if (!Array.isArray(indices)) return [];
  const cleaned = [];
  for (const id of indices) {
    if (!Number.isInteger(id) || id < 0 || id >= vertexCount) {
      fail("INVALID_FACE_VERTEX", `OBJ 导出遇到越界顶点索引 ${id}。`);
    }
    if (cleaned.at(-1) !== id) cleaned.push(id);
  }
  if (cleaned.length > 1 && cleaned[0] === cleaned.at(-1)) cleaned.pop();
  return cleaned;
}

/**
 * Ear-clipping triangulator for planar polygons (including boolean patches with
 * collinear or near-collinear T-junction vertices along boundary edges).
 * Guarantees every emitted triangle has positive outward area and preserves all
 * boundary vertices so shared edges remain manifold.
 */
function triangulatePlanarRing(ring, vertices, unitNormal, areaFloor) {
  if (ring.length <= 3) return [ring];

  const refAxis = Math.abs(unitNormal.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const uAxis = normalize(cross(refAxis, unitNormal));
  const vAxis = cross(unitNormal, uAxis);
  const origin = vertices[ring[0]];
  const uvById = new Map();
  let span = 0;
  for (const id of ring) {
    const rel = sub(vertices[id], origin);
    const u = dot(rel, uAxis);
    const v = dot(rel, vAxis);
    uvById.set(id, { u, v });
    span = Math.max(span, Math.abs(u), Math.abs(v));
  }
  const edgeTol = Math.max(span * 1e-11, Number.EPSILON * 16);
  const orient2d = (a, b, c) => (b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u);
  const pointInOrOnTri = (a, b, c, p) => {
    const abLen = Math.hypot(b.u - a.u, b.v - a.v);
    const bcLen = Math.hypot(c.u - b.u, c.v - b.v);
    const caLen = Math.hypot(a.u - c.u, a.v - c.v);
    return (
      orient2d(a, b, p) >= -edgeTol * abLen
      && orient2d(b, c, p) >= -edgeTol * bcLen
      && orient2d(c, a, p) >= -edgeTol * caLen
    );
  };

  const remaining = [...ring];
  const triangles = [];

  while (remaining.length > 3) {
    let bestIndex = -1;
    let bestSignedArea2 = -Infinity;
    const n = remaining.length;
    for (let i = 0; i < n; i += 1) {
      const prevId = remaining[(i - 1 + n) % n];
      const currId = remaining[i];
      const nextId = remaining[(i + 1) % n];
      const a = uvById.get(prevId);
      const b = uvById.get(currId);
      const c = uvById.get(nextId);
      const area2 = orient2d(a, b, c);
      if (area2 <= areaFloor) continue;
      let blocked = false;
      for (let j = 0; j < n; j += 1) {
        const testId = remaining[j];
        if (testId === prevId || testId === currId || testId === nextId) continue;
        if (pointInOrOnTri(a, b, c, uvById.get(testId))) {
          blocked = true;
          break;
        }
      }
      if (!blocked && area2 > bestSignedArea2) {
        bestSignedArea2 = area2;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) break;
    const prev = remaining[(bestIndex - 1 + n) % n];
    const curr = remaining[bestIndex];
    const next = remaining[(bestIndex + 1) % n];
    triangles.push([prev, curr, next]);
    remaining.splice(bestIndex, 1);
  }

  if (remaining.length === 3) {
    const [i0, i1, i2] = remaining;
    const signedArea2 = dot(cross(sub(vertices[i1], vertices[i0]), sub(vertices[i2], vertices[i0])), unitNormal);
    if (signedArea2 > areaFloor) triangles.push([i0, i1, i2]);
  }
  return triangles;
}

function classifyFaceGroup(face, unitNormal, facetById) {
  const owner = facetById?.get(face.facetId ?? face.id) ?? null;
  const operationType = face.operationType ?? owner?.metadata?.operationType ?? null;
  const region = face.region ?? owner?.region ?? null;

  if (operationType === "concave" || region === "concave") return "concave";
  if (operationType === "table") return "table";
  if (region === "crown") return unitNormal.z > 1 - 1e-7 ? "table" : "crown";
  if (region === "girdle") return "girdle";
  if (region === "pavilion") return "pavilion";
  if (
    region === "rough"
    || String(face.surfaceId ?? "").startsWith("rough:")
    || String(face.sourceOperationId ?? "").startsWith("rough-")
  ) {
    return "rough";
  }
  return "body";
}

/**
 * Resolves the millimeter scale and finished bounding box of a document/solid
 * for OBJ export without mutating the source document.
 */
export function inspectDocumentObjScale(
  document,
  solid = evaluateDocument(document),
  { millimetersPerModelUnit: explicitMmPerUnit, targetWidthMm } = {},
) {
  if (!solid?.vertices?.length || !solid?.faces?.length) {
    fail("EMPTY_SOLID", "当前没有可导出的三维实体。");
  }
  for (const point of solid.vertices) {
    if (!point || ![point.x, point.y, point.z].every(Number.isFinite)) {
      fail("NONFINITE_VERTEX", "实体包含无效顶点坐标，无法导出 OBJ。");
    }
  }
  const bounds = solidBounds(solid.vertices);
  const maxSpan = Math.max(bounds.length, bounds.width, bounds.height);
  if (!Number.isFinite(maxSpan) || maxSpan <= 0) {
    fail("DEGENERATE_SOLID", "实体尺寸退化为零，无法导出 OBJ。");
  }
  const widthUnits = bounds.width > 1e-12 ? bounds.width : maxSpan;
  const roughScale = document?.stock?.source?.millimetersPerModelUnit ?? null;
  const adoptedScale = document ? millimetersPerModelUnit(document) : null;

  let scale;
  let scaleSource;
  if (explicitMmPerUnit !== undefined && explicitMmPerUnit !== null) {
    scale = positive(Number(explicitMmPerUnit), "毫米比例");
    scaleSource = "custom-scale";
  } else if (targetWidthMm !== undefined && targetWidthMm !== null) {
    scale = positive(Number(targetWidthMm), "目标宽度") / positive(widthUnits, "模型宽度");
    scaleSource = "custom-width";
  } else if (adoptedScale) {
    scale = positive(adoptedScale, "毫米比例");
    scaleSource = roughScale ? "rough-stock" : "adopted-size";
  } else {
    scale = DEFAULT_OBJ_WIDTH_MM / positive(widthUnits, "模型宽度");
    scaleSource = "default-width-10mm";
  }

  return {
    scale,
    scaleSource,
    hasSavedScale: Boolean(adoptedScale),
    widthUnits,
    bounds,
    dimensionsMm: {
      length: bounds.length * scale,
      width: bounds.width * scale,
      height: bounds.height * scale,
    },
  };
}

/**
 * Serializes a validated polyhedron or concave boolean mesh solid into a
 * millimeter-scaled Wavefront `.obj` string with per-facet hard outward normals.
 */
export function writeObjSolid(solid, options = {}) {
  const {
    document = null,
    name = document?.name ?? "gemstone",
    millimetersPerModelUnit: explicitMmPerUnit,
    targetWidthMm,
    center = true,
    triangulate = false,
    facetById = null,
  } = options;

  const scaleInfo = inspectDocumentObjScale(document, solid, {
    millimetersPerModelUnit: explicitMmPerUnit,
    targetWidthMm,
  });
  const { scale, scaleSource, bounds, dimensionsMm } = scaleInfo;

  const origin = center
    ? {
        x: (bounds.min.x + bounds.max.x) / 2,
        y: (bounds.min.y + bounds.max.y) / 2,
        z: (bounds.min.z + bounds.max.z) / 2,
      }
    : { x: 0, y: 0, z: 0 };

  const scaledVertices = solid.vertices.map((point) => ({
    x: (point.x - origin.x) * scale,
    y: (point.y - origin.y) * scale,
    z: (point.z - origin.z) * scale,
  }));

  const maxDimMm = Math.max(dimensionsMm.length, dimensionsMm.width, dimensionsMm.height);
  const areaFloor = Math.max((maxDimMm ** 2) * AREA_EPS_FACTOR, Number.EPSILON);

  // Verify signed enclosed volume so global shell orientation is strictly outward (+V).
  const ref = scaledVertices[0];
  let signedVolume6 = 0;
  for (const face of solid.faces) {
    const ring = cleanVertexRing(face.vertexIndices, scaledVertices.length);
    if (ring.length < 3) continue;
    const a = sub(scaledVertices[ring[0]], ref);
    for (let i = 1; i + 1 < ring.length; i += 1) {
      const b = sub(scaledVertices[ring[i]], ref);
      const c = sub(scaledVertices[ring[i + 1]], ref);
      signedVolume6 += dot(a, cross(b, c));
    }
  }
  if (!Number.isFinite(signedVolume6) || Math.abs(signedVolume6) <= (maxDimMm ** 3) * 1e-18) {
    fail("ZERO_VOLUME_SOLID", "实体体积退化为零，无法导出有效三维网格。");
  }
  const invertGlobal = signedVolume6 < 0;

  const resolvedFacetMap = facetById ?? (
    Array.isArray(document?.facets)
      ? new Map(document.facets.map((facet) => [facet.id, facet]))
      : null
  );

  const groupedPolygons = new Map(OBJ_GROUP_ORDER.map((group) => [group, []]));
  const usedVertexSet = new Set();

  for (const face of solid.faces) {
    let ring = cleanVertexRing(face.vertexIndices, scaledVertices.length);
    if (new Set(ring).size < 3) continue;
    if (invertGlobal) ring = [...ring].reverse();

    let areaVec = newellAreaVector(ring, scaledVertices);
    let areaLen = length(areaVec);
    if (areaLen <= areaFloor) continue;
    let unitNormal = { x: areaVec.x / areaLen, y: areaVec.y / areaLen, z: areaVec.z / areaLen };

    const storedVec = !invertGlobal ? toVec3(face.normal) : null;
    const storedUnit = storedVec ? normalize(storedVec) : null;
    if (storedUnit) {
      if (dot(unitNormal, storedUnit) < 0) {
        ring = [...ring].reverse();
        unitNormal = { x: -unitNormal.x, y: -unitNormal.y, z: -unitNormal.z };
      }
      if (length(sub(unitNormal, storedUnit)) < 1e-5) {
        unitNormal = storedUnit;
      }
    }

    const group = classifyFaceGroup(face, unitNormal, resolvedFacetMap);
    const geomUnit = { x: areaVec.x / areaLen, y: areaVec.y / areaLen, z: areaVec.z / areaLen };
    const anchorPt = scaledVertices[ring[0]];
    const planarTol = Math.max(maxDimMm * 1e-11, Number.EPSILON * 16);
    const needsTriangulation = triangulate || (
      ring.length > 3
      && ring.some((vid) => Math.abs(dot(geomUnit, sub(scaledVertices[vid], anchorPt))) > planarTol)
    );
    const polygons = needsTriangulation
      ? triangulatePlanarRing(ring, scaledVertices, unitNormal, areaFloor)
      : [ring];

    for (const poly of polygons) {
      if (new Set(poly).size < 3) continue;
      const polyArea = length(newellAreaVector(poly, scaledVertices));
      if (polyArea <= areaFloor) continue;
      for (const vid of poly) usedVertexSet.add(vid);
      groupedPolygons.get(group).push({ vertexIndices: poly, normal: unitNormal });
    }
  }

  const orderedUsedVertices = [...usedVertexSet].sort((a, b) => a - b);
  const totalFaces = [...groupedPolygons.values()].reduce((sum, list) => sum + list.length, 0);
  if (orderedUsedVertices.length < 4 || totalFaces < 4) {
    fail("INSUFFICIENT_MESH", "有效面片不足以构成封闭三维宝石实体。");
  }

  const vertexRemap = new Map(orderedUsedVertices.map((oldId, index) => [oldId, index + 1]));
  const normalIndexByKey = new Map();
  const normalLines = [];
  const registerNormal = (normal) => {
    const nx = formatCoord(normal.x);
    const ny = formatCoord(normal.y);
    const nz = formatCoord(normal.z);
    const key = `${nx} ${ny} ${nz}`;
    let index = normalIndexByKey.get(key);
    if (!index) {
      index = normalLines.length + 1;
      normalIndexByKey.set(key, index);
      normalLines.push(`vn ${key}`);
    }
    return index;
  };

  const cleanDesignName = sanitizeHeaderLine(name, "gemstone");
  const objectName = safeObjectToken(name);
  const lines = [
    "# OpenGemCutting Wavefront OBJ Export",
    `# Design: ${cleanDesignName}`,
    "# Units: mm",
    `# Scale: ${scaleSource} (${formatCoord(scale)} mm/model-unit)`,
    `# Dimensions (L x W x H): ${dimensionsMm.length.toFixed(4)} x ${dimensionsMm.width.toFixed(4)} x ${dimensionsMm.height.toFixed(4)} mm`,
    "# Axes: right-handed, +X length, +Y width, +Z crown/table up",
    `o ${objectName}`,
    "s off",
  ];

  for (const oldId of orderedUsedVertices) {
    const v = scaledVertices[oldId];
    lines.push(`v ${formatCoord(v.x)} ${formatCoord(v.y)} ${formatCoord(v.z)}`);
  }

  const groupCounts = {};
  const faceBlocks = [];
  for (const group of OBJ_GROUP_ORDER) {
    const items = groupedPolygons.get(group);
    if (!items.length) continue;
    groupCounts[group] = items.length;
    const block = [`g ${group}`];
    for (const item of items) {
      const nIdx = registerNormal(item.normal);
      const tokens = item.vertexIndices.map((vid) => `${vertexRemap.get(vid)}//${nIdx}`);
      block.push(`f ${tokens.join(" ")}`);
    }
    faceBlocks.push(...block);
  }

  lines.push(...normalLines, ...faceBlocks, "");

  return {
    text: lines.join("\n"),
    scale,
    scaleSource,
    dimensionsMm,
    vertexCount: orderedUsedVertices.length,
    normalCount: normalLines.length,
    faceCount: totalFaces,
    groups: groupCounts,
  };
}

/**
 * Evaluates the committed document solid (including planar facets, concave
 * boolean cuts, and rough crystal stock) and exports a jewelry-grade `.obj`.
 */
export function exportDocumentObj(document, options = {}) {
  if (!document || typeof document !== "object") {
    fail("INVALID_DOCUMENT", "缺少有效的设计文档。");
  }
  const solid = options.solid ?? evaluateDocument(document);
  return writeObjSolid(solid, {
    ...options,
    document,
    name: options.name ?? document.name ?? "gemstone",
  });
}
