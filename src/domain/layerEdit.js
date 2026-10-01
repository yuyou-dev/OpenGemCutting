import { displayIndex, normalizeIndex } from './faceting.js';
import { ringCutMetadata } from './ringCut.js';
import { snapshotMeetTarget } from './cutConstruction.js';

/**
 * Metadata owned by one resolved facet (its direction), never by the whole layer:
 * surface treatment, and the identities laboratories record per facet. A layer
 * edit keeps them on surviving directions and never spreads them to others.
 */
export const FACET_OWNED_METADATA = Object.freeze([
  'surfaceFinish',
  'componentInstanceId', 'sourcePlaneId', 'sourceComponentId', 'componentPart', 'componentTier', 'componentRole',
  'patternStudy', 'operationType',
]);

const direction = facet => normalizeIndex(facet.index, facet.indexTeeth ?? 96) / (facet.indexTeeth ?? 96);
const owned = (metadata = {}) => Object.fromEntries(FACET_OWNED_METADATA.filter(key => metadata[key] !== undefined)
  .map(key => [key, structuredClone(metadata[key])]));
export function layerMetadataOf(metadata = {}) {
  const result = { ...metadata };
  for (const key of FACET_OWNED_METADATA) delete result[key];
  return result;
}

/**
 * Layer-level metadata for a committed CUT edit, shared by the editor and MCP.
 * `meet` is the solved construction (target / secondTarget) or null.
 */
export function layerEditMetadata({ previous, patternMode, baseIndex, indexTeeth, facets, preform, ring, meet, now = new Date().toISOString() }) {
  const metadata = {
    ...layerMetadataOf(previous),
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    patternMode,
    primaryIndex: normalizeIndex(baseIndex, indexTeeth),
    integerIndexOnly: facets.every(facet => Number.isInteger(facet.index)),
  };
  if (preform === undefined) delete metadata.preform;
  else metadata.preform = Boolean(preform);
  if (ring) metadata.ring = ringCutMetadata(ring);
  else delete metadata.ring;
  if (meet) metadata.construction = {
    type: meet.secondTarget ? 'dual-meet' : meet.target.kind === 'edge-point' ? 'edge-meet' : 'vertex-meet',
    solverVersion: 2, primaryIndex: metadata.primaryIndex,
    target: snapshotMeetTarget(meet.target),
    ...(meet.secondTarget ? { secondTarget: snapshotMeetTarget(meet.secondTarget) } : {}),
  };
  else delete metadata.construction;
  return metadata;
}

/**
 * Facets of an edited layer. A surviving direction keeps its facet ID and its
 * own metadata (finish, lab identities); a new direction gets only the layer's.
 */
export function facetsAfterLayerEdit(resolved, previous, { patternId, label, metadata }) {
  const layer = layerMetadataOf(metadata), claimed = new Set(), ids = new Set();
  const facets = resolved.map(facet => {
    const original = previous.find(old => !claimed.has(old) && Math.abs(direction(old) - direction(facet)) < 1e-9);
    if (original) claimed.add(original);
    return { facet, original };
  });
  // Surviving IDs first, so a new direction can never take one of them.
  for (const { original } of facets) if (original) ids.add(original.id);
  return facets.map(({ facet, original }) => {
    let id = original?.id;
    if (!id) {
      const base = `${patternId}:${displayIndex(facet.index, facet.indexTeeth ?? 96)}`;
      id = base;
      for (let n = 2; ids.has(id); n++) id = `${base}~${n}`;
      ids.add(id);
    }
    return { ...facet, id, patternId, label, metadata: { ...layer, ...owned(original?.metadata) } };
  });
}
