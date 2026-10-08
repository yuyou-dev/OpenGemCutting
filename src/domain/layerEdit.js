import { displayIndex, normalizeIndex } from './faceting.js';
import { ringCutMetadata } from './ringCut.js';
import { gridCutMetadata } from './gridCut.js';
import { compositeToolMetadata } from './compositeTools.js';
import { snapshotMeetTarget } from './cutConstruction.js';

const direction = facet => normalizeIndex(facet.index, facet.indexTeeth ?? 96) / (facet.indexTeeth ?? 96);
// Only declared layer fields may propagate to another face. Unknown optional
// metadata belongs to its original face, just like an opaque extension.
const LAYER_METADATA = new Set([
  'createdAt', 'updatedAt', 'patternMode', 'primaryIndex', 'integerIndexOnly',
  'preform', 'construction', 'ring', 'grid', 'composite',
]);
const owned = (metadata = {}) => Object.fromEntries(Object.entries(metadata)
  .filter(([key]) => !LAYER_METADATA.has(key) && key !== 'gridCell' && key !== 'compositeCell')
  .map(([key, value]) => [key, structuredClone(value)]));
export function layerMetadataOf(metadata = {}) {
  return Object.fromEntries(Object.entries(metadata ?? {}).filter(([key]) => LAYER_METADATA.has(key)));
}

/**
 * Layer-level metadata for a committed CUT edit, shared by the editor and MCP.
 * `meet` is the solved construction (target / secondTarget) or null.
 */
export function layerEditMetadata({ previous, patternMode, baseIndex, indexTeeth, facets, preform, ring, grid, composite, meet, now = new Date().toISOString() }) {
  const metadata = {
    ...layerMetadataOf(previous),
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    // Grid and composite layers are stored as arbitrary-index layers plus their tool parameters.
    patternMode: patternMode === 'grid' || patternMode === 'composite' ? 'arbitrary' : patternMode,
    primaryIndex: normalizeIndex(baseIndex, indexTeeth),
    integerIndexOnly: facets.every(facet => Number.isInteger(facet.index)),
  };
  // Cell identities belong to single facets; facetsAfterLayerEdit restores each one.
  delete metadata.gridCell;
  delete metadata.compositeCell;
  if (preform === undefined) delete metadata.preform;
  else metadata.preform = Boolean(preform);
  if (ring) metadata.ring = ringCutMetadata(ring);
  else delete metadata.ring;
  // `grid`: { grid, edgeAngle, depth, rotation } of the committed tool.
  if (grid) metadata.grid = gridCutMetadata(grid);
  else delete metadata.grid;
  // `composite`: { composite, angle, depth, rotation } of the committed tool.
  if (composite) metadata.composite = compositeToolMetadata(composite);
  else delete metadata.composite;
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
    // A grid or composite cell is its own identity: several cells can share one direction.
    const cell = facet.metadata?.gridCell ?? facet.metadata?.compositeCell;
    const cellKey = facet.metadata?.gridCell !== undefined ? 'gridCell' : 'compositeCell';
    const original = cell !== undefined
      ? previous.find(old => !claimed.has(old) && old.metadata?.[cellKey] === cell)
      : previous.find(old => !claimed.has(old) && Math.abs(direction(old) - direction(facet)) < 1e-9);
    if (original) claimed.add(original);
    return { facet, original };
  });
  // Surviving IDs first, so a new direction can never take one of them.
  for (const { original } of facets) if (original) ids.add(original.id);
  return facets.map(({ facet, original }) => {
    const cell = facet.metadata?.gridCell ?? facet.metadata?.compositeCell;
    const cellKey = facet.metadata?.gridCell !== undefined ? 'gridCell' : 'compositeCell';
    let id = original?.id;
    if (!id) {
      const base = cell !== undefined ? `${patternId}:${cell}` : `${patternId}:${displayIndex(facet.index, facet.indexTeeth ?? 96)}`;
      id = base;
      for (let n = 2; ids.has(id); n++) id = `${base}~${n}`;
      ids.add(id);
    }
    const samePlane = original && original.region === facet.region
      && direction(original) === direction(facet)
      && original.industryAngleDeg === facet.industryAngleDeg && original.depth === facet.depth;
    return { ...facet, id, patternId, label,
      ...(samePlane ? { plane: original.plane } : {}),
      ...(original?.extensions === undefined ? {} : { extensions: structuredClone(original.extensions) }),
      metadata: { ...layer, ...owned(original?.metadata), ...(cell !== undefined ? { [cellKey]: cell } : {}) } };
  });
}
