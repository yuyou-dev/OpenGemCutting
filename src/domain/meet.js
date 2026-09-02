/**
 * Direct meet-point solving for the faceting workbench.
 *
 * A picked viewport vertex or edge can be placed exactly on the active
 * cutting plane by solving depth in closed form. The optional angle solver
 * handles the inverse problem at a fixed depth. The module contains only
 * explicit solvers invoked by direct selection.
 */

import {
  DEFAULT_STOCK,
  FACET_REGION,
  betaDegToIndustryAngle,
  facetNormal,
  normalizeIndex,
  normalizeRegion,
  normalizeStock,
  rotationalStockSupportOffset,
} from "./faceting.js";

/** Vertices closer than this are treated as the same point. */
const VERTEX_TOLERANCE = 1e-9;
const ANGLE_SCAN_STEP_DEG = 0.1;
const ANGLE_ROOT_TOLERANCE_DEG = 1e-6;
const ANGLE_FUNCTION_TOLERANCE = 1e-9;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertFiniteNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
  return value;
}

function cleanNumber(value) {
  const rounded = Math.round(value * 1e12) / 1e12;
  return Object.is(rounded, -0) || Math.abs(rounded) < 1e-12 ? 0 : rounded;
}

function vector3(value, label = "vector") {
  const x = Array.isArray(value) ? value[0] : value?.x;
  const y = Array.isArray(value) ? value[1] : value?.y;
  const z = Array.isArray(value) ? value[2] : value?.z;
  if (![x, y, z].every(Number.isFinite)) {
    throw new TypeError(`${label} must contain three finite coordinates.`);
  }
  return { x, y, z };
}

function dot3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function distance3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function collectSolidVertices(solid) {
  if (!isPlainObject(solid) || !Array.isArray(solid.vertices)) {
    throw new TypeError("solid must expose a vertices array.");
  }
  const unique = [];
  for (const entry of solid.vertices) {
    const point = vector3(entry, "vertex");
    if (!unique.some((kept) => distance3(kept, point) <= VERTEX_TOLERANCE)) {
      unique.push({
        x: cleanNumber(point.x),
        y: cleanNumber(point.y),
        z: cleanNumber(point.z),
      });
    }
  }
  return unique;
}

/** Places a plane with `normal` exactly through `vertex`. */
export function depthForVertex(normal, vertex, stock = DEFAULT_STOCK) {
  const n = vector3(normal, "normal");
  const v = vector3(vertex, "vertex");
  const support = rotationalStockSupportOffset(n, normalizeStock(stock));
  return cleanNumber(support - dot3(n, v));
}

/** Touches an edge without pushing its nearer endpoint outside the solid. */
export function depthForEdge(normal, edge, stock = DEFAULT_STOCK) {
  if (!isPlainObject(edge)) {
    throw new TypeError("edge must be an {a, b} object.");
  }
  const depthA = depthForVertex(normal, edge.a, stock);
  const depthB = depthForVertex(normal, edge.b, stock);
  return cleanNumber(Math.min(depthA, depthB));
}

function bisectRoot(residual, low, high) {
  let residualLow = residual(low);
  while (Math.abs(high - low) > ANGLE_ROOT_TOLERANCE_DEG) {
    const middle = (low + high) / 2;
    const residualMiddle = residual(middle);
    if (residualMiddle === 0) return middle;
    if (residualLow * residualMiddle < 0) {
      high = middle;
    } else {
      low = middle;
      residualLow = residualMiddle;
    }
  }
  return (low + high) / 2;
}

/**
 * Solves the industry angle that places the cutting plane through `vertex`
 * at a fixed depth. Returns `{ industryAngleDeg, betaDeg }`, or null when the
 * point cannot be reached in the selected crown/pavilion half-range.
 */
export function angleForVertexTarget({
  baseIndex,
  region,
  vertex,
  depth,
  stock = DEFAULT_STOCK,
} = {}) {
  const resolvedRegion = normalizeRegion(region);
  if (resolvedRegion === FACET_REGION.GIRDLE) {
    throw new RangeError(
      "girdle facets are vertical and do not support angle solving.",
    );
  }
  const resolvedIndex = normalizeIndex(baseIndex);
  const target = vector3(vertex, "vertex");
  const resolvedDepth = assertFiniteNumber(depth, "depth");
  if (resolvedDepth < 0) {
    throw new RangeError("depth must be greater than or equal to zero.");
  }
  const resolvedStock = normalizeStock(stock);

  const residual = (betaDeg) => {
    const normal = facetNormal(resolvedIndex, betaDeg);
    return (
      dot3(normal, target) -
      rotationalStockSupportOffset(normal, resolvedStock) +
      resolvedDepth
    );
  };
  const resultFor = (betaDeg) => {
    const cleaned = cleanNumber(betaDeg);
    return {
      industryAngleDeg: betaDegToIndustryAngle(resolvedRegion, cleaned),
      betaDeg: cleaned,
    };
  };

  const direction = resolvedRegion === FACET_REGION.CROWN ? 1 : -1;
  const steps = Math.round(90 / ANGLE_SCAN_STEP_DEG);
  let previousBeta = 0;
  let previousResidual = residual(0);
  if (Math.abs(previousResidual) <= ANGLE_FUNCTION_TOLERANCE) {
    return resultFor(0);
  }

  for (let step = 1; step <= steps; step += 1) {
    const beta = cleanNumber(direction * step * ANGLE_SCAN_STEP_DEG);
    const value = residual(beta);
    if (Math.abs(value) <= ANGLE_FUNCTION_TOLERANCE) {
      return resultFor(beta);
    }
    if (previousResidual * value < 0) {
      return resultFor(bisectRoot(residual, previousBeta, beta));
    }
    previousBeta = beta;
    previousResidual = value;
  }
  return null;
}
