/** Surface treatment is attached to one resolved facet, never the whole tier. */
export function facetSurfaceState(facet) {
  return facet?.metadata?.surfaceFinish?.state === 'frosted' ? 'frosted' : 'polished';
}
