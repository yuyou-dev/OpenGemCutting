/**
 * Workbench document initialization: every document starts from the
 * default faceting document with a fixed 0° table facet and an editable
 * 32-fold girdle preform.
 */

import { createFacetingDocument, resolveFacetPattern } from "./faceting.js";
import { DEFAULT_OPTICS_SETTINGS, resolveOpticsSettings } from "./optics.js";

const TABLE_PATTERN_ID = "table-facet";

function tableFacets(stock) {
  return resolveFacetPattern({
    patternId: TABLE_PATTERN_ID,
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
  if (document.facets.some((facet) => facet.patternId === TABLE_PATTERN_ID || facet.metadata?.operationType === "table")) {
    return document;
  }
  return { ...document, facets: [...tableFacets(document.stock), ...document.facets] };
}

/** Default 32-fold girdle preform: turns the cube stock into a prism blank. */
function girdlePreformFacets(stock) {
  return resolveFacetPattern({
    patternId: "girdle-preform",
    label: "G1 腰部",
    region: "girdle",
    baseIndex: 0,
    repeat: 32,
    mirror: 0,
    industryAngleDeg: 90,
    depth: 0.2,
    metadata: { patternMode: "symmetric" },
  }, { stock });
}

export function createWorkbenchDocument(name) {
  const withTable = ensureTableFacet(createFacetingDocument({
    name,
    metadata: { optics: resolveOpticsSettings(DEFAULT_OPTICS_SETTINGS) },
  }));
  return { ...withTable, facets: [...withTable.facets, ...girdlePreformFacets(withTable.stock)] };
}
