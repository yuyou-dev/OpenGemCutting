import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import { COMPOSITE_TOOLS, compositeToolDefaults } from '../domain/compositeTools.js';
import { createWorkbenchDocument } from '../domain/document.js';
import { exportFacetingJSON, importFacetingJSON, createCommandHistory, executeFacetingCommand, createReplaceDocumentCommand, undoFacetingCommand, redoFacetingCommand } from '../domain/faceting.js';
import { OPERATION_SCHEMA, validateInput, TOOL_CATALOG } from './designContract.js';
import { planDesign, inspectDesign } from './designOperations.js';
const operation = (tool, region = 'crown', snap = 'exact') => ({ kind: 'cut', patternId: 'tool', region, draft: {
  industryAngle: 34, depth: .6, baseIndex: 0,
  composite: { tool, params: compositeToolDefaults(tool, region), extent: .8, snap },
} });
const planes = doc => doc.facets.map(f => JSON.stringify(f.plane)).sort();

test('every published composite tool can plan, reopen, edit, dissolve and undo without losing stock or planes', () => {
  const initial = createWorkbenchDocument('MCP tools');
  const original = exportFacetingJSON(initial);
  for (const tool of COMPOSITE_TOOLS.filter(t => ['tier','fancy'].includes(t.engine))) {
    for (const region of tool.regions) {
      const op = operation(tool.id, region);
      const created = planDesign(initial, [op]).document;
      assert.equal(exportFacetingJSON(initial), original);
      assert.equal(created.stock, initial.stock);
      const reopened = importFacetingJSON(exportFacetingJSON(created));
      assert.deepEqual(planes(reopened), planes(created), tool.id);
      const unchanged = planDesign(reopened, [{kind:'cut', patternId:'tool', draft:{}}]).document;
      assert.deepEqual(planes(unchanged), planes(reopened), tool.id);
      const group = inspectDesign(unchanged).groups.find(g => g.patternId === 'tool');
      assert.equal(group.toolReport.tool.id, tool.id);
      assert.equal(group.toolReport.facets, group.generatedPlanes);
      assert.ok(group.toolReport.levels > 0);
      const before = group.draft;
      const edited = planDesign(unchanged, [{kind:'cut', patternId:'tool', draft:{composite:{tool:tool.id, extent:.9}}}]).document;
      const after = inspectDesign(edited).groups.find(g => g.patternId === 'tool').draft;
      assert.deepEqual(after.composite.params, before.composite.params);
      assert.equal(after.composite.snap, 'exact');
      assert.equal(after.composite.version, before.composite.version);
      const dissolved = planDesign(edited, [{kind:'dissolve-composite',patternId:'tool'}]).document;
      assert.deepEqual(planes(dissolved), planes(edited));
      assert.equal(new Set(dissolved.facets.map(f=>f.id)).size, dissolved.facets.length);
      const history = executeFacetingCommand(createCommandHistory(edited), createReplaceDocumentCommand(dissolved));
      assert.deepEqual(undoFacetingCommand(history).present, edited);
      assert.deepEqual(redoFacetingCommand(undoFacetingCommand(history)).present, dissolved);
    }
  }
});

test('tool schemas and shared validation agree on unknown fields, ranges, choices and exclusive bounds', () => {
  const valid = new Ajv({strict:false}).compile(OPERATION_SCHEMA);
  assert.equal(TOOL_CATALOG.length, COMPOSITE_TOOLS.length);
  for (const tool of COMPOSITE_TOOLS.filter(t=>['tier','fancy'].includes(t.engine))) {
    const op = operation(tool.id);
    assert.equal(valid(op), true, JSON.stringify(valid.errors));
    assert.doesNotThrow(()=>validateInput(OPERATION_SCHEMA, op));
    for (const bad of [ {...op, draft:{...op.draft, composite:{tool:tool.id,params:{typo:1}}}},
      {...op, draft:{...op.draft, composite:{tool:tool.id,extent:0}}} ]) {
      assert.equal(valid(bad), false);
      assert.throws(()=>validateInput(OPERATION_SCHEMA,bad));
    }
  }
  const zeroWidth = {kind:'concave-tool',toolId:'triangle',preset:'triangle-groove',width:0};
  assert.equal(valid(zeroWidth), false);
  assert.throws(()=>validateInput(OPERATION_SCHEMA,zeroWidth));
});

test('saved tool identity and algorithm version cannot be changed through MCP', () => {
  const created = planDesign(createWorkbenchDocument('locks'), [operation('step')]).document;
  for(const composite of [{tool:'brilliant'}, {tool:'step',version:1}])
    assert.throws(()=>planDesign(created,[{kind:'cut',patternId:'tool',draft:{composite}}]), {code:'LOCKED_PARAMETER'});
  assert.throws(()=>planDesign(created,[{kind:'cut',patternId:'tool',draft:{grid:{symmetry:4}}}]), {code:'LOCKED_PARAMETER'});
  const old = operation('step'); old.draft.composite.version = 1;
  const legacy = planDesign(createWorkbenchDocument('legacy'),[old]).document;
  const edited = planDesign(legacy,[{kind:'cut',patternId:'tool',draft:{composite:{tool:'step',params:{layers:2}}}}]).document;
  assert.equal(inspectDesign(edited).groups.find(g=>g.patternId==='tool').draft.composite.version,1);
});
