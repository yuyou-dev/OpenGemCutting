import { VALID_REPEAT_COUNTS } from '../domain/faceting.js';

export const DESIGN_API_VERSION = '1.0';
const string = { type: 'string', minLength: 1, maxLength: 200 };
const targetKey = { type: 'string', minLength: 1, maxLength: 8192 };
const number = { type: 'number' };
const index = { type: 'integer', minimum: 0, maximum: 95 };
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
  repeat: { type: 'integer', enum: VALID_REPEAT_COUNTS },
  mirrorOffset: { type: 'integer', minimum: 0, maximum: 95 },
  patternMode: { type: 'string', enum: ['symmetric', 'arbitrary'] },
  customIndices: { type: 'string', maxLength: 400 },
  preform: { type: 'boolean' },
};
export const OPERATION_SCHEMA = object(
  {
    kind: {
      type: 'string',
      enum: ['cut', 'remove', 'rename', 'reorder', 'transform'],
    },
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
    rotationTeeth: { type: 'integer', minimum: -95, maximum: 95 },
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
    'Preview an atomic ordered sequence of CUT edits without changing the project. Existing patternId edits in place; a new id adds a group. Returns planId, exact solid diagnostics and removals requiring confirmation. Use design_view with planId to inspect.',
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
    'Commit a previously inspected plan as ONE undoable command. Confirm only the listed full removals. Stale revisions, manual drafts and unavailable workspaces are rejected.',
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
    'Inspect final logical CUT planes separately from stock surface pieces, volume, dimensions, Meet provenance and JSON roundtrip. Optional referenceTopology checks real named nodes and edges.',
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
    'Export the committed design as full editable JSON, vector PDF or preflighted ASC; mesh ASC remains blocked. Does not commit a draft.',
    object(
      {
        ...readScope,
        format: { type: 'string', enum: ['json', 'asc', 'pdf'] },
        locale: { type: 'string', enum: ['zh-CN', 'en'] },
      },
      ['sessionId', 'format'],
    ),
    false,
  ],
  [
    'project_create',
    'Create a separate project from the default cube, a stock template, a catalog preset, JSON or preflighted OBJ. Existing projects remain intact. Manual previews block switching.',
    object(
      {
        ...scope,
        name: string,
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
