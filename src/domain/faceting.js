import { clipPolyhedronByPlanes } from "./geometry.js";
import { getMeshStockSolid, normalizeMeshStock } from "./meshStock.js";
import { normalizeIndexTeeth, normalizeIndexGear, facetOnIndexGear, indexExportSummary } from "./indexing.js";
import { normalizeConcaveCuts } from "./concaveCuts.js";
import { validateDocumentHeader, validateDocumentExtensions, refreshLabRecipe } from "./labsContract/validation.js";
/**
 * Facet-96 domain model.
 *
 * Coordinate convention:
 * - the index wheel turns around Z and index 96 is the display alias for 0;
 * - azimuth increases counter-clockwise in the XY plane;
 * - +Z points toward the crown, therefore crown beta is positive and
 *   pavilion beta is negative;
 * - clipping planes keep dot(normal, point) <= offset;
 * - depth is measured inward from the stock's rotational envelope around Z.
 */

export const INDEX_TEETH = 96;
export const VALID_REPEAT_COUNTS = Object.freeze(
  Array.from({ length: 360 }, (_, index) => index + 1),
);

export const FACET_REGION = Object.freeze({
  CROWN: "crown",
  GIRDLE: "girdle",
  PAVILION: "pavilion",
});

const FACET_REGIONS = Object.freeze(Object.values(FACET_REGION));

export const FACET_REGION_LABELS = Object.freeze({
  crown: "冠部",
  girdle: "腰部",
  pavilion: "亭部",
});

export const FACET_REGION_PREFIXES = Object.freeze({
  crown: "C",
  girdle: "G",
  pavilion: "P",
});

const DOCUMENT_KIND = "facet-96-document";
const DOCUMENT_SCHEMA_VERSION = 1;
const DOCUMENT_SCHEMA_ID =
  "https://yuyou-dev.github.io/OpenGemCutting/schemas/document-v1.schema.json";
// Any edition of the workbench family may use its own schema host; the
// document-v1 format is identified by this suffix plus schemaVersion/kind.

export const DEFAULT_STOCK = Object.freeze({
  kind: "cube",
  size: 2,
  center: Object.freeze([0, 0, 0]),
});

const COMMAND_TYPE = Object.freeze({
  REPLACE_PATTERN: "pattern/replace",
  ADD_FACETS: "facets/add",
  REMOVE_FACETS: "facets/remove",
  REPLACE_DOCUMENT: "document/replace",
  UPDATE_OPTICS: "document/optics",
});

const EPSILON = 1e-9;
let runtimeId = 0;
const canonicalCubeStocks = new WeakSet();
const freezeJSON = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeJSON);
    Object.freeze(value);
  }
  return value;
};

function nextId(prefix) {
  runtimeId += 1;
  return `${prefix}-${runtimeId}`;
}

function clone(value) {
  // Share immutable geometry inputs without changing serialized property order.
  if (value?.kind === DOCUMENT_KIND && value.stock) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
      if (key === "stock" || key === "cuttingReference" && entry !== undefined) return [key, normalizeStock(entry)];
      if (key === "concaveCuts" && entry !== undefined) return [key, normalizeConcaveCuts(entry)];
      return [key, clone(entry)];
    }));
  }
  if (value?.document?.kind === DOCUMENT_KIND) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  }
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function assertFiniteNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
  return value;
}

