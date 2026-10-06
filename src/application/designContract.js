import { CONCAVE_PRESETS } from './concaveTools.js';
import { CONCAVE_CUT_LIMITS } from '../domain/concaveCuts.js';
import { GRID_CUT_LIMITS, GRID_SYMMETRIES } from '../domain/gridCut.js';

export const DESIGN_API_VERSION = '1.0';
const string = { type: 'string', minLength: 1, maxLength: 200 };
const targetKey = { type: 'string', minLength: 1, maxLength: 8192 };
const number = { type: 'number' };
const index = { type: 'number', minimum: 0, maximum: 360 };
const object = (properties, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const array = (items, maxItems = 256) => ({ type: 'array', items, maxItems });
export const DRAFT_FIELDS = {
  industryAngle: { ...number, minimum: 0, maximum: 90 },
  depth: { ...number, minimum: 0 },
  baseIndex: index,
  indexTeeth: { type: 'integer', minimum: 1, maximum: 360 },
  repeat: { type: 'integer', minimum: 1, maximum: 360 },
  mirrorOffset: { type: 'number', minimum: 0, maximum: 360 },
  patternMode: { type: 'string', enum: ['symmetric', 'arbitrary', 'grid'] },
  customIndices: { type: 'string', maxLength: 400 },
  // Ring cut: L-fold sides, each cut by a fan of facets; indices are generated on the project wheel.
  // Ring cut kinds: fan (spacingDeg, one depth) or arc (bulge 0–1, jointly solved depths).
  ring: object({
    kind: { type: 'string', enum: ['fan', 'arc'] },
    symmetry: { type: 'integer', minimum: 2, maximum: 24 },
    subdivisions: { type: 'integer', minimum: 1, maximum: 9 },
    spacingDeg: { type: 'number', minimum: 0.1, maximum: 90 },
    bulge: { type: 'number', minimum: 0, maximum: 1 },
    rotation: { type: 'integer', minimum: 0, maximum: 359 },
  }, ['symmetry', 'subdivisions', 'rotation']),
  // Grid cut: a convex dome tool cut as a lattice of facets (square for symmetry 1/2/4,
  // hex or tri for 3/6). industryAngle is the edge angle, depth the apex depth and
  // baseIndex the whole-tooth rotation; angles and depths per cell are solved.
  grid: object({
    symmetry: { type: 'integer', enum: GRID_SYMMETRIES },
    mirror: { type: 'boolean' },
    lattice: { type: 'string', enum: ['square', 'hex', 'tri'] },
    columns: { type: 'integer', minimum: GRID_CUT_LIMITS.columns[0], maximum: GRID_CUT_LIMITS.columns[1] },
    rows: { type: 'integer', minimum: GRID_CUT_LIMITS.rows[0], maximum: GRID_CUT_LIMITS.rows[1] },
    rings: { type: 'integer', minimum: GRID_CUT_LIMITS.rings[0], maximum: GRID_CUT_LIMITS.rings[1] },
    scope: { type: 'string', enum: ['face', 'row'] },
    row: { type: 'integer', minimum: 0, maximum: 24 },
    rowCopies: { type: 'boolean' },
    extent: { type: 'number', minimum: GRID_CUT_LIMITS.extent[0], maximum: GRID_CUT_LIMITS.extent[1] },
  }, ['symmetry']),
  preform: { type: 'boolean' },
};
export const OPERATION_SCHEMA = object(
  {
    kind: {
      type: 'string',
      enum: ['cut', 'remove', 'rename', 'reorder', 'transform', 'replace-parameters', 'concave-tool', 'dissolve-ring', 'dissolve-grid'],
    },
    toolId: string,
    preset: { type: 'string', enum: CONCAVE_PRESETS.map(p => p.id) },
    repeat: { type: 'integer', minimum: 1, maximum: 120 },
    toolDepth: number,
    phaseDeg: number,
    width: { ...number, exclusiveMinimum: 0 },
    length: { ...number, exclusiveMinimum: 0 },
    tipAngle: { ...number, exclusiveMinimum: 0, exclusiveMaximum: 180 },
    patternId: string,
    label: string,
    region: { type: 'string', enum: ['crown', 'girdle', 'pavilion'] },
    draft: object(DRAFT_FIELDS),
    // Targets are looked up in the actual construction prefix, never accepted as fabricated coordinates.
    meet: object({
      a: targetKey,
      b: targetKey,
      ratioA: { ...number, minimum: 0, maximum: 1 },
      ratioB: { ...number, minimum: 0, maximum: 1 },
      clear: { type: 'boolean' },
    }),
    order: array(string),
    deltaZ: number,
    scale: { ...number, minimum: 0.02 },
    rotationTeeth: { type: 'number', minimum: -360, maximum: 360 },
    indexTeeth: { type: 'integer', minimum: 1, maximum: 360 },
    parameterGroup: object({
      kind: { type: 'string', enum: ['facet-parameter-group'] },
      schemaVersion: { type: 'integer', enum: [1] },
      group: { type: 'string', enum: ['stock', 'planar', 'concave'] },
      stock: { type: 'object' },
      indexGear: { type: 'object' },
      cuttingReference: { type: 'object' },
      machining: { type: 'object' },
      facets: array({ type: 'object' }, 4096),
      concaveCuts: array({ type: 'object' }, CONCAVE_CUT_LIMITS.operations),
    }, ['kind', 'schemaVersion', 'group']),
  },
  ['kind'],
);
const scope = { sessionId: string, projectId: string, revision: string };
const readScope = { sessionId: string };
export const DESIGN_TOOLS = [
  [
    'design_read',
    'Read the bound project, committed CUT groups, revision, edit capabilities and save status. Read this before planning changes.',
    object(readScope, ['sessionId']),
    false,
  ],
  [
    'design_plan',
    'Preview an atomic sequence of CUT edits or independent planar and concave parameter replacement (physical stock is locked after project creation). Existing patternId edits in place; a new id adds a group. draft.ring makes a ring cut on the project wheel: kind fan (each of L sides cut by a fan of facets, one depth) or arc (each side bulged into an arc and split into chords; depth sets the primary, farthest facet and the others follow solved ratios). kind dissolve-ring turns a ring layer into ordinary layers without moving any plane (an arc splits into one layer per depth level); an explicit draft.patternMode changes the layer to that mode. Returns planId, exact solid diagnostics and covered-face feedback. Use design_view with planId to inspect.',
    object(
      {
        ...scope,
        operations: { ...array(OPERATION_SCHEMA, 128), minItems: 1 },
      },
      Object.keys(scope).concat('operations'),
    ),
    false,
  ],
  [
    'design_commit',
    'Commit a previously inspected plan as ONE undoable command. Covered operations remain in history and need no additional approval. Stale revisions, manual drafts and unavailable workspaces are rejected.',
    object(
      { ...scope, planId: string, confirmedRemovals: array(string) },
      Object.keys(scope).concat('planId'),
    ),
    true,
  ],
  [
    'design_history',
    'Undo or redo the same history used by the manual editor. Requires an idle editable workspace and current revision.',
    object(
      { ...scope, direction: { type: 'string', enum: ['undo', 'redo'] } },
      Object.keys(scope).concat('direction'),
    ),
    true,
  ],
  [
    'design_topology',
    'Read real vertices, edges and faces at the committed end or BEFORE a pattern. Use returned topologyKey / edgeTopologyKey for Meet, tied to this revision.',
    object(
      {
        ...readScope,
        beforePatternId: string,
        offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
      },
      ['sessionId'],
    ),
    false,
  ],
  [
    'design_jump',
    'List exact existing vertex targets reachable by a CUT or a second Meet, without changing the document. Editing uses the prefix before patternId.',
    object(
      {
        ...readScope,
        patternId: string,
        region: { type: 'string', enum: ['crown', 'pavilion'] },
        draft: object(DRAFT_FIELDS),
        targetA: targetKey,
      },
      ['sessionId', 'region', 'draft'],
    ),
    false,
  ],
  [
    'design_view',
    'Return a PNG orthographic/isometric view from the exact committed solid or an uncommitted plan. Views share the real technical projection renderer; no AI-simulated geometry.',
    object(
      {
        ...readScope,
        planId: string,
        view: {
          type: 'string',
          enum: ['isometric', 'top', 'bottom', 'front', 'side'],
        },
      },
      ['sessionId', 'view'],
    ),
    false,
  ],
  [
    'design_inspect',
    'Inspect final logical CUT planes separately from stock surface pieces, volume, dimensions, Meet provenance and JSON roundtrip. Includes advisory meetAudit measurements for committed planar designs; active concave tools return unsupported, never a clean substitute. Candidate counts do not gate commits or aesthetic acceptance. Optional referenceTopology checks real named nodes and edges.',
    object(
      { ...readScope, planId: string, referenceTopology: { type: 'object' } },
      ['sessionId'],
    ),
    false,
  ],
  [
    'design_projection',
    'Compare an independent reference graph with actual nodes and edges using one similarity transform. Returns per-node deviations, missing connections and extra visible vertices. Convex CUT solids only; never infer aesthetic acceptance.',
    object(
      {
        ...readScope,
        planId: string,
        graph: { type: 'object' },
        faceMap: { type: 'object' },
        view: { type: 'string', enum: ['top', 'bottom', 'front', 'side'] },
        scale: { ...number, minimum: 0.000001 },
        center: { ...array(number, 2), minItems: 2 },
        rotation: number,
      },
      ['sessionId', 'graph', 'faceMap', 'view', 'scale'],
    ),
    false,
  ],
  [
    'design_export',
    'Export the committed design as full editable JSON, vector PDF, or GemCad ASC / Gem Cut Studio GCS with the final effective facets (every loss reported in diagnostics; ASC and GCS are read back and returned only when the shape matches, with a kept/approximate/lost report); mesh or active curved-tool geometry requires JSON. PDF surfaceFinish defaults to polished; annotated marks frosted faces in views and facet tables. Does not commit a draft.',
    object(
      {
        ...readScope,
        format: { type: 'string', enum: ['json', 'asc', 'gcs', 'pdf'] },
        locale: { type: 'string', enum: ['zh-CN', 'en'] },
        surfaceFinish: { type: 'string', enum: ['polished', 'annotated'] },
      },
      ['sessionId', 'format'],
    ),
    false,
  ],
  [
    'project_create',
    'Choose indexTeeth for the project equipment (default 96). Create a separate project from the default cube, a stock template, a catalog preset, JSON or preflighted OBJ. The default start takes outline cylinder (default) or square (4 girdle facets, sides at index 0/24/48/72 on 96; the wheel must divide by 4) and, for a cylinder, girdleFacets: a whole-tooth division of the wheel of at least 8 (default nearest 32). Existing projects remain intact. Manual previews block switching.',
    object(
      {
        ...scope,
        name: string,
        indexTeeth: { type: 'integer', minimum: 1, maximum: 360 },
        outline: { type: 'string', enum: ['cylinder', 'square'] },
        girdleFacets: { type: 'integer', minimum: 4, maximum: 360 },
        stockPresetId: string,
        presetId: string,
        json: { type: 'string', maxLength: 20971520 },
        obj: { type: 'string', maxLength: 20971520 },
        unit: { type: 'string', enum: ['unitless', 'mm', 'cm', 'm', 'in'] },
        upAxis: { type: 'string', enum: ['x', 'y', 'z'] },
      },
      Object.keys(scope).concat('name'),
    ),
    true,
  ],
  [
    'project_save',
    'Flush the committed snapshot to this browser project store. Returns actual success or conflict; JSON remains the portable archive across ports and browsers.',
    object({ ...scope }, Object.keys(scope)),
    true,
  ],
  [
    'preset_list',
    'Search the same curated catalog and initial stock templates used by the manual editor. Pagination prevents dumping the full catalog into context.',
    object(
      {
        ...readScope,
        query: { type: 'string', maxLength: 200 },
        offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      ['sessionId'],
    ),
    false,
  ],
].map(([name, description, inputSchema, mutates]) =>
  Object.freeze({ name, description, inputSchema, mutates }),
);

// Small shared JSON-schema subset for this public contract. MCP and browser validate the same inputs.
export function validateInput(schema, value, path = 'arguments') {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new TypeError(`${path}: expected object`);
    for (const key of schema.required ?? [])
      if (value[key] === undefined)
        throw new TypeError(`${path}.${key}: required`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key])
        validateInput(schema.properties[key], item, `${path}.${key}`);
      else if (schema.additionalProperties === false)
        throw new TypeError(`${path}.${key}: unknown parameter`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new TypeError(`${path}: expected array`);
    if (value.length > schema.maxItems || value.length < (schema.minItems ?? 0))
      throw new RangeError(`${path}: invalid array length`);
    value.forEach((item, i) =>
      validateInput(schema.items, item, `${path}[${i}]`),
    );
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (
      !Number.isFinite(value) ||
      (schema.type === 'integer' && !Number.isInteger(value))
    )
      throw new TypeError(`${path}: expected ${schema.type}`);
    if (value < schema.minimum || value > schema.maximum)
      throw new RangeError(`${path}: out of range`);
  } else if (typeof value !== schema.type)
    throw new TypeError(`${path}: expected ${schema.type}`);
  if (
    schema.type === 'string' &&
    (value.length < (schema.minLength ?? 0) || value.length > schema.maxLength)
  )
    throw new RangeError(`${path}: invalid text length`);
  if (schema.enum && !schema.enum.includes(value))
    throw new RangeError(`${path}: expected ${schema.enum.join(', ')}`);
}
export function validateTool(name, args) {
  const tool = DESIGN_TOOLS.find((item) => item.name === name);
  if (!tool) throw new Error(`Unknown design tool: ${name}`);
  validateInput(tool.inputSchema, args);
  return tool;
}
