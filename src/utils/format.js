/**
 * Shared numeric clamp for viewport interaction handlers. Inputs are
 * expected to be finite numbers; NaN passes through Math.min/Math.max.
 */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Sanitize a document name for use as a download file stem: runs of
 * characters that are not letters, numbers or hyphens collapse into a
 * single hyphen; an empty result falls back to "facet-96".
 */
export function safeFileStem(name, fallback = "facet-96") {
  return name.replace(/[^\p{L}\p{N}-]+/gu, "-") || fallback;
}

/** Industry angle copy with two decimals; non-finite input renders as "-". */
export function formatAngle(value) {
  return Number.isFinite(value) ? Number(value).toFixed(2) : "-";
}

/** Cut depth copy with three decimals; non-finite input renders as "-". */
export function formatDepth(value) {
  return Number.isFinite(value) ? Number(value).toFixed(3) : "-";
}
