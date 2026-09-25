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

/** The default girdle is a planar CUT on the project equipment wheel. */
function girdlePreformFacets(stock, indexTeeth) {
  return resolveFacetPattern({
    patternId: "girdle-preform",
    indexTeeth,
    label: "G1 腰部",
    region: "girdle",
    baseIndex: 0,
    repeat: compatibleRepeat(indexTeeth),
    mirror: 0,
    industryAngleDeg: 90,
    depth: 0.2,
    metadata: { patternMode: "symmetric" },
  }, { stock });
}

export function createWorkbenchDocument(name, indexTeeth = 96) {
  normalizeIndexTeeth(indexTeeth);
  const document = createFacetingDocument({ name, indexGear: indexTeeth,
    metadata: { optics: resolveOpticsSettings(DEFAULT_OPTICS_SETTINGS) },
  });
  return createFacetingDocument({ ...document, facets: [
    ...tableFacets(document.stock, indexTeeth), ...girdlePreformFacets(document.stock, indexTeeth),
  ] });
}
