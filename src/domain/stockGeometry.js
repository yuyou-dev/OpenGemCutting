export const CRYSTAL_IMPORT_FACE_LIMIT = 1000;
import { createCenteredCube } from "./geometry.js";
import { parseMeshOBJ } from "./mesh/index.js";
import { getMeshStockSolid, normalizeMeshStock } from "./meshStock.js";
import { createFacetingDocument } from "./faceting.js";
import { DEFAULT_OPTICS_SETTINGS, resolveOpticsSettings } from "./optics.js";

export function createStockSolid(stock) {
  return stock.kind === "mesh" ? getMeshStockSolid(stock) : createCenteredCube(stock.size, {
    center: stock.center, sourceOperationId: "rough-cube", region: "rough",
  });
}

const unitToMm = { unitless: null, mm: 1, cm: 10, m: 1000 };

function coordinateBounds(points) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const point of points) for (let i = 0; i < 3; i++) {
    min[i] = Math.min(min[i], point[i]); max[i] = Math.max(max[i], point[i]);
  }
  return { min, max, dimensions: max.map((value, i) => value - min[i]) };
}

export function createMeshDocument({ mesh, name = "导入晶体", unit = "unitless", upAxis = "z" }) {
  if (!(unit in unitToMm) || !["x", "y", "z"].includes(upAxis)) throw new Error("请选择有效的源单位和上方轴向。");
  const sourcePoints = mesh.vertices.map(p => Array.isArray(p) ? p : [p.x, p.y, p.z]);
  const sourceDimensions = coordinateBounds(sourcePoints).dimensions;
  // Proper rotations preserve winding: +Y or +X becomes the machine's +Z.
  const points = sourcePoints.map(([x, y, z]) => upAxis === "y" ? [x, -z, y] : upAxis === "x" ? [-z, y, x] : [x, y, z]);
  const { min, max, dimensions } = coordinateBounds(points);
  const extent = Math.max(...dimensions);
  if (!Number.isFinite(extent) || extent <= 0) throw new Error("晶体尺寸无效。");
  const scale = 2 / extent;
  const center = min.map((value, i) => (value + max[i]) / 2);
  const stock = normalizeMeshStock({
    kind: "mesh", size: 2, center: [0, 0, 0],
    mesh: { vertices: points.map(p => ({ x: (p[0] - center[0]) * scale, y: (p[1] - center[1]) * scale, z: (p[2] - center[2]) * scale })), faces: mesh.faces },
    source: { name, unit, upAxis, dimensions: sourceDimensions, orientedDimensions: dimensions, scale, center, ...(unitToMm[unit] ? { millimetersPerModelUnit: unitToMm[unit] / scale } : {}) },
  });
  return createFacetingDocument({ name, stock, facets: [], metadata: { optics: resolveOpticsSettings(DEFAULT_OPTICS_SETTINGS) } });
}

export function inspectCrystalOBJ(text, { fileName = "导入晶体.obj", unit = "unitless", upAxis = "z" } = {}) {
  return inspectCrystalMesh(parseMeshOBJ(text, { maxFaces: CRYSTAL_IMPORT_FACE_LIMIT }), { fileName, unit, upAxis });
}

/** Reuse parsed source data when only import parameters change. The normalized
 * stock still receives full geometry validation after its coordinate transform. */
export function inspectCrystalMesh(mesh, { fileName = "导入晶体.obj", unit = "unitless", upAxis = "z" } = {}) {
  if (Math.max(mesh.sourceFaces ?? 0, mesh.faces.length) > CRYSTAL_IMPORT_FACE_LIMIT) throw new Error(`初始晶体最多允许 ${CRYSTAL_IMPORT_FACE_LIMIT} 个面；请先简化模型。`);
  const document = createMeshDocument({ mesh, name: fileName.replace(/\.obj$/i, ""), unit, upAxis });
  const solid = createStockSolid(document.stock);
  return { document, solid, summary: {
    sourceName: fileName, sourceUnits: unit,
    sourceDimensions: document.stock.source.dimensions,
    dimensions: document.stock.source.orientedDimensions.map(value => value * document.stock.source.scale),
    normalizedScale: document.stock.source.scale,
    vertexCount: solid.vertices.length, patchCount: solid.faces.length,
  } };
}
