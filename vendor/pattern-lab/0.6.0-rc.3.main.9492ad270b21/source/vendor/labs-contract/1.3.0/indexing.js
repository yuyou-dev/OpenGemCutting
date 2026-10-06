/** Machine wheels are output constraints; changing one never rounds geometry. */
export const INDEX_GEARS = Object.freeze([32, 64, 72, 77, 80, 84, 88, 96, 99, 120, 360]);
export const DEFAULT_INDEX_TEETH = 96;
export const INDEX_TOLERANCE_DEG = 1e-6;

export function normalizeIndexTeeth(teeth = DEFAULT_INDEX_TEETH) {
  if (!Number.isInteger(teeth) || teeth < 1 || teeth > 360) {
    throw new RangeError("indexTeeth must be an integer from 1 to 360.");
  }
  return teeth;
}

export function normalizeIndexGear(gear = DEFAULT_INDEX_TEETH) {
  const teeth = normalizeIndexTeeth(typeof gear === "number" ? gear : gear?.teeth);
  return { teeth, zeroAlias: teeth, degreesPerTooth: 360 / teeth };
}

function finite(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number.`);
  return value;
}

export function indexToAzimuth(index, teeth = DEFAULT_INDEX_TEETH) {
  const wheel = normalizeIndexTeeth(teeth);
  return (((finite(index, "index") % wheel) + wheel) % wheel) * 360 / wheel;
}

export function azimuthToIndex(azimuth, teeth = DEFAULT_INDEX_TEETH) {
  const wheel = normalizeIndexTeeth(teeth);
  return (((finite(azimuth, "azimuth") % 360) + 360) % 360) * wheel / 360;
}

/** Horizontal planes do not constrain a rotational index. */
export function facetIndexForGear(facet, teeth = DEFAULT_INDEX_TEETH) {
  const normal = facet?.plane?.normal ?? facet?.normal;
  if (!normal || ![normal.x, normal.y, normal.z].every(Number.isFinite)
    || Math.hypot(normal.x, normal.y, normal.z) <= 1e-12) {
    throw new TypeError("facet must contain a finite non-zero plane normal.");
  }
  normalizeIndexTeeth(teeth);
  if (Math.hypot(normal.x, normal.y) <= 1e-10) return null;
  return azimuthToIndex(Math.atan2(normal.y, normal.x) * 180 / Math.PI, teeth);
}

/** Reports integer-tooth manufacturability against exact plane normals.
 * For scope=final, pass finalFacets or effectiveFacetIds derived from final solid.
 * Hidden/display state is intentionally ignored.
 */
export function indexCompatibilityReport(documentOrFacets, {
  scope = "all", gears = INDEX_GEARS, toleranceDeg = INDEX_TOLERANCE_DEG,
  finalFacets, effectiveFacetIds,
} = {}) {
  if (!["all", "final"].includes(scope)) throw new RangeError("scope must be all or final.");
  if (!Number.isFinite(toleranceDeg) || toleranceDeg < 0) throw new RangeError("toleranceDeg must be non-negative.");
  const source = Array.isArray(documentOrFacets) ? documentOrFacets : documentOrFacets?.facets;
  if (!Array.isArray(source)) throw new TypeError("facets must be an array.");
  const effective = effectiveFacetIds === undefined ? null : new Set(effectiveFacetIds);
  if (scope === "final" && !Array.isArray(finalFacets) && !effective) {
    throw new TypeError("final scope requires finalFacets or effectiveFacetIds from the final solid.");
  }
  const facets = scope === "all" ? source : finalFacets ?? source.filter((facet) => effective.has(facet.id));
  return gears.map((teeth) => {
    normalizeIndexTeeth(teeth);
    const checked = facets.map((facet) => {
      const index = facetIndexForGear(facet, teeth);
      const nearest = index === null ? null : Math.round(index) % teeth;
      const errorDeg = index === null ? 0 : Math.abs(index - Math.round(index)) * 360 / teeth;
      return { facetId: facet.id, patternId: facet.patternId, index,
        nearestIndex: nearest === 0 ? teeth : nearest, errorDeg,
        exempt: index === null, compatible: errorDeg <= toleranceDeg };
    });
    const constrained = checked.filter((entry) => !entry.exempt);
    const incompatibleFacets = constrained.filter((entry) => !entry.compatible);
    const compatibleCount = constrained.length - incompatibleFacets.length;
    return { teeth, scope, compatible: incompatibleFacets.length === 0,
      status: incompatibleFacets.length === 0 ? "compatible" : "incompatible",
      totalCount: facets.length, checkedCount: constrained.length,
      exemptCount: checked.length - constrained.length, compatibleCount,
      incompatibleCount: incompatibleFacets.length,
      coverage: constrained.length ? compatibleCount / constrained.length : 1,
      maxErrorDeg: Math.max(0, ...constrained.map((entry) => entry.errorDeg)),
      toleranceDeg, incompatibleFacets };
  });
}

/** A nearby regular girdle/repeat that can be cut on whole teeth. */
export function compatibleRepeat(teeth, preferred = 32) {
  normalizeIndexTeeth(teeth);
  return Array.from({ length: teeth }, (_, i) => i + 1)
    .filter(repeat => teeth % repeat === 0)
    .sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b)[0];
}

/** Re-express authored indices on one project wheel without moving any plane.
 * Stable face IDs and Meet references survive a wheel change. */
export function facetOnIndexGear(facet, teeth) {
  normalizeIndexTeeth(teeth);
  const source = facet.indexTeeth ?? DEFAULT_INDEX_TEETH;
  if (source === teeth) return facet;
  const scale = teeth / source;
  const metadata = facet.metadata && structuredClone(facet.metadata);
  if (metadata?.primaryIndex !== undefined) metadata.primaryIndex *= scale;
  if (metadata?.construction?.primaryIndex !== undefined) metadata.construction.primaryIndex *= scale;
  return { ...facet, indexTeeth: teeth,
    index: (facet.index ?? facet.baseIndex ?? 0) * scale,
    baseIndex: (facet.baseIndex ?? facet.index ?? 0) * scale,
    mirror: (facet.mirror ?? 0) * scale,
    ...(metadata ? { metadata } : {}),
  };
}

/** Portable equipment declaration; stock and round tools never constrain gears. */
export function indexExportSummary(document) {
  const selectedTeeth = document.indexGear?.teeth ?? 96;
  const reports = indexCompatibilityReport(document, { gears: [...new Set([...INDEX_GEARS, selectedTeeth])] });
  return { selectedTeeth, defaultTeeth: 96, indexValuesUse: selectedTeeth,
    supportedTeeth: reports.filter(report => report.compatible).map(report => report.teeth),
    compatibleWith96: reports.find(report => report.teeth === 96).compatible,
    selectedCompatible: reports.find(report => report.teeth === selectedTeeth).compatible,
    scope: 'all-planar-operations', hasPhysicalStock: document.stock?.kind === 'mesh',
    notice: selectedTeeth !== 96 ? `本文件按 ${selectedTeeth} 分度输出，不能直接按 96 分度读数加工。${!reports.find(report => report.teeth === 96).compatible ? '本设计不兼容 96 整齿加工。' : ''}`
      : !reports.find(report => report.teeth === 96).compatible ? '本设计含 96 分度无法整齿加工的方向，请核对设备后再切磨。' : '',
  };
}