function assertInteger(value, name) {
  assertFiniteNumber(value, name);
  if (!Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer.`);
  }
  return value;
}

function cleanNumber(value) {
  const rounded = Math.round(value * 1e12) / 1e12;
  return Object.is(rounded, -0) || Math.abs(rounded) < 1e-12 ? 0 : rounded;
}

function nearlyEqual(left, right, epsilon = EPSILON) {
  return (
    typeof left === "number" &&
    typeof right === "number" &&
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) <= epsilon
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback, name) {
  const resolved = value ?? fallback;
  if (typeof resolved !== "string" || resolved.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return resolved.trim();
}

export function normalizeIndex(index, indexTeeth = INDEX_TEETH) {
  assertFiniteNumber(index, "index");
  const teeth = normalizeIndexTeeth(indexTeeth);
  const normalized = cleanNumber(((index % teeth) + teeth) % teeth);
  return normalized === teeth ? 0 : normalized;
}

export function displayIndex(index, indexTeeth = INDEX_TEETH) {
  const normalized = normalizeIndex(index, indexTeeth);
  return normalized === 0 ? indexTeeth : normalized;
}

function isValidRepeatCount(repeat) {
  return Number.isInteger(repeat) && repeat > 0 && repeat <= 360;
}

function normalizeRepeatCount(repeat = 1) {
  assertInteger(repeat, "repeat");
  if (!isValidRepeatCount(repeat)) {
    throw new RangeError(
      "repeat must be an integer from 1 to 360.",
    );
  }
  return repeat;
}

function normalizeMirrorTeeth(mirror = 0, indexTeeth = INDEX_TEETH) {
  assertFiniteNumber(mirror, "mirror");
  const teeth = normalizeIndexTeeth(indexTeeth);
  if (mirror < 0) {
    throw new RangeError("mirror must be a non-negative tooth offset.");
  }
  const wrapped = mirror % teeth;
  return cleanNumber(Math.min(wrapped, teeth - wrapped));
}

/** Resolve the N undirected reflection axes of a dihedral tier. */
export function generateMirrorAxes({
  baseIndex = 0,
  base,
  repeat = 1,
  symmetry,
  mirror = 0,
  indexTeeth = INDEX_TEETH,
} = {}) {
  const teeth = normalizeIndexTeeth(indexTeeth);
  const resolvedBase = normalizeIndex(base ?? baseIndex, teeth);
  const resolvedRepeat = normalizeRepeatCount(symmetry ?? repeat);
  const resolvedMirror = normalizeMirrorTeeth(mirror, teeth);
  const axisStep = (teeth / 2) / resolvedRepeat;
  const axes = new Set();

  for (let ordinal = 0; ordinal < resolvedRepeat; ordinal += 1) {
    const raw = resolvedBase + resolvedMirror + ordinal * axisStep;
    const axis = cleanNumber(((raw % (teeth / 2)) + (teeth / 2)) % (teeth / 2));
    axes.add(axis);
  }

  return [...axes].sort((left, right) => left - right);
}

/**
 * Resolves a dihedral faceting tier.
 *
 * Rotation first creates N faces around the selected full wheel. Mirroring
 * then reflects the base face across N undirected axes distributed over a
 * half-turn. `mirror` rotates the whole axis family away from the base face;
 * zero therefore keeps the original N-face orbit, while a non-zero offset can
 * add a second N-face orbit. Coincident faces are de-duplicated.
 */
export function generateFacetIndices({
  baseIndex = 0,
  base,
  repeat = 1,
  symmetry,
  mirror = 0,
  indexTeeth = INDEX_TEETH,
} = {}) {
  const teeth = normalizeIndexTeeth(indexTeeth);
  const resolvedBase = normalizeIndex(base ?? baseIndex, teeth);
  const resolvedRepeat = normalizeRepeatCount(symmetry ?? repeat);
  const step = teeth / resolvedRepeat;
  const values = new Set();

  for (let ordinal = 0; ordinal < resolvedRepeat; ordinal += 1) {
    values.add(normalizeIndex(resolvedBase + ordinal * step, teeth));
  }

  const axes = generateMirrorAxes({
    baseIndex: resolvedBase,
    repeat: resolvedRepeat,
    mirror,
    indexTeeth: teeth,
  });
  for (const axis of axes) {
    values.add(normalizeIndex(2 * axis - resolvedBase, teeth));
  }

  return [...values].sort((left, right) => displayIndex(left, teeth) - displayIndex(right, teeth))
    .filter((value, index, sorted) => index === 0 || Math.abs(value - sorted[index - 1]) > EPSILON);
}

export function indexToAzimuthDeg(index, indexTeeth = INDEX_TEETH) {
  return cleanNumber(normalizeIndex(index, indexTeeth) * 360 / indexTeeth);
}

function indexToAzimuthRad(index, indexTeeth = INDEX_TEETH) {
  return (indexToAzimuthDeg(index, indexTeeth) * Math.PI) / 180;
}

export function normalizeRegion(region) {
  if (typeof region !== "string") {
    throw new TypeError("region must be crown, girdle, or pavilion.");
  }
  const normalized = region.trim().toLowerCase();
  if (!FACET_REGIONS.includes(normalized)) {
    throw new RangeError("region must be crown, girdle, or pavilion.");
  }
  return normalized;
}

function normalizeIndustryAngle(region, industryAngleDeg) {
  const resolvedRegion = normalizeRegion(region);
  const fallback = resolvedRegion === FACET_REGION.GIRDLE ? 90 : undefined;
  const angle = assertFiniteNumber(
    industryAngleDeg ?? fallback,
    "industryAngleDeg",
  );
  if (angle < 0 || angle > 90) {
    throw new RangeError("industryAngleDeg must be between 0 and 90 degrees.");
  }
  if (resolvedRegion === FACET_REGION.GIRDLE && !nearlyEqual(angle, 90)) {
    throw new RangeError("girdle facets are vertical and must use an industry angle of 90 degrees.");
  }
  return cleanNumber(angle);
}

/**
 * Converts the always-positive faceting-machine angle to signed geometry beta.
 * In this model +Z points toward the crown: crown is positive, girdle is 0,
 * and pavilion is negative.
 */
export function industryAngleToBetaDeg(region, industryAngleDeg) {
  const resolvedRegion = normalizeRegion(region);
  const angle = normalizeIndustryAngle(resolvedRegion, industryAngleDeg);
  if (resolvedRegion === FACET_REGION.GIRDLE) return 0;
  const complement = 90 - angle;
  return cleanNumber(
    resolvedRegion === FACET_REGION.CROWN ? complement : -complement,
  );
}

export function betaDegToIndustryAngle(region, betaDeg) {
  const resolvedRegion = normalizeRegion(region);
  const beta = assertFiniteNumber(betaDeg, "betaDeg");
  if (resolvedRegion === FACET_REGION.GIRDLE) {
    if (!nearlyEqual(beta, 0)) {
      throw new RangeError("girdle beta must be 0 degrees.");
    }
    return 90;
  }
  if (resolvedRegion === FACET_REGION.CROWN && (beta < 0 || beta > 90)) {
    throw new RangeError("crown beta must be between 0 and 90 degrees.");
  }
  if (resolvedRegion === FACET_REGION.PAVILION && (beta < -90 || beta > 0)) {
    throw new RangeError("pavilion beta must be between -90 and 0 degrees.");
  }
  return cleanNumber(90 - Math.abs(beta));
}

export function facetNormal(index, betaDeg, indexTeeth = INDEX_TEETH) {
  const azimuth = indexToAzimuthRad(index, indexTeeth);
  const beta = (assertFiniteNumber(betaDeg, "betaDeg") * Math.PI) / 180;
  const radial = Math.cos(beta);
  return {
    x: cleanNumber(radial * Math.cos(azimuth)),
    y: cleanNumber(radial * Math.sin(azimuth)),
    z: cleanNumber(Math.sin(beta)),
  };
}

export function normalizeStock(stock = DEFAULT_STOCK) {
  if (canonicalCubeStocks.has(stock)) return stock;
  if (!isPlainObject(stock)) {
    throw new TypeError("stock must be an object.");
  }
  const kind = stock.kind ?? stock.type ?? "cube";
  if (kind === "mesh") return normalizeMeshStock(stock);
  if (kind !== "cube") {
    throw new RangeError('stock.kind must be "cube" or "mesh".');
  }
  const size = assertFiniteNumber(stock.size ?? DEFAULT_STOCK.size, "stock.size");
  if (size <= 0) {
    throw new RangeError("stock.size must be greater than zero.");
  }
  const center = stock.center ?? DEFAULT_STOCK.center;
  if (
    !Array.isArray(center) ||
    center.length !== 3 ||
    center.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate))
  ) {
    throw new TypeError("stock.center must contain three finite numbers.");
  }
  const normalized = Object.freeze({
    kind: "cube",
    size: cleanNumber(size),
    center: Object.freeze(center.map(cleanNumber)),
    ...(stock.extensions === undefined ? {} : { extensions: freezeJSON(clone(stock.extensions)) }),
  });
  canonicalCubeStocks.add(normalized);
  return normalized;
}

/**
 * Support distance used by the faceting machine while the stock rotates about Z.
 *
 * A square XY cross-section has only four-fold symmetry. Using its directional
 * support for every index makes intermediate planes shallower and therefore
 * redundant (for example an 8-repeat tier collapses to 4 visible faces). The
 * machine instead references the inscribed rotational envelope: a cylinder of
 * radius size / 2 and half-height size / 2. Every azimuth in one tier then uses
 * the same center distance and remains an effective clipping plane.
 */
export function rotationalStockSupportOffset(normal, stock = DEFAULT_STOCK) {
  if (!isPlainObject(normal)) {
    throw new TypeError("normal must be an {x, y, z} object.");
  }
  const nx = assertFiniteNumber(normal.x, "normal.x");
  const ny = assertFiniteNumber(normal.y, "normal.y");
  const nz = assertFiniteNumber(normal.z, "normal.z");
  const resolvedStock = normalizeStock(stock);
  const half = resolvedStock.size / 2;
  const centerProjection =
    nx * resolvedStock.center[0] +
    ny * resolvedStock.center[1] +
    nz * resolvedStock.center[2];
  return cleanNumber(
    resolvedStock.kind === "mesh"
      ? centerProjection + resolvedStock.envelope.radius * Math.hypot(nx, ny) + resolvedStock.envelope.halfHeight * Math.abs(nz)
      : centerProjection + half * (Math.hypot(nx, ny) + Math.abs(nz)),
  );
}

export function facetToClippingPlane(facet, { stock = DEFAULT_STOCK } = {}) {
  if (!isPlainObject(facet)) {
    throw new TypeError("facet must be an object.");
  }
  const region = normalizeRegion(facet.region);
  const industryAngleDeg = normalizeIndustryAngle(
    region,
    facet.industryAngleDeg,
  );
  const betaDeg = industryAngleToBetaDeg(region, industryAngleDeg);
  const indexTeeth = normalizeIndexTeeth(facet.indexTeeth);
  const index = normalizeIndex(facet.index ?? facet.baseIndex ?? 0, indexTeeth);
  const depth = assertFiniteNumber(facet.depth ?? 0, "depth");
  if (depth < 0) {
    throw new RangeError("depth must be greater than or equal to zero.");
  }
  const normal = facetNormal(index, betaDeg, indexTeeth);
  const supportOffset = rotationalStockSupportOffset(normal, stock);
  const offset = cleanNumber(supportOffset - depth);
  return {
    normal,
    offset,
    keep: "less-than-or-equal",
  };
}

/** Translate resolved cutting planes vertically while preserving layer semantics. */
export function translateFacetsAlongZ(facets, deltaZ, { stock = DEFAULT_STOCK } = {}) {
  if (!Array.isArray(facets)) {
    throw new TypeError("facets must be an array.");
  }
  const shift = assertFiniteNumber(deltaZ, "deltaZ");
  return facets.map((facet) => {
    const normalZ = facetToClippingPlane(facet, { stock }).normal.z;
    const nextDepth = cleanNumber(facet.depth - normalZ * shift);
    if (nextDepth < 0) {
      throw new RangeError("vertical translation would move a cutting plane outside the rough stock.");
    }
    return resolveFacet({ ...facet, depth: nextDepth }, { stock });
  });
}

/** Scale resolved cutting planes along world Z around a fixed waist plane. */
export function scaleFacetsAlongZ(facets, scale, baseZ, { stock = DEFAULT_STOCK } = {}) {
  if (!Array.isArray(facets)) {
    throw new TypeError("facets must be an array.");
  }
  const factor = assertFiniteNumber(scale, "scale");
  const anchorZ = assertFiniteNumber(baseZ, "baseZ");
  if (factor <= 0) {
    throw new RangeError("scale must be greater than zero.");
  }

  return facets.map((facet) => {
    const plane = facetToClippingPlane(facet, { stock });
    const rawNormal = {
      x: plane.normal.x,
      y: plane.normal.y,
      z: plane.normal.z / factor,
    };
    const length = Math.hypot(rawNormal.x, rawNormal.y, rawNormal.z);
    const normal = {
      x: cleanNumber(rawNormal.x / length),
      y: cleanNumber(rawNormal.y / length),
      z: cleanNumber(rawNormal.z / length),
    };
    const rawOffset = plane.offset + plane.normal.z * anchorZ * (1 / factor - 1);
    const offset = cleanNumber(rawOffset / length);
    const betaDeg = cleanNumber(Math.atan2(normal.z, Math.hypot(normal.x, normal.y)) * 180 / Math.PI);
    const industryAngleDeg = betaDegToIndustryAngle(facet.region, betaDeg);
    const depth = cleanNumber(rotationalStockSupportOffset(normal, stock) - offset);
    if (depth < 0) {
      throw new RangeError("axial scale would move a cutting plane outside the rough stock.");
    }
    return resolveFacet({ ...facet, industryAngleDeg, depth }, { stock });
  });
}

/** Rotate by a tooth displacement on the selected wheel, preserving each layer's wheel. */
export function rotateFacetsByTeeth(facets, teeth, { stock = DEFAULT_STOCK, indexTeeth = INDEX_TEETH } = {}) {
  if (!Array.isArray(facets)) {
    throw new TypeError("facets must be an array.");
  }
  const step = assertFiniteNumber(teeth, "teeth");
  normalizeIndexTeeth(indexTeeth);
  return facets.map((facet) => {
    const facetTeeth = facet.indexTeeth ?? INDEX_TEETH;
    const facetStep = step * facetTeeth / indexTeeth;
    const metadata = facet.metadata && clone(facet.metadata);
    if (metadata?.primaryIndex !== undefined) metadata.primaryIndex = normalizeIndex(metadata.primaryIndex + facetStep, facetTeeth);
    if (metadata?.construction?.primaryIndex !== undefined) {
      metadata.construction.primaryIndex = normalizeIndex(metadata.construction.primaryIndex + facetStep, facetTeeth);
    }
    return resolveFacet({
      ...facet,
      ...(metadata ? { metadata } : {}),
      baseIndex: normalizeIndex(facet.baseIndex + facetStep, facetTeeth),
      index: normalizeIndex(facet.index + facetStep, facetTeeth),
    }, { stock });
  });
}

function defaultPatternId({ region, baseIndex, repeat, mirror, industryAngleDeg, depth, indexTeeth = INDEX_TEETH }) {
  return [
    "cut",
    region,
    displayIndex(baseIndex, indexTeeth),
    `r${repeat}`,
    `m${mirror}`,
    `a${industryAngleDeg}`,
    `d${depth}`,
    nextId("op"),
  ].join("-");
}

export function resolveFacet(facet, { stock = DEFAULT_STOCK } = {}) {
  if (!isPlainObject(facet)) {
    throw new TypeError("facet must be an object.");
  }
  const resolvedStock = normalizeStock(stock);
  const region = normalizeRegion(facet.region);
  const industryAngleDeg = normalizeIndustryAngle(
    region,
    facet.industryAngleDeg,
  );
  const betaDeg = industryAngleToBetaDeg(region, industryAngleDeg);
  const indexTeeth = normalizeIndexTeeth(facet.indexTeeth);
  const baseIndex = normalizeIndex(facet.baseIndex ?? facet.index ?? 0, indexTeeth);
  const repeat = normalizeRepeatCount(facet.repeat ?? facet.symmetry ?? 1);
  const mirror = normalizeMirrorTeeth(facet.mirror ?? 0, indexTeeth);
  const index = normalizeIndex(facet.index ?? baseIndex, indexTeeth);
  const depth = assertFiniteNumber(facet.depth ?? 0, "depth");
  if (depth < 0) {
    throw new RangeError("depth must be greater than or equal to zero.");
  }
  const patternId = normalizeString(
    facet.patternId ?? facet.groupId,
    defaultPatternId({
      region,
      indexTeeth,
      baseIndex,
      repeat,
      mirror,
      industryAngleDeg,
      depth,
    }),
    "patternId",
  );
  const id = normalizeString(
    facet.id,
    `${patternId}:${displayIndex(index, indexTeeth)}`,
    "facet.id",
  );
  const ordinal = facet.ordinal ?? 0;
  assertInteger(ordinal, "ordinal");
  if (ordinal < 0) {
    throw new RangeError("ordinal must be greater than or equal to zero.");
  }
  const plane = facetToClippingPlane(
    { region, industryAngleDeg, index, indexTeeth, depth },
    { stock: resolvedStock },
  );

  const resolved = {
    id,
    patternId,
    ordinal,
    region,
    ...(indexTeeth === INDEX_TEETH ? {} : { indexTeeth }),
    baseIndex,
    repeat,
    mirror,
    index,
    displayIndex: displayIndex(index, indexTeeth),
    azimuthDeg: indexToAzimuthDeg(index, indexTeeth),
    industryAngleDeg,
    betaDeg,
    depth: cleanNumber(depth),
    plane,
  };

  if (facet.extensions !== undefined) resolved.extensions = clone(facet.extensions);
  if (facet.label !== undefined) {
    resolved.label = String(facet.label);
  }
  if (isPlainObject(facet.metadata)) {
    resolved.metadata = clone(facet.metadata);
  }
  return resolved;
}

export function resolveFacetPattern(pattern, { stock = DEFAULT_STOCK } = {}) {
  if (!isPlainObject(pattern)) {
    throw new TypeError("pattern must be an object.");
  }
  const resolvedStock = normalizeStock(stock);
  const region = normalizeRegion(pattern.region);
  const industryAngleDeg = normalizeIndustryAngle(
    region,
    pattern.industryAngleDeg,
  );
  const indexTeeth = normalizeIndexTeeth(pattern.indexTeeth);
  const baseIndex = normalizeIndex(pattern.baseIndex ?? pattern.base ?? 0, indexTeeth);
  const repeat = normalizeRepeatCount(pattern.repeat ?? pattern.symmetry ?? 1);
  const mirror = normalizeMirrorTeeth(pattern.mirror ?? 0, indexTeeth);
  const depth = assertFiniteNumber(pattern.depth ?? 0, "depth");
  if (depth < 0) {
    throw new RangeError("depth must be greater than or equal to zero.");
  }
  const patternId = normalizeString(
    pattern.patternId ?? pattern.groupId ?? pattern.id,
    defaultPatternId({
      region,
      indexTeeth,
      baseIndex,
      repeat,
      mirror,
      industryAngleDeg,
      depth,
    }),
    "patternId",
  );
  const indices = generateFacetIndices({ baseIndex, repeat, mirror, indexTeeth });

  return indices.map((index, ordinal) =>
    resolveFacet(
      {
        id: `${patternId}:${displayIndex(index, indexTeeth)}`,
        patternId,
        ordinal,
        region,
        indexTeeth,
        baseIndex,
        repeat,
        mirror,
        index,
        industryAngleDeg,
        depth,
        label: pattern.label,
        metadata: pattern.metadata,
        ...(pattern.extensions === undefined ? {} : { extensions: pattern.extensions }),
      },
      { stock: resolvedStock },
    ),
  );
}

export function createFacetingDocument({
  name = "Untitled Facet Design",
  stock = DEFAULT_STOCK,
  facets = [],
  indexGear = INDEX_TEETH,
  concaveCuts,
  cuttingReference,
  metadata,
  extensions,
  schemaVersion = DOCUMENT_SCHEMA_VERSION,
} = {}) {
  const resolvedStock = normalizeStock(stock);
  if (!Array.isArray(facets)) {
    throw new TypeError("facets must be an array.");
  }
  const reference = cuttingReference === undefined ? resolvedStock : normalizeStock(cuttingReference);
  const resolvedGear = normalizeIndexGear(indexGear);
  const resolvedFacets = facets.map((facet) =>
    resolveFacet(facetOnIndexGear(facet, resolvedGear.teeth), { stock: reference }),
  );
  const document = {
    $schema: DOCUMENT_SCHEMA_ID,
    schemaVersion,
    kind: DOCUMENT_KIND,
    name: normalizeString(name, "Untitled Facet Design", "document.name"),
    indexGear: resolvedGear,
    stock: resolvedStock,
    ...(cuttingReference === undefined ? {} : { cuttingReference: reference }),
    facets: resolvedFacets,
    ...(extensions === undefined ? {} : { extensions: clone(extensions) }),
    ...(concaveCuts === undefined ? {} : { concaveCuts: normalizeConcaveCuts(concaveCuts) }),
  };
  if (isPlainObject(metadata)) {
    document.metadata = clone(metadata);
  }
  normalizeDocumentSchema(document);
  assertValidFacetingDocument(document);
  return document;
}

/** Fixed machine coordinates are independent of the optional physical blank.
 * Old documents retain their original reference until explicitly recreated. */
export function getCuttingReference(document) { return document.cuttingReference ?? document.stock; }

/** Canonicalize legacy mixed-wheel records while preserving the authored shape. */
export function withDocumentIndexGear(document, teeth = document.indexGear.teeth) {
  if (document.indexGear.teeth === teeth && document.facets.every(f => (f.indexTeeth ?? 96) === teeth)) return document;
  assertValidFacetingDocument(document);
  const facets = document.facets.map(facet => {
    const next = facetOnIndexGear(facet, teeth);
    return { ...next, displayIndex: displayIndex(next.index, teeth), azimuthDeg: indexToAzimuthDeg(next.index, teeth) };
  });
  const result = normalizeDocumentSchema({ ...document, indexGear: normalizeIndexGear(teeth), facets });
  assertValidFacetingDocument(result);
  return result;
}

/** Promote extended documents without rewriting legacy 96-wheel files. */
export function normalizeDocumentSchema(document) {
  const extended = document.schemaVersion === 3 || document.cuttingReference !== undefined || document.concaveCuts !== undefined
    || document.indexGear?.teeth !== INDEX_TEETH
    || document.facets.some((facet) => (facet.indexTeeth ?? INDEX_TEETH) !== INDEX_TEETH
      || !Number.isInteger(facet.index) || !Number.isInteger(facet.baseIndex)
      || !Number.isInteger(facet.mirror) || INDEX_TEETH % facet.repeat !== 0);
  document.schemaVersion = extended ? 3 : document.stock.kind === "mesh" ? 2 : 1;
  document.$schema = DOCUMENT_SCHEMA_ID.replace("v1", `v${document.schemaVersion}`);
  if (extended && document.concaveCuts === undefined) document.concaveCuts = [];
  // Keep recipe data for recovery, but never claim it still describes edited planes.
  const refreshed = refreshLabRecipe(document);
  if (refreshed !== document) document.metadata = refreshed.metadata;
  return document;
}

function addValidationError(errors, path, message) {
  errors.push({ path, message });
}

function isCanonicalStock(stock) {
  return (
    isPlainObject(stock) &&
    stock.kind === "cube" &&
    typeof stock.size === "number" &&
    Number.isFinite(stock.size) &&
    stock.size > 0 &&
    Array.isArray(stock.center) &&
    stock.center.length === 3 &&
    stock.center.every((coordinate) =>
      typeof coordinate === "number" && Number.isFinite(coordinate),
    )
  );
}

function validateMeetTarget(target, path, errors, allowEdge = true) {
  if (!isPlainObject(target)) {
    addValidationError(errors, path, "must be a Meet target object");
    return;
  }
  if (typeof target.topologyKey !== "string" || !target.topologyKey) {
    addValidationError(errors, `${path}.topologyKey`, "must be a non-empty string");
  }
  for (const key of ["sourceFaceIds", "sourceOperationIds"]) {
    if (!Array.isArray(target[key]) || target[key].length === 0
      || !target[key].every((value) => typeof value === "string" && value.length > 0)
      || new Set(target[key]).size !== target[key].length) {
      addValidationError(errors, `${path}.${key}`, "must be a non-empty array of unique source identifiers");
    }
  }
  if (typeof target.sourceGeometrySignature !== "string" || !target.sourceGeometrySignature) {
    addValidationError(errors, `${path}.sourceGeometrySignature`, "must be a non-empty string");
  }
  if (!Array.isArray(target.fallbackWorldPoint) || target.fallbackWorldPoint.length !== 3
    || !target.fallbackWorldPoint.every(Number.isFinite)) {
    addValidationError(errors, `${path}.fallbackWorldPoint`, "must contain three finite coordinates");
  }
  if (target.kind !== undefined && target.kind !== "vertex" && target.kind !== "edge-point") {
    addValidationError(errors, `${path}.kind`, "must identify a vertex or edge-point");
  }
  if (target.kind === "edge-point") {
    if (!allowEdge) {
      addValidationError(errors, path, "must be a vertex target");
      return;
    }
    if (!Number.isFinite(target.ratio) || target.ratio < 0 || target.ratio > 1) {
      addValidationError(errors, `${path}.ratio`, "must be a finite ratio from 0 to 1");
    }
    if (typeof target.edgeTopologyKey !== "string" || !target.edgeTopologyKey) {
      addValidationError(errors, `${path}.edgeTopologyKey`, "must identify the source edge");
    }
    if (!Array.isArray(target.endpoints) || target.endpoints.length !== 2) {
      addValidationError(errors, `${path}.endpoints`, "must contain two vertex targets");
    } else {
      target.endpoints.forEach((endpoint, index) => validateMeetTarget(endpoint, `${path}.endpoints[${index}]`, errors, false));
      if (target.endpoints[0]?.topologyKey === target.endpoints[1]?.topologyKey) {
        addValidationError(errors, `${path}.endpoints`, "must identify two distinct vertices");
      }
      const [start, end] = target.endpoints;
      if (typeof start?.topologyKey === "string" && typeof end?.topologyKey === "string") {
        const edgeKey = `edge:${[start.topologyKey, end.topologyKey].map(encodeURIComponent).join("|")}`;
        if (start.topologyKey >= end.topologyKey || target.edgeTopologyKey !== edgeKey
          || target.topologyKey !== `${edgeKey}@${target.ratio}`) {
          addValidationError(errors, `${path}.edgeTopologyKey`, "must preserve the ordered endpoint identities and ratio");
        }
      }
      if ([start?.fallbackWorldPoint, end?.fallbackWorldPoint, target.fallbackWorldPoint]
        .every((point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite))) {
        if (target.fallbackWorldPoint.some((value, axis) => Math.abs(value - (
          start.fallbackWorldPoint[axis] + (end.fallbackWorldPoint[axis] - start.fallbackWorldPoint[axis]) * target.ratio
        )) > 1e-7)) addValidationError(errors, `${path}.fallbackWorldPoint`, "must match the endpoint ratio");
      }

    }
  }
}

function validateMeetConstruction(construction, path, errors, indexTeeth = INDEX_TEETH) {
  if (!isPlainObject(construction)) {
    addValidationError(errors, path, "must be a Meet construction object");
    return;
  }
  const legacy = construction.solverVersion === 1;
  if (![1, 2].includes(construction.solverVersion)) addValidationError(errors, `${path}.solverVersion`, "must be 1 or 2");
  const types = legacy ? ["vertex-meet"] : ["vertex-meet", "edge-meet", "dual-meet"];
  if (!types.includes(construction.type)) addValidationError(errors, `${path}.type`, "must match the solver version and target kind");
  validateMeetTarget(construction.target, `${path}.target`, errors, !legacy);
  if (!legacy && (!Number.isFinite(construction.primaryIndex) || construction.primaryIndex < 0 || construction.primaryIndex >= indexTeeth)) {
    addValidationError(errors, `${path}.primaryIndex`, `must be a finite index from 0 up to ${indexTeeth}`);
  }
  if (construction.type === "dual-meet") {
    validateMeetTarget(construction.secondTarget, `${path}.secondTarget`, errors);
  } else if (construction.secondTarget !== undefined) {
    addValidationError(errors, `${path}.secondTarget`, "is only supported by dual-meet");
  }
  if (construction.type === "edge-meet" && construction.target?.kind !== "edge-point") {
    addValidationError(errors, `${path}.target.kind`, "must be edge-point for edge-meet");
  }
  if (construction.type === "vertex-meet" && construction.target?.kind === "edge-point") {
    addValidationError(errors, `${path}.target.kind`, "must identify a vertex for vertex-meet");
  }
}

function validateResolvedFacet(facet, path, stock, errors) {
  if (!isPlainObject(facet)) {
    addValidationError(errors, path, "must be an object");
    return;
  }
  const indexTeeth = facet.indexTeeth ?? INDEX_TEETH;
  const validTeeth = Number.isInteger(indexTeeth) && indexTeeth >= 1 && indexTeeth <= 360;
  if (!validTeeth) addValidationError(errors, `${path}.indexTeeth`, "must be an integer from 1 to 360");
  const canonicalIndex = (index) => Number.isFinite(index) && index >= 0 && index < indexTeeth;
  const required = [
    "id",
    "patternId",
    "ordinal",
    "region",
    "baseIndex",
    "repeat",
    "mirror",
    "index",
    "displayIndex",
    "azimuthDeg",
    "industryAngleDeg",
    "betaDeg",
    "depth",
    "plane",
  ];
  for (const key of required) {
    if (!(key in facet)) {
      addValidationError(errors, `${path}.${key}`, "is required");
    }
  }
  if (typeof facet.id !== "string" || facet.id.trim() === "") {
    addValidationError(errors, `${path}.id`, "must be a non-empty string");
  }
  if (typeof facet.patternId !== "string" || facet.patternId.trim() === "") {
    addValidationError(errors, `${path}.patternId`, "must be a non-empty string");
  }
  if (!Number.isInteger(facet.ordinal) || facet.ordinal < 0) {
    addValidationError(errors, `${path}.ordinal`, "must be a non-negative integer");
  }
  if (!FACET_REGIONS.includes(facet.region)) {
    addValidationError(errors, `${path}.region`, "must be crown, girdle, or pavilion");
  }
  if (!canonicalIndex(facet.baseIndex)) {
    addValidationError(errors, `${path}.baseIndex`, `must be a finite canonical index from 0 up to ${indexTeeth}`);
  }
  if (!isValidRepeatCount(facet.repeat)) {
    addValidationError(errors, `${path}.repeat`, "must be an integer from 1 to 360");
  }
  if (!Number.isFinite(facet.mirror) || facet.mirror < 0 || facet.mirror > indexTeeth / 2) {
    addValidationError(errors, `${path}.mirror`, `must be finite from 0 to ${indexTeeth / 2}`);
  }
  if (!canonicalIndex(facet.index)) {
    addValidationError(errors, `${path}.index`, `must be a finite canonical index from 0 up to ${indexTeeth}`);
  }
  if (
    validTeeth && canonicalIndex(facet.index) &&
    !nearlyEqual(facet.displayIndex, displayIndex(facet.index, indexTeeth))
  ) {
    addValidationError(errors, `${path}.displayIndex`, "does not match the resolved index alias");
  }
  if (
    validTeeth && canonicalIndex(facet.index) &&
    !nearlyEqual(facet.azimuthDeg, indexToAzimuthDeg(facet.index, indexTeeth))
  ) {
    addValidationError(errors, `${path}.azimuthDeg`, "does not match the resolved index azimuth");
  }
  if (typeof facet.depth !== "number" || !Number.isFinite(facet.depth) || facet.depth < 0) {
    addValidationError(errors, `${path}.depth`, "must be a non-negative finite number");
  }
  if (facet.metadata?.construction !== undefined) {
    validateMeetConstruction(facet.metadata.construction, `${path}.metadata.construction`, errors, indexTeeth);
    if (facet.region !== FACET_REGION.CROWN && facet.region !== FACET_REGION.PAVILION) {
      addValidationError(errors, `${path}.metadata.construction`, "is supported only on crown or pavilion facets");
    }
    if (!["symmetric", "arbitrary"].includes(facet.metadata?.patternMode)
      || (facet.metadata.construction?.solverVersion === 1 && facet.metadata?.patternMode !== "symmetric")) {
      addValidationError(errors, `${path}.metadata.patternMode`, "must be symmetric, or arbitrary with solverVersion 2");
    }
    if (facet.metadata?.operationType === "table") {
      addValidationError(errors, `${path}.metadata.construction`, "is not supported on the fixed table");
    }
  }

  if (facet.metadata?.primaryIndex !== undefined && (!canonicalIndex(facet.metadata.primaryIndex))) {
    addValidationError(errors, `${path}.metadata.primaryIndex`, `must be a finite index from 0 up to ${indexTeeth}`);
  }
  if (facet.metadata?.preform !== undefined) {
    if (typeof facet.metadata.preform !== "boolean") addValidationError(errors, `${path}.metadata.preform`, "must be boolean");
    if (![FACET_REGION.CROWN, FACET_REGION.PAVILION].includes(facet.region)
      || facet.metadata.operationType === "table") {
      addValidationError(errors, `${path}.metadata.preform`, "is supported only on ordinary crown or pavilion layers");
    }
  }

  const primitivesValid =
    FACET_REGIONS.includes(facet.region) &&
    validTeeth && canonicalIndex(facet.baseIndex) &&
    isValidRepeatCount(facet.repeat) &&
    Number.isFinite(facet.mirror) &&
    facet.mirror >= 0 &&
    facet.mirror <= indexTeeth / 2 &&
    validTeeth && canonicalIndex(facet.index) &&
    typeof facet.industryAngleDeg === "number" &&
    Number.isFinite(facet.industryAngleDeg) &&
    typeof facet.depth === "number" &&
    Number.isFinite(facet.depth) &&
    facet.depth >= 0;

  if (!primitivesValid) {
    if (
      typeof facet.industryAngleDeg !== "number" ||
      !Number.isFinite(facet.industryAngleDeg)
    ) {
      addValidationError(errors, `${path}.industryAngleDeg`, "must be a finite number");
    }
    return;
  }

  let expected;
  try {
    expected = resolveFacet(
      {
        ...facet,
        id: facet.id || "validation-facet",
        patternId: facet.patternId || "validation-pattern",
      },
      { stock },
    );
  } catch (error) {
    addValidationError(errors, path, error.message);
    return;
  }

  let generatedIndices;
  try {
    generatedIndices = generateFacetIndices({
      baseIndex: facet.baseIndex,
      repeat: facet.repeat,
      mirror: facet.mirror,
      indexTeeth,
    });
  } catch {
    generatedIndices = [];
  }
  if (!generatedIndices.some((index) => nearlyEqual(index, facet.index))) {
    addValidationError(errors, `${path}.index`, "is not produced by baseIndex/repeat/mirror");
  }
  if (!nearlyEqual(facet.betaDeg, expected.betaDeg)) {
    addValidationError(errors, `${path}.betaDeg`, "does not match region and industry angle");
  }
  if (!isPlainObject(facet.plane)) {
    addValidationError(errors, `${path}.plane`, "must be an explicit clipping plane object");
    return;
  }
  if (facet.plane.keep !== "less-than-or-equal") {
    addValidationError(errors, `${path}.plane.keep`, 'must be "less-than-or-equal"');
  }
  if (!isPlainObject(facet.plane.normal)) {
    addValidationError(errors, `${path}.plane.normal`, "must be an {x, y, z} object");
    return;
  }
  for (const component of ["x", "y", "z"]) {
    if (!nearlyEqual(facet.plane.normal[component], expected.plane.normal[component])) {
      addValidationError(
        errors,
        `${path}.plane.normal.${component}`,
        "does not match the resolved facet normal",
      );
    }
  }
  if (!nearlyEqual(facet.plane.offset, expected.plane.offset)) {
    addValidationError(errors, `${path}.plane.offset`, "does not match rotational stock support minus depth");
  }
}

export function validateFacetingDocument(document) {
  const errors = [];
  if (!isPlainObject(document)) {
    return {
      valid: false,
      errors: [{ path: "$", message: "document must be an object" }],
    };
  }
  errors.push(...validateDocumentHeader(document), ...validateDocumentExtensions(document));
  try {
    const gear = normalizeIndexGear(document.indexGear);
    if (!isPlainObject(document.indexGear) || gear.zeroAlias !== document.indexGear.zeroAlias
      || !nearlyEqual(gear.degreesPerTooth, document.indexGear.degreesPerTooth)
      || (document.schemaVersion !== 3 && gear.teeth !== INDEX_TEETH)) throw new Error();
  } catch { addValidationError(errors, "$.indexGear", "must describe a supported integer-tooth gear (legacy documents require 96)"); }
  if (document.schemaVersion !== 3 && (document.concaveCuts !== undefined || (Array.isArray(document.facets) && document.facets.some((facet) =>
    facet && ((facet.indexTeeth ?? INDEX_TEETH) !== INDEX_TEETH || !Number.isInteger(facet.index)
      || !Number.isInteger(facet.baseIndex) || !Number.isInteger(facet.mirror) || INDEX_TEETH % facet.repeat !== 0))))) {
    addValidationError(errors, "$.schemaVersion", "extended indices and concave cuts require schema version 3");
  }
  if (document.schemaVersion === 3) {
    if (!Array.isArray(document.concaveCuts)) {
      addValidationError(errors, "$.concaveCuts", "must be an independent array in schema version 3");
    } else {
      try { normalizeConcaveCuts(document.concaveCuts); } catch (error) {
        addValidationError(errors, "$.concaveCuts", error.message);
      }
    }
  }
  let validatedStock;
  try { validatedStock = normalizeStock(document.stock); } catch { /* reported below */ }
  if (!validatedStock || (document.stock?.kind !== "mesh" && !isCanonicalStock(document.stock))) {
    addValidationError(errors, "$.stock", "must define a valid cube or closed oriented mesh stock");
    validatedStock = null;
  }
  let validatedReference = validatedStock;
  if (document.cuttingReference !== undefined) {
    try { validatedReference = normalizeStock(document.cuttingReference); }
    catch { addValidationError(errors, "$.cuttingReference", "must define a valid fixed machine reference"); }
  }
  if (!Array.isArray(document.facets)) {
    addValidationError(errors, "$.facets", "must be an array");
  } else if (validatedStock) {
    const ids = new Set();
    const patternFacets = new Map();
    document.facets.forEach((facet, index) => {
      validateResolvedFacet(facet, `$.facets[${index}]`, validatedReference, errors);
      if (isPlainObject(facet) && typeof facet.patternId === "string") {
        if (!patternFacets.has(facet.patternId)) patternFacets.set(facet.patternId, []);
        patternFacets.get(facet.patternId).push({ facet, index });
      }
      if (isPlainObject(facet) && typeof facet.id === "string") {
        if (ids.has(facet.id)) {
          addValidationError(errors, `$.facets[${index}].id`, "must be unique");
        }
        ids.add(facet.id);
      }
    });
    if (Array.isArray(document.concaveCuts)) {
      document.concaveCuts.forEach((cut, index) => {
        if (cut && patternFacets.has(cut.id)) {
          addValidationError(errors, `$.concaveCuts[${index}].id`, "must not collide with a planar pattern id");
        }
      });
    }
    patternFacets.forEach((entries) => {
      const indexTeeth = entries[0].facet.indexTeeth ?? INDEX_TEETH;
      entries.forEach(({ facet, index }) => {
        if ((facet.indexTeeth ?? INDEX_TEETH) !== indexTeeth) addValidationError(errors, `$.facets[${index}].indexTeeth`, "must match every facet in the pattern");
      });
      const preform = entries[0].facet.metadata?.preform ?? false;
      entries.forEach(({ facet, index }) => {
        if ((facet.metadata?.preform ?? false) !== preform) {
          addValidationError(errors, `$.facets[${index}].metadata.preform`, "must match every facet in the pattern");
        }
      });
      const selectedPrimary = entries[0].facet.metadata?.primaryIndex;
      entries.forEach(({ facet, index }) => {
        if (facet.metadata?.primaryIndex !== selectedPrimary) {
          addValidationError(errors, `$.facets[${index}].metadata.primaryIndex`, "must match every facet in the pattern");
        }
      });
      if (selectedPrimary !== undefined && !entries.some(({ facet }) => facet.index === selectedPrimary)) {
        addValidationError(errors, `$.facets[${entries[0].index}].metadata.primaryIndex`, "must belong to the pattern index set");
      }
      const constructions = entries.map(({ facet }) => facet.metadata?.construction);
      const annotated = constructions.filter((construction) => construction !== undefined);
      if (annotated.length === 0) return;
      if (annotated.length !== entries.length) {
        entries.forEach(({ facet, index }) => {
          if (facet.metadata?.construction === undefined) {
            addValidationError(errors, `$.facets[${index}].metadata.construction`, "must be present on every facet in the pattern");
          }
        });
        return;
      }
      const targetFingerprint = (target) => target && [target.kind, target.topologyKey, target.sourceFaceIds,
        target.sourceOperationIds, target.sourceGeometrySignature, target.fallbackWorldPoint,
        target.edgeTopologyKey, target.ratio, Array.isArray(target.endpoints) ? target.endpoints.map(targetFingerprint) : target.endpoints];
      const fingerprint = (construction) => JSON.stringify([construction?.type, construction?.solverVersion,
        construction?.primaryIndex, targetFingerprint(construction?.target), targetFingerprint(construction?.secondTarget)]);
      const primaryIndex = annotated[0]?.primaryIndex;
      if (selectedPrimary !== undefined && primaryIndex !== undefined && selectedPrimary !== primaryIndex) {
        addValidationError(errors, `$.facets[${entries[0].index}].metadata.primaryIndex`, "must match the Meet primaryIndex");
      }
      if (annotated[0]?.solverVersion === 2 && !entries.some(({ facet }) => facet.index === primaryIndex)) {
        addValidationError(errors, `$.facets[${entries[0].index}].metadata.construction.primaryIndex`, "must belong to the pattern index set");
      }
      const expected = fingerprint(annotated[0]);
      entries.forEach(({ facet, index }) => {
        if (fingerprint(facet.metadata.construction) !== expected) {
          addValidationError(errors, `$.facets[${index}].metadata.construction`, "must match every facet in the pattern");
        }
      });
    });
  }
  return { valid: errors.length === 0, errors };
}

export class FacetingDocumentValidationError extends Error {
  constructor(errors, message = "Invalid Facet-96 document.") {
    super(message);
    this.name = "FacetingDocumentValidationError";
    this.errors = errors;
  }
}

function assertValidFacetingDocument(document) {
  const result = validateFacetingDocument(document);
  if (!result.valid) {
    throw new FacetingDocumentValidationError(result.errors);
  }
  return document;
}

function migrateLegacyFacetGeometry(document) {
  const validation = validateFacetingDocument(document);
  const onlyLegacyGeometry =
    validation.errors.length > 0 &&
    validation.errors.every((error) =>
      error.path.endsWith(".betaDeg") ||
      error.path.endsWith(".plane.normal.z") ||
      error.path.endsWith(".plane.offset")
    );
  if (!onlyLegacyGeometry) return document;
  return {
    ...document,
    facets: document.facets.map((facet) => resolveFacet(facet, { stock: getCuttingReference(document) })),
  };
}

export function exportFacetingJSON(document, { pretty = true } = {}) {
  const normalizedDocument = refreshLabRecipe(withDocumentIndexGear(migrateLegacyFacetGeometry(document)));
  assertValidFacetingDocument(normalizedDocument);
  return JSON.stringify({ ...normalizedDocument, machining: indexExportSummary(normalizedDocument) }, null, pretty ? 2 : 0);
}

export function importFacetingJSON(json) {
  let parsed;
  try {
    parsed = typeof json === "string" ? JSON.parse(json) : clone(json);
  } catch (error) {
    throw new FacetingDocumentValidationError(
      [{ path: "$", message: `invalid JSON: ${error.message}` }],
      "Could not parse Facet-96 JSON.",
    );
  }
  if (isPlainObject(parsed)) {
    if (parsed.stock === undefined) parsed.stock = DEFAULT_STOCK;
    if (parsed.indexGear === undefined) parsed.indexGear = normalizeIndexGear(96);
    if (parsed.schemaVersion === 3 && parsed.concaveCuts === undefined) parsed.concaveCuts = [];
    delete parsed.machining; // Always derive compatibility from actual planar normals.
  }
  if (parsed?.stock?.kind === "mesh") {
    try { parsed.stock = normalizeMeshStock(parsed.stock); } catch (error) {
      throw new FacetingDocumentValidationError([{ path: "$.stock", message: error.message }]);
    }
  }
  const normalizedDocument = migrateLegacyFacetGeometry(parsed);
  assertValidFacetingDocument(normalizedDocument);
  normalizedDocument.$schema = DOCUMENT_SCHEMA_ID.replace("v1", `v${normalizedDocument.schemaVersion}`);
  const result = clone(refreshLabRecipe(normalizedDocument));
  if (result.concaveCuts !== undefined) result.concaveCuts = normalizeConcaveCuts(result.concaveCuts);
  if (result.stock.kind === "mesh") {
    result.stock = normalizeMeshStock(result.stock);
    try {
      const solid = clipPolyhedronByPlanes(getMeshStockSolid(result.stock), result.facets.map(facet => ({
        ...facet.plane, faceId: facet.id, operationId: facet.patternId, region: facet.region,
        operationType: facet.metadata?.operationType,
      })));
      if (!solid.vertices.length) throw new Error("切割序列移除了全部材料。");
    } catch (error) {
      throw new FacetingDocumentValidationError([{ path: "$.facets", message: `无法重放晶体切割：${error.message}` }]);
    }
  }
  return withDocumentIndexGear(result);
}

function createCommand(type, payload) {
  return {
    id: nextId("command"),
    type,
    payload: clone(payload),
  };
}

export function createAddFacetsCommand(facets) {
  if (!Array.isArray(facets)) {
    throw new TypeError("facets must be an array.");
  }
  return createCommand(COMMAND_TYPE.ADD_FACETS, { facets });
}

export function createReplacePatternCommand(patternId, facets) {
  if (!Array.isArray(facets) || facets.length === 0) {
    throw new RangeError("facets must contain at least one facet.");
  }
  return createCommand(COMMAND_TYPE.REPLACE_PATTERN, {
    patternId: normalizeString(patternId, undefined, "patternId"),
    facets,
  });
}

/** Replace one operation's resolved faces without changing its sequence slot. */
export function replacePatternFacets(facets, patternId, replacements) {
  if (!Array.isArray(facets) || !Array.isArray(replacements)) {
    throw new TypeError("facets and replacements must be arrays.");
  }
  const firstIndex = facets.findIndex((facet) => facet.patternId === patternId);
  if (firstIndex < 0) return facets.slice();
  const next = facets.filter((facet) => facet.patternId !== patternId);
  next.splice(firstIndex, 0, ...replacements);
  return next;
}

export function createRemoveFacetsCommand(facetIds) {
  const ids = Array.isArray(facetIds) ? facetIds : [facetIds];
  if (ids.length === 0) {
    throw new RangeError("facetIds must contain at least one id.");
  }
  return createCommand(COMMAND_TYPE.REMOVE_FACETS, {
    facetIds: ids.map((id) => normalizeString(id, undefined, "facetId")),
  });
}

export function createReplaceDocumentCommand(document, { description } = {}) {
  assertValidFacetingDocument(document);
  return createCommand(COMMAND_TYPE.REPLACE_DOCUMENT, { document, description });
}

export function createUpdateOpticsCommand(optics) {
  return createCommand(COMMAND_TYPE.UPDATE_OPTICS, { optics, description: "更新光学材质与计算参数" });
}

function normalizeCommand(command) {
  if (!isPlainObject(command) || typeof command.type !== "string") {
    throw new TypeError("command must have a string type.");
  }
  if (!Object.values(COMMAND_TYPE).includes(command.type)) {
    throw new RangeError(`Unsupported command type: ${command.type}`);
  }
  const id = normalizeString(command.id, nextId("command"), "command.id");
  const payload = isPlainObject(command.payload) ? clone(command.payload) : {};

  // Commands own any generated identity so replay never creates different
  // facet ids merely because the author omitted an optional pattern id.
  if (command.type === COMMAND_TYPE.ADD_FACETS && Array.isArray(payload.facets)) {
    payload.facets = payload.facets.map((facet, index) => {
      if (!isPlainObject(facet)) return facet;
      const patternId =
        facet.patternId ?? facet.groupId ?? `${id}:pattern:${index}`;
      const resolvedIndex = normalizeIndex(facet.index ?? facet.baseIndex ?? 0, facet.indexTeeth);
      return {
        ...facet,
        id: facet.id ?? `${patternId}:${displayIndex(resolvedIndex, facet.indexTeeth)}`,
        patternId,
      };
    });
  }
  if (command.type === COMMAND_TYPE.REPLACE_PATTERN && Array.isArray(payload.facets)) {
    payload.facets = payload.facets.map((facet, index) => {
      if (!isPlainObject(facet)) return facet;
      const resolvedIndex = normalizeIndex(facet.index ?? facet.baseIndex ?? 0, facet.indexTeeth);
      return {
        ...facet,
        id: facet.id ?? `${payload.patternId}:${displayIndex(resolvedIndex, facet.indexTeeth)}`,
        patternId: payload.patternId,
      };
    });
  }

  return { id, type: command.type, payload };
}

export function applyFacetingCommand(document, command) {
  assertValidFacetingDocument(document);
  const normalized = normalizeCommand(command);
  const { type, payload } = normalized;

  if (type === COMMAND_TYPE.UPDATE_OPTICS) {
    return { ...document, metadata: { ...document.metadata, optics: payload.optics } };
  }

  if (type === COMMAND_TYPE.REPLACE_DOCUMENT) {
    assertValidFacetingDocument(payload.document);
    return clone(refreshLabRecipe(withDocumentIndexGear(payload.document)));
  }
  if (type === COMMAND_TYPE.ADD_FACETS) {
    if (!Array.isArray(payload.facets)) {
      throw new TypeError("facets/add payload.facets must be an array.");
    }
    const additions = payload.facets.map((facet) =>
      resolveFacet(facetOnIndexGear(facet, document.indexGear.teeth), { stock: getCuttingReference(document) }),
    );
    return appendFacets(document, additions);
  }
  if (type === COMMAND_TYPE.REPLACE_PATTERN) {
    const firstIndex = document.facets.findIndex((facet) => facet.patternId === payload.patternId);
    if (firstIndex < 0) throw new RangeError(`Unknown pattern id: ${payload.patternId}`);
    const replacements = payload.facets.map((facet) => resolveFacet(facetOnIndexGear({
      ...facet,
      patternId: payload.patternId,
    }, document.indexGear.teeth), { stock: getCuttingReference(document) }));
    const facets = replacePatternFacets(document.facets, payload.patternId, replacements);
    const next = normalizeDocumentSchema({ ...document, facets });
    assertValidFacetingDocument(next);
    return next;
  }
  if (type === COMMAND_TYPE.REMOVE_FACETS) {
    if (!Array.isArray(payload.facetIds)) {
      throw new TypeError("facets/remove payload.facetIds must be an array.");
    }
    const ids = new Set(payload.facetIds);
    return normalizeDocumentSchema({
      ...document,
      facets: document.facets.filter((facet) => !ids.has(facet.id)),
    });
  }
  throw new RangeError(`Unsupported command type: ${type}`);
}

function appendFacets(document, additions) {
  const ids = new Set(document.facets.map((facet) => facet.id));
  for (const facet of additions) {
    if (ids.has(facet.id)) {
      throw new RangeError(`Duplicate facet id: ${facet.id}`);
    }
    ids.add(facet.id);
  }
  const next = normalizeDocumentSchema({ ...document, facets: [...document.facets, ...additions] });
  assertValidFacetingDocument(next);
  return next;
}

export function replayFacetingCommands(
  initialDocument,
  commands,
  cursor = commands?.length ?? 0,
) {
  assertValidFacetingDocument(initialDocument);
  if (!Array.isArray(commands)) {
    throw new TypeError("commands must be an array.");
  }
  assertInteger(cursor, "cursor");
  if (cursor < 0 || cursor > commands.length) {
    throw new RangeError("cursor is outside the command list.");
  }
  let present = clone(initialDocument);
  for (let index = 0; index < cursor; index += 1) {
    present = applyFacetingCommand(present, commands[index]);
  }
  return present;
}

export function createCommandHistory(initialDocument = createFacetingDocument()) {
  initialDocument = withDocumentIndexGear(initialDocument);
  assertValidFacetingDocument(initialDocument);
  const initial = clone(initialDocument);
  if (initial.stock.kind === "mesh") initial.stock = normalizeMeshStock(initial.stock);
  return {
    initial,
    commands: [],
    cursor: 0,
    present: initial.stock.kind === "mesh" ? { ...initial, facets: clone(initial.facets) } : clone(initial),
  };
}

export function executeFacetingCommand(history, command) {
  assertHistory(history);
  const normalizedCommand = normalizeCommand(command);
  const commands = [
    ...history.commands.slice(0, history.cursor),
    normalizedCommand,
  ];
  const cursor = commands.length;
  return {
    initial: history.initial,
    commands,
    cursor,
    present: applyFacetingCommand(history.present, normalizedCommand),
  };
}

export function undoFacetingCommand(history) {
  assertHistory(history);
  if (history.cursor === 0) return history;
  const cursor = history.cursor - 1;
  return {
    initial: history.initial,
    commands: history.commands,
    cursor,
    present: replayFacetingCommands(history.initial, history.commands, cursor),
  };
}

export function redoFacetingCommand(history) {
  assertHistory(history);
  if (history.cursor >= history.commands.length) return history;
  const cursor = history.cursor + 1;
  return {
    initial: history.initial,
    commands: history.commands,
    cursor,
    present: replayFacetingCommands(history.initial, history.commands, cursor),
  };
}

export function canUndo(history) {
  return history.cursor > 0;
}

export function canRedo(history) {
  return history.cursor < history.commands.length;
}

function assertHistory(history) {
  if (
    !isPlainObject(history) ||
    !Array.isArray(history.commands) ||
    !Number.isInteger(history.cursor) ||
    history.cursor < 0 ||
    history.cursor > history.commands.length
  ) {
    throw new TypeError("history must be a valid immutable command history.");
  }
  assertValidFacetingDocument(history.initial);
  assertValidFacetingDocument(history.present);
  return history;
}
