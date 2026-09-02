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

const INDEX_TEETH = 96;
const INDEX_ZERO_ALIAS = 96;
const DEGREES_PER_TOOTH = 360 / INDEX_TEETH;
export const VALID_REPEAT_COUNTS = Object.freeze(
  Array.from({ length: INDEX_TEETH }, (_, index) => index + 1).filter(
    (count) => INDEX_TEETH % count === 0,
  ),
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
const DOCUMENT_SCHEMA_ID = "urn:opengemcutting:facet-96:document:v1";
const LEGACY_DOCUMENT_SCHEMA_ID =
  "https://schemas." + "openai.local/facet-96/document-v1.schema.json";

export const DEFAULT_STOCK = Object.freeze({
  kind: "cube",
  size: 2,
  center: Object.freeze([0, 0, 0]),
});

const COMMAND_TYPE = Object.freeze({
  ADD_PATTERN: "pattern/add",
  REPLACE_PATTERN: "pattern/replace",
  ADD_FACETS: "facets/add",
  UPDATE_FACET: "facet/update",
  REMOVE_FACETS: "facets/remove",
  REPLACE_DOCUMENT: "document/replace",
});

const EPSILON = 1e-9;
let runtimeId = 0;

function nextId(prefix) {
  runtimeId += 1;
  return `${prefix}-${runtimeId}`;
}

function clone(value) {
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

export function normalizeIndex(index) {
  assertInteger(index, "index");
  return ((index % INDEX_TEETH) + INDEX_TEETH) % INDEX_TEETH;
}

export function displayIndex(index) {
  const normalized = normalizeIndex(index);
  return normalized === 0 ? INDEX_ZERO_ALIAS : normalized;
}

export function displayToIndex(index) {
  assertInteger(index, "display index");
  if (index < 1 || index > INDEX_ZERO_ALIAS) {
    throw new RangeError(`display index must be between 1 and ${INDEX_ZERO_ALIAS}.`);
  }
  return normalizeIndex(index);
}

function isValidRepeatCount(repeat) {
  return Number.isInteger(repeat) && repeat > 0 && INDEX_TEETH % repeat === 0;
}

function normalizeRepeatCount(repeat = 1) {
  assertInteger(repeat, "repeat");
  if (!isValidRepeatCount(repeat)) {
    throw new RangeError(
      `repeat must divide ${INDEX_TEETH}; valid values are ${VALID_REPEAT_COUNTS.join(", ")}.`,
    );
  }
  return repeat;
}

function normalizeMirrorTeeth(mirror = 0) {
  assertInteger(mirror, "mirror");
  if (mirror < 0) {
    throw new RangeError("mirror must be a non-negative integer tooth offset.");
  }
  const wrapped = mirror % INDEX_TEETH;
  return Math.min(wrapped, INDEX_TEETH - wrapped);
}

/** Resolve the N undirected reflection axes of a dihedral tier. */
export function generateMirrorAxes({
  baseIndex = 0,
  base,
  repeat = 1,
  symmetry,
  mirror = 0,
} = {}) {
  const resolvedBase = normalizeIndex(base ?? baseIndex);
  const resolvedRepeat = normalizeRepeatCount(symmetry ?? repeat);
  const resolvedMirror = normalizeMirrorTeeth(mirror);
  const axisStep = (INDEX_TEETH / 2) / resolvedRepeat;
  const axes = new Set();

  for (let ordinal = 0; ordinal < resolvedRepeat; ordinal += 1) {
    const raw = resolvedBase + resolvedMirror + ordinal * axisStep;
    const axis = cleanNumber(((raw % (INDEX_TEETH / 2)) + (INDEX_TEETH / 2)) % (INDEX_TEETH / 2));
    axes.add(axis);
  }

  return [...axes].sort((left, right) => left - right);
}

/**
 * Resolves a dihedral faceting tier.
 *
 * Rotation first creates N faces around the full 96-tooth wheel. Mirroring
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
} = {}) {
  const resolvedBase = normalizeIndex(base ?? baseIndex);
  const resolvedRepeat = normalizeRepeatCount(symmetry ?? repeat);
  const step = INDEX_TEETH / resolvedRepeat;
  const values = new Set();

  for (let ordinal = 0; ordinal < resolvedRepeat; ordinal += 1) {
    values.add(normalizeIndex(resolvedBase + ordinal * step));
  }

  const axes = generateMirrorAxes({
    baseIndex: resolvedBase,
    repeat: resolvedRepeat,
    mirror,
  });
  for (const axis of axes) {
    values.add(normalizeIndex(Math.round(2 * axis - resolvedBase)));
  }

  return [...values].sort((left, right) => displayIndex(left) - displayIndex(right));
}

export function indexToAzimuthDeg(index) {
  return cleanNumber(normalizeIndex(index) * DEGREES_PER_TOOTH);
}

function indexToAzimuthRad(index) {
  return (indexToAzimuthDeg(index) * Math.PI) / 180;
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

export function facetNormal(index, betaDeg) {
  const azimuth = indexToAzimuthRad(index);
  const beta = (assertFiniteNumber(betaDeg, "betaDeg") * Math.PI) / 180;
  const radial = Math.cos(beta);
  return {
    x: cleanNumber(radial * Math.cos(azimuth)),
    y: cleanNumber(radial * Math.sin(azimuth)),
    z: cleanNumber(Math.sin(beta)),
  };
}

export function normalizeStock(stock = DEFAULT_STOCK) {
  if (!isPlainObject(stock)) {
    throw new TypeError("stock must be an object.");
  }
  const kind = stock.kind ?? stock.type ?? "cube";
  if (kind !== "cube") {
    throw new RangeError('stock.kind must be "cube".');
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
  return {
    kind: "cube",
    size: cleanNumber(size),
    center: center.map(cleanNumber),
  };
}

export function cubeSupportOffset(normal, stock = DEFAULT_STOCK) {
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
    centerProjection + half * (Math.abs(nx) + Math.abs(ny) + Math.abs(nz)),
  );
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
    centerProjection + half * (Math.hypot(nx, ny) + Math.abs(nz)),
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
  const index = normalizeIndex(facet.index ?? facet.baseIndex ?? 0);
  const depth = assertFiniteNumber(facet.depth ?? 0, "depth");
  if (depth < 0) {
    throw new RangeError("depth must be greater than or equal to zero.");
  }
  const normal = facetNormal(index, betaDeg);
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

/** Rotate a group of resolved cutting planes by whole teeth on the 96 index wheel. */
export function rotateFacetsByTeeth(facets, teeth, { stock = DEFAULT_STOCK } = {}) {
  if (!Array.isArray(facets)) {
    throw new TypeError("facets must be an array.");
  }
  const step = assertFiniteNumber(teeth, "teeth");
  if (!Number.isInteger(step)) {
    throw new RangeError("teeth must be an integer.");
  }
  return facets.map((facet) => resolveFacet({
    ...facet,
    baseIndex: normalizeIndex(facet.baseIndex + step),
    index: normalizeIndex(facet.index + step),
  }, { stock }));
}

function defaultPatternId({ region, baseIndex, repeat, mirror, industryAngleDeg, depth }) {
  return [
    "cut",
    region,
    displayIndex(baseIndex),
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
  const baseIndex = normalizeIndex(facet.baseIndex ?? facet.index ?? 0);
  const repeat = normalizeRepeatCount(facet.repeat ?? facet.symmetry ?? 1);
  const mirror = normalizeMirrorTeeth(facet.mirror ?? 0);
  const index = normalizeIndex(facet.index ?? baseIndex);
  const depth = assertFiniteNumber(facet.depth ?? 0, "depth");
  if (depth < 0) {
    throw new RangeError("depth must be greater than or equal to zero.");
  }
  const patternId = normalizeString(
    facet.patternId ?? facet.groupId,
    defaultPatternId({
      region,
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
    `${patternId}:${displayIndex(index)}`,
    "facet.id",
  );
  const ordinal = facet.ordinal ?? 0;
  assertInteger(ordinal, "ordinal");
  if (ordinal < 0) {
    throw new RangeError("ordinal must be greater than or equal to zero.");
  }
  const plane = facetToClippingPlane(
    { region, industryAngleDeg, index, depth },
    { stock: resolvedStock },
  );

  const resolved = {
    id,
    patternId,
    ordinal,
    region,
    baseIndex,
    repeat,
    mirror,
    index,
    displayIndex: displayIndex(index),
    azimuthDeg: indexToAzimuthDeg(index),
    industryAngleDeg,
    betaDeg,
    depth: cleanNumber(depth),
    plane,
  };

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
  const baseIndex = normalizeIndex(pattern.baseIndex ?? pattern.base ?? 0);
  const repeat = normalizeRepeatCount(pattern.repeat ?? pattern.symmetry ?? 1);
  const mirror = normalizeMirrorTeeth(pattern.mirror ?? 0);
  const depth = assertFiniteNumber(pattern.depth ?? 0, "depth");
  if (depth < 0) {
    throw new RangeError("depth must be greater than or equal to zero.");
  }
  const patternId = normalizeString(
    pattern.patternId ?? pattern.groupId ?? pattern.id,
    defaultPatternId({
      region,
      baseIndex,
      repeat,
      mirror,
      industryAngleDeg,
      depth,
    }),
    "patternId",
  );
  const indices = generateFacetIndices({ baseIndex, repeat, mirror });

  return indices.map((index, ordinal) =>
    resolveFacet(
      {
        id: `${patternId}:${displayIndex(index)}`,
        patternId,
        ordinal,
        region,
        baseIndex,
        repeat,
        mirror,
        index,
        industryAngleDeg,
        depth,
        label: pattern.label,
        metadata: pattern.metadata,
      },
      { stock: resolvedStock },
    ),
  );
}

export function createFacetingDocument({
  name = "Untitled Facet Design",
  stock = DEFAULT_STOCK,
  facets = [],
  metadata,
} = {}) {
  const resolvedStock = normalizeStock(stock);
  if (!Array.isArray(facets)) {
    throw new TypeError("facets must be an array.");
  }
  const resolvedFacets = facets.map((facet) =>
    resolveFacet(facet, { stock: resolvedStock }),
  );
  const document = {
    $schema: DOCUMENT_SCHEMA_ID,
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    kind: DOCUMENT_KIND,
    name: normalizeString(name, "Untitled Facet Design", "document.name"),
    indexGear: {
      teeth: INDEX_TEETH,
      zeroAlias: INDEX_ZERO_ALIAS,
      degreesPerTooth: DEGREES_PER_TOOTH,
    },
    stock: resolvedStock,
    facets: resolvedFacets,
  };
  if (isPlainObject(metadata)) {
    document.metadata = clone(metadata);
  }
  assertValidFacetingDocument(document);
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

function validateResolvedFacet(facet, path, stock, errors) {
  if (!isPlainObject(facet)) {
    addValidationError(errors, path, "must be an object");
    return;
  }
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
  if (!Number.isInteger(facet.baseIndex) || facet.baseIndex < 0 || facet.baseIndex >= 96) {
    addValidationError(errors, `${path}.baseIndex`, "must be a canonical index from 0 to 95");
  }
  if (!isValidRepeatCount(facet.repeat)) {
    addValidationError(errors, `${path}.repeat`, "must divide 96");
  }
  if (!Number.isInteger(facet.mirror) || facet.mirror < 0 || facet.mirror > 48) {
    addValidationError(errors, `${path}.mirror`, "must be an integer from 0 to 48");
  }
  if (!Number.isInteger(facet.index) || facet.index < 0 || facet.index >= 96) {
    addValidationError(errors, `${path}.index`, "must be a canonical index from 0 to 95");
  }
  if (
    Number.isInteger(facet.index) &&
    facet.index >= 0 &&
    facet.index < 96 &&
    facet.displayIndex !== displayIndex(facet.index)
  ) {
    addValidationError(errors, `${path}.displayIndex`, "does not match the resolved index alias");
  }
  if (
    Number.isInteger(facet.index) &&
    facet.index >= 0 &&
    facet.index < 96 &&
    !nearlyEqual(facet.azimuthDeg, indexToAzimuthDeg(facet.index))
  ) {
    addValidationError(errors, `${path}.azimuthDeg`, "does not match the resolved index azimuth");
  }
  if (typeof facet.depth !== "number" || !Number.isFinite(facet.depth) || facet.depth < 0) {
    addValidationError(errors, `${path}.depth`, "must be a non-negative finite number");
  }

  const primitivesValid =
    FACET_REGIONS.includes(facet.region) &&
    Number.isInteger(facet.baseIndex) &&
    facet.baseIndex >= 0 &&
    facet.baseIndex < 96 &&
    isValidRepeatCount(facet.repeat) &&
    Number.isInteger(facet.mirror) &&
    facet.mirror >= 0 &&
    facet.mirror <= 48 &&
    Number.isInteger(facet.index) &&
    facet.index >= 0 &&
    facet.index < 96 &&
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
    });
  } catch {
    generatedIndices = [];
  }
  if (!generatedIndices.includes(facet.index)) {
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
  if (![DOCUMENT_SCHEMA_ID, LEGACY_DOCUMENT_SCHEMA_ID].includes(document.$schema)) {
    addValidationError(errors, "$.$schema", `must equal ${DOCUMENT_SCHEMA_ID}`);
  }
  if (document.schemaVersion !== DOCUMENT_SCHEMA_VERSION) {
    addValidationError(errors, "$.schemaVersion", "unsupported schema version");
  }
  if (document.kind !== DOCUMENT_KIND) {
    addValidationError(errors, "$.kind", `must equal ${DOCUMENT_KIND}`);
  }
  if (typeof document.name !== "string" || document.name.trim() === "") {
    addValidationError(errors, "$.name", "must be a non-empty string");
  }
  if (
    !isPlainObject(document.indexGear) ||
    document.indexGear.teeth !== INDEX_TEETH ||
    document.indexGear.zeroAlias !== INDEX_ZERO_ALIAS ||
    document.indexGear.degreesPerTooth !== DEGREES_PER_TOOTH
  ) {
    addValidationError(errors, "$.indexGear", "must describe the fixed 96-tooth gear");
  }
  if (!isCanonicalStock(document.stock)) {
    addValidationError(errors, "$.stock", "must be a positive, finite cube stock definition");
  }
  if (!Array.isArray(document.facets)) {
    addValidationError(errors, "$.facets", "must be an array");
  } else if (isCanonicalStock(document.stock)) {
    const ids = new Set();
    document.facets.forEach((facet, index) => {
      validateResolvedFacet(facet, `$.facets[${index}]`, document.stock, errors);
      if (isPlainObject(facet) && typeof facet.id === "string") {
        if (ids.has(facet.id)) {
          addValidationError(errors, `$.facets[${index}].id`, "must be unique");
        }
        ids.add(facet.id);
      }
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
    facets: document.facets.map((facet) => resolveFacet(facet, { stock: document.stock })),
  };
}

function migrateLegacySchema(document) {
  return document.$schema === LEGACY_DOCUMENT_SCHEMA_ID
    ? { ...document, $schema: DOCUMENT_SCHEMA_ID }
    : document;
}

export function exportFacetingJSON(document, { pretty = true } = {}) {
  const normalizedDocument = migrateLegacySchema(migrateLegacyFacetGeometry(document));
  assertValidFacetingDocument(normalizedDocument);
  return JSON.stringify(normalizedDocument, null, pretty ? 2 : 0);
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
  const normalizedDocument = migrateLegacySchema(migrateLegacyFacetGeometry(parsed));
  assertValidFacetingDocument(normalizedDocument);
  return clone(normalizedDocument);
}

function createCommand(type, payload) {
  return {
    id: nextId("command"),
    type,
    payload: clone(payload),
  };
}

export function createAddPatternCommand(pattern) {
  if (!isPlainObject(pattern)) {
    throw new TypeError("pattern must be an object.");
  }
  return createCommand(COMMAND_TYPE.ADD_PATTERN, { pattern });
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

export function createUpdateFacetCommand(facetId, changes) {
  return createCommand(COMMAND_TYPE.UPDATE_FACET, {
    facetId: normalizeString(facetId, undefined, "facetId"),
    changes: isPlainObject(changes) ? changes : {},
  });
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
  if (command.type === COMMAND_TYPE.ADD_PATTERN && isPlainObject(payload.pattern)) {
    payload.pattern.patternId =
      payload.pattern.patternId ??
      payload.pattern.groupId ??
      payload.pattern.id ??
      `${id}:pattern`;
  }
  if (command.type === COMMAND_TYPE.ADD_FACETS && Array.isArray(payload.facets)) {
    payload.facets = payload.facets.map((facet, index) => {
      if (!isPlainObject(facet)) return facet;
      const patternId =
        facet.patternId ?? facet.groupId ?? `${id}:pattern:${index}`;
      const resolvedIndex = normalizeIndex(facet.index ?? facet.baseIndex ?? 0);
      return {
        ...facet,
        id: facet.id ?? `${patternId}:${displayIndex(resolvedIndex)}`,
        patternId,
      };
    });
  }
  if (command.type === COMMAND_TYPE.REPLACE_PATTERN && Array.isArray(payload.facets)) {
    payload.facets = payload.facets.map((facet, index) => {
      if (!isPlainObject(facet)) return facet;
      const resolvedIndex = normalizeIndex(facet.index ?? facet.baseIndex ?? 0);
      return {
        ...facet,
        id: facet.id ?? `${payload.patternId}:${displayIndex(resolvedIndex)}`,
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

  if (type === COMMAND_TYPE.REPLACE_DOCUMENT) {
    assertValidFacetingDocument(payload.document);
    return clone(payload.document);
  }
  if (type === COMMAND_TYPE.ADD_PATTERN) {
    const additions = resolveFacetPattern(payload.pattern, { stock: document.stock });
    return appendFacets(document, additions);
  }
  if (type === COMMAND_TYPE.ADD_FACETS) {
    if (!Array.isArray(payload.facets)) {
      throw new TypeError("facets/add payload.facets must be an array.");
    }
    const additions = payload.facets.map((facet) =>
      resolveFacet(facet, { stock: document.stock }),
    );
    return appendFacets(document, additions);
  }
  if (type === COMMAND_TYPE.REPLACE_PATTERN) {
    const firstIndex = document.facets.findIndex((facet) => facet.patternId === payload.patternId);
    if (firstIndex < 0) throw new RangeError(`Unknown pattern id: ${payload.patternId}`);
    const replacements = payload.facets.map((facet) => resolveFacet({
      ...facet,
      patternId: payload.patternId,
    }, { stock: document.stock }));
    const facets = replacePatternFacets(document.facets, payload.patternId, replacements);
    const next = { ...document, facets };
    assertValidFacetingDocument(next);
    return next;
  }
  if (type === COMMAND_TYPE.UPDATE_FACET) {
    const facetIndex = document.facets.findIndex(
      (facet) => facet.id === payload.facetId,
    );
    if (facetIndex < 0) {
      throw new RangeError(`Unknown facet id: ${payload.facetId}`);
    }
    const current = document.facets[facetIndex];
    const updated = resolveFacet(
      {
        ...current,
        ...(isPlainObject(payload.changes) ? payload.changes : {}),
        id: current.id,
      },
      { stock: document.stock },
    );
    const facets = document.facets.slice();
    facets[facetIndex] = updated;
    const next = { ...document, facets };
    assertValidFacetingDocument(next);
    return next;
  }
  if (type === COMMAND_TYPE.REMOVE_FACETS) {
    if (!Array.isArray(payload.facetIds)) {
      throw new TypeError("facets/remove payload.facetIds must be an array.");
    }
    const ids = new Set(payload.facetIds);
    return {
      ...document,
      facets: document.facets.filter((facet) => !ids.has(facet.id)),
    };
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
  const next = { ...document, facets: [...document.facets, ...additions] };
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
  assertValidFacetingDocument(initialDocument);
  const initial = clone(initialDocument);
  return {
    initial,
    commands: [],
    cursor: 0,
    present: clone(initial),
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
  assertHistory(history);
  return history.cursor > 0;
}

export function canRedo(history) {
  assertHistory(history);
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
