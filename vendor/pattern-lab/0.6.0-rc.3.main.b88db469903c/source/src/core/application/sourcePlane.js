import { dot } from '../domain/math.js';

// A plane may have entered in source coordinates or been created in lab
// coordinates. Compare at either original transform boundary, exactly. Requiring
// an affine transform AND its inverse to round-trip would misclassify unchanged
// planes. The source plane remains authoritative; no tolerance or snapping.
export function matchesSourcePlane(plane, facet, stock) {
  if (!facet || !plane.normal.every((n, i) => n === facet.plane.normal[['x','y','z'][i]])) return false;
  const unit = stock.size / 2, shift = dot(plane.normal, stock.center);
  return plane.offset === (facet.plane.offset - shift) / unit
    || plane.offset * unit + shift === facet.plane.offset;
}
