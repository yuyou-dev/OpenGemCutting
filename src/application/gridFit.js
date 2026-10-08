import { resolveDraftGeometry } from '../domain/cutConstruction.js';
import { getCuttingReference } from '../domain/faceting.js';
import { evaluateDocument } from '../domain/documentGeometry.js';
import { GRID_CUT_LIMITS, normalizeGridCut } from '../domain/gridCut.js';

/**
 * How a grid tool sits in the stone: the cells the outline no longer reaches and
 * the shortest edge of any grid face. A grid line ending just beside a girdle
 * corner leaves such a short edge instead of one clean meet.
 */
export function gridCutFootprint(solid, gridFacetIds) {
  const present = new Set(solid.faces.map((face) => face.facetId ?? face.id));
  const missing = gridFacetIds.filter((id) => !present.has(id));
  const points = solid.vertices.map((v) => [v.x, v.y, v.z]);
  let shortest = Infinity;
  const ids = new Set(gridFacetIds);
  for (const face of solid.faces) {
    if (!ids.has(face.facetId ?? face.id) || !Array.isArray(face.vertexIndices)) continue;
    face.vertexIndices.forEach((a, i, all) => {
      const p = points[a], q = points[all[(i + 1) % all.length]];
      shortest = Math.min(shortest, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
    });
  }
  return { missing, shortest };
}

/**
 * "Fit to girdle" for any tool with an extent (grid or composite): the extent
 * nearest the current one at which the outer facet lines keep clear of the
 * girdle corners, so no tool face has a short edge. A result that cuts no
 * tool face at all never counts as a fit.
 */
export function fitToolExtent({ document, draft, region, patternId = null, extentOf, withExtent, limits = GRID_CUT_LIMITS.extent }) {
  const reference = getCuttingReference(document);
  const others = document.facets.filter((facet) => facet.patternId !== patternId);
  const evaluate = (extent) => {
    let resolved;
    try { resolved = resolveDraftGeometry(withExtent(draft, extent), region, reference); } catch { return null; }
    const { facets, error } = resolved;
    if (error || !facets.length) return null;
    try {
      const solid = evaluateDocument({ ...document, facets: [...others, ...facets] });
      const { missing, shortest } = gridCutFootprint(solid, facets.map((facet) => facet.id));
      return { extent, missing: missing.length, total: facets.length, shortest };
    } catch {
      return null;
    }
  };
  // Nearest clean extent: no edge of a tool face shorter than 1% of the stone's radius, searched
  // within ±20% of the current extent so the tool keeps its size. Cells beyond a round outline
  // are expected; they only break ties. Without a clean extent, the longest shortest edge wins.
  const radius = reference.envelope?.radius ?? reference.size / 2;
  const touches = (result) => result.missing < result.total;
  const clean = (result) => touches(result) && result.shortest >= radius * 0.01;
  const current = extentOf(draft);
  const better = (a, b) => {
    if (!b) return true;
    if (touches(a) !== touches(b)) return touches(a);
    if (clean(a) !== clean(b)) return clean(a);
    if (!clean(a)) return a.shortest > b.shortest;
    const da = Math.abs(a.extent - current), db = Math.abs(b.extent - current);
    return da < db - 1e-9 || (Math.abs(da - db) <= 1e-9 && a.missing < b.missing);
  };
  const [low, high] = limits;
  const extents = [];
  for (let extent = Math.max(low, current * 0.8); extent <= Math.min(high, current * 1.2) + 1e-9; extent += 0.004) {
    extents.push(Number(extent.toFixed(3)));
  }
  // Nearest first: once a clean extent is found, farther ones cannot win, so only
  // its equally near partners still need a look. The winner is then picked in scan
  // order exactly as a full scan would; without a clean extent every one is tried.
  const results = new Map();
  let nearestClean = Infinity;
  for (const extent of [...extents].sort((a, b) => Math.abs(a - current) - Math.abs(b - current))) {
    if (Math.abs(extent - current) > nearestClean + 1e-9) break;
    const result = evaluate(extent);
    results.set(extent, result);
    if (result && clean(result)) nearestClean = Math.min(nearestClean, Math.abs(extent - current));
  }
  let best = null;
  for (const extent of extents) {
    const result = results.get(extent);
    if (result && better(result, best)) best = result;
  }
  return best && { ...best, touches: touches(best), clean: clean(best) };
}

/** "Fit to girdle" of a grid tool (the grid's extent). */
export function fitGridExtent({ document, draft, region, patternId = null }) {
  return fitToolExtent({
    document, draft, region, patternId,
    extentOf: (current) => current.grid.extent,
    withExtent: (current, extent) => ({ ...current, grid: normalizeGridCut({ ...current.grid, extent }, current.indexTeeth ?? 96) }),
  });
}
