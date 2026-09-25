import { normalizeIndex } from './faceting.js';

/** Surface treatment is attached to one resolved facet, never the whole tier. */
export function facetSurfaceState(facet) {
  return facet?.metadata?.surfaceFinish?.state === 'frosted' ? 'frosted' : 'polished';
}

/** Parameter edits retain treatment for surviving directions; new members use the default. */
export function facetMetadataAfterParameterEdit(facet, previous, metadata) {
  const result = { ...metadata };
  delete result.surfaceFinish; // Shared tier metadata must not spread the first member's finish.
  const direction = f => normalizeIndex(f.index, f.indexTeeth ?? 96) / (f.indexTeeth ?? 96);
  const original = previous.find(f => Math.abs(direction(f) - direction(facet)) < 1e-9);
  if (original?.metadata?.surfaceFinish !== undefined) result.surfaceFinish = structuredClone(original.metadata.surfaceFinish);
  return result;
}
