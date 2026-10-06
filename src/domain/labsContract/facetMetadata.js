/** Fields that describe a whole authored layer, never a detached single face. */
export const LAYER_CONSTRUCTION_FIELDS = Object.freeze(['construction', 'ring', 'grid', 'composite']);

/** Preserve opaque face data while removing construction that splitting invalidates. */
export function detachedFacetMetadata(metadata = {}) {
  const result = { ...metadata };
  for (const key of [...LAYER_CONSTRUCTION_FIELDS, 'gridCell', 'compositeCell']) delete result[key];
  return result;
}
