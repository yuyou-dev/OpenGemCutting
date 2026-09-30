/**
 * Default cube initialization adds a fixed 0° table and editable equipment-compatible
 * girdle. Imported mesh projects retain their original stock and zero CUTs;
 * their initialization belongs to stockGeometry.js.
 */

import { createFacetingDocument, resolveFacetPattern } from "./faceting.js";
import { compatibleRepeat, normalizeIndexTeeth } from "./indexing.js";
import { DEFAULT_OPTICS_SETTINGS, resolveOpticsSettings } from "./optics.js";

const TABLE_PATTERN_ID = "table-facet";

function tableFacets(stock, indexTeeth = 96) {
  return resolveFacetPattern({
    patternId: TABLE_PATTERN_ID,
    indexTeeth,
    label: "T1 台面",
    region: "crown",
    baseIndex: 0,
    repeat: 1,
    mirror: 0,
    industryAngleDeg: 0,
    depth: 0.2,
    metadata: {
      operationType: "table",
      fixedAngle: true,
      patternMode: "symmetric",
    },
  }, { stock });
}

export function ensureTableFacet(document) {
  if (document.stock.kind === "mesh" || document.schemaVersion >= 3) return document;
  if (document.facets.some((facet) => facet.patternId === TABLE_PATTERN_ID || facet.metadata?.operationType === "table")) {
    return document;
  }
  return { ...document, facets: [...tableFacets(document.stock), ...document.facets] };
}

/** Outlines the default start can cut its G1 girdle into. */
export const DEFAULT_START_OUTLINES = Object.freeze(["cylinder", "square"]);

/** Girdle facet counts a cylinder start offers: every whole-tooth division of the wheel, from 8 up. */
export function girdleFacetChoices(indexTeeth = 96) {
  normalizeIndexTeeth(indexTeeth);
  return Array.from({ length: indexTeeth }, (_, i) => i + 1).filter((count) => count >= 8 && indexTeeth % count === 0);
}

/** A square girdle needs four sides on whole teeth. */
export const squareStartAvailable = (indexTeeth = 96) => indexTeeth % 4 === 0;

/**
 * Resolve the default start: `outline` cylinder (default) or square, and for a
 * cylinder `girdleFacets` (default: the division nearest 32). Invalid choices
 * throw so callers never get a silently different stone.
 */
export function resolveDefaultStart({ outline = "cylinder", girdleFacets } = {}, indexTeeth = 96) {
  normalizeIndexTeeth(indexTeeth);
  if (!DEFAULT_START_OUTLINES.includes(outline)) throw new RangeError(`outline must be one of ${DEFAULT_START_OUTLINES.join(", ")}.`);
  if (outline === "square") {
    if (!squareStartAvailable(indexTeeth)) throw new RangeError(`A ${indexTeeth}-tooth wheel cannot cut a square girdle on whole teeth.`);
    if (girdleFacets !== undefined && girdleFacets !== 4) throw new RangeError("A square girdle has 4 facets.");
    return { outline, girdleFacets: 4 };
  }
  const facets = girdleFacets ?? compatibleRepeat(indexTeeth);
  if (!girdleFacetChoices(indexTeeth).includes(facets)) {
    throw new RangeError(`girdleFacets must divide the ${indexTeeth}-tooth wheel and be at least 8 (${girdleFacetChoices(indexTeeth).join(", ")}).`);
  }
  return { outline, girdleFacets: facets };
}

/** The default girdle is a planar CUT on the project equipment wheel; its sides face index 0, so a square sits square. */
function girdlePreformFacets(stock, indexTeeth, repeat) {
  return resolveFacetPattern({
    patternId: "girdle-preform",
    indexTeeth,
    label: "G1 腰部",
    region: "girdle",
    baseIndex: 0,
    repeat,
    mirror: 0,
    industryAngleDeg: 90,
    depth: 0.2,
    metadata: { patternMode: "symmetric" },
  }, { stock });
}

export function createWorkbenchDocument(name, indexTeeth = 96, start = {}) {
  normalizeIndexTeeth(indexTeeth);
  const { girdleFacets } = resolveDefaultStart(start, indexTeeth);
  const document = createFacetingDocument({ name, indexGear: indexTeeth,
    metadata: { optics: resolveOpticsSettings(DEFAULT_OPTICS_SETTINGS) },
  });
  return createFacetingDocument({ ...document, facets: [
    ...tableFacets(document.stock, indexTeeth), ...girdlePreformFacets(document.stock, indexTeeth, girdleFacets),
  ] });
}
