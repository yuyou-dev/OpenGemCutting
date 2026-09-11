import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbenchDocument } from '../domain/document.js';
import {
  createCommandHistory,
  executeFacetingCommand,
  createReplaceDocumentCommand,
  undoFacetingCommand,
  exportFacetingJSON,
  importFacetingJSON,
} from '../domain/faceting.js';
import {
  createPresetStockDocument,
  STOCK_PRESETS,
} from '../domain/stockPresets.js';
import {
  planDesign,
  inspectDesign,
  solveDocument,
  topologyOf,
  constructionPrefix,
} from './designOperations.js';
import { validateTool } from './designContract.js';
const cut = {
  kind: 'cut',
  patternId: 'crown-main',
  region: 'crown',
  draft: { industryAngle: 35, depth: 0.6, baseIndex: 0, repeat: 8 },
};

test('atomic design planning leaves input unchanged and supports one-step undo and exact JSON reopen', () => {
  const initial = createWorkbenchDocument('same source');
  const before = exportFacetingJSON(initial);
  const plan = planDesign(initial, [
    cut,
    {
      kind: 'cut',
      patternId: 'pavilion-main',
      region: 'pavilion',
      draft: { industryAngle: 42, depth: 0.8, baseIndex: 0, repeat: 8 },
    },
  ]);
  assert.equal(exportFacetingJSON(initial), before);
  const result = inspectDesign(plan.document);
  assert.ok(result.metrics.volume > 0);
  assert.ok(
    result.groups.find((g) => g.patternId === 'crown-main').effectivePlanes > 0,
  );
  assert.ok(
    result.groups.find((g) => g.patternId === 'pavilion-main').effectivePlanes >
      0,
  );
  assert.equal(result.roundtripVolumeError, 0);
  const history = executeFacetingCommand(
    createCommandHistory(initial),
    createReplaceDocumentCommand(plan.document),
  );
  assert.equal(history.commands.length, 1);
  assert.equal(
    exportFacetingJSON(undoFacetingCommand(history).present),
    before,
  );
  assert.deepEqual(
    inspectDesign(importFacetingJSON(exportFacetingJSON(plan.document))),
    result,
  );
});
test('a bad later step cannot partially change the source; fractional indices and unknown fields are rejected', () => {
  const initial = createWorkbenchDocument('source');
  const original = exportFacetingJSON(initial);
  assert.throws(
    () =>
      planDesign(initial, [
        cut,
        { ...cut, patternId: 'bad', draft: { depth: 100 } },
      ]),
    /材料|结构/,
  );
  assert.equal(exportFacetingJSON(initial), original);
  assert.throws(
    () => planDesign(initial, [{ ...cut, draft: { baseIndex: 2.2 } }]),
    /integer/,
  );
  assert.throws(
    () => planDesign(initial, [{ ...cut, draft: { dept: 0.3 } }]),
    /unknown/,
  );
});
test('edits keep original sequence and table constraints, empty CUTs are blocked', () => {
  const initial = createWorkbenchDocument('source');
  assert.throws(
    () => planDesign(initial, [{ ...cut, draft: { depth: 0 } }]),
    /有效面/,
  );
  assert.throws(
    () =>
      planDesign(initial, [
        { kind: 'cut', patternId: 'table-facet', draft: { industryAngle: 5 } },
      ]),
    /结构约束/,
  );
  assert.throws(
    () => planDesign(initial, [{ kind: 'remove', patternId: 'table-facet' }]),
    /台面/,
  );
  const withCut = planDesign(initial, [cut]).document;
  const edited = planDesign(withCut, [
    { kind: 'cut', patternId: 'crown-main', draft: { industryAngle: 36 } },
  ]).document;
  assert.deepEqual(
    inspectDesign(edited).groups.map((g) => g.patternId),
    inspectDesign(withCut).groups.map((g) => g.patternId),
  );
});
test('real mesh retains immutable stock and counts a multi-piece plane once', () => {
  const initial = createPresetStockDocument(
    STOCK_PRESETS.find((p) => p.id === 'letter-a'),
  );
  const plan = planDesign(initial, [
    {
      kind: 'cut',
      patternId: 'mesh-table',
      region: 'crown',
      draft: { industryAngle: 0, depth: 0.3, repeat: 1, baseIndex: 0 },
    },
  ]);
  assert.equal(plan.document.stock, initial.stock);
  const result = inspectDesign(plan.document);
  assert.equal(result.effectiveCutPlanes, 1);
  assert.ok(result.stockSurfacePieces > 0);
  assert.equal(result.roundtripVolumeError, 0);
});
test('Meet uses exact prefix identities and refuses fabricated targets', () => {
  const document = planDesign(createWorkbenchDocument('source'), [
    cut,
  ]).document;
  assert.ok(
    topologyOf(constructionPrefix(document, 'crown-main')).vertices.length > 0,
  );
  assert.throws(
    () =>
      planDesign(document, [
        {
          kind: 'cut',
          patternId: 'new-meet',
          region: 'crown',
          meet: { a: 'invented' },
        },
      ]),
    /真实施工阶段/,
  );
  const volume = inspectDesign(document).metrics.volume;
  const renamed = planDesign(document, [
    { kind: 'rename', patternId: 'crown-main', label: '主冠面' },
  ]).document;
  assert.equal(inspectDesign(renamed).metrics.volume, volume);
  assert.ok(solveDocument(renamed).vertices.length);
});
test('tool contract validates mandatory scope and refuses undocumented arguments', () => {
  assert.throws(
    () => validateTool('design_commit', { sessionId: 's', planId: 'p' }),
    /projectId/,
  );
  assert.throws(
    () => validateTool('design_read', { sessionId: 's', execute: 'code' }),
    /unknown/,
  );
});

test('independently dimensioned square reference produces the specified nodes and connections', async () => {
  const { readFile } = await import('node:fs/promises');
  const { auditProjection } = await import('../domain/projectionAudit.js');
  const reference = JSON.parse(
    await readFile(
      new URL('../../docs/mcp/examples/square-reference.json', import.meta.url),
    ),
  );
  const operations = JSON.parse(
    await readFile(
      new URL(
        '../../docs/mcp/examples/square-operations.json',
        import.meta.url,
      ),
    ),
  );
  const plan = planDesign(
    createWorkbenchDocument('dimensioned square'),
    operations,
  );
  const result = auditProjection(
    solveDocument(plan.document),
    reference.graph,
    reference.faceMap,
    { scale: 400, center: [400, 400] },
  );
  assert.equal(result.missingNodes, 0);
  assert.equal(result.missingEdges, 0);
  assert.ok(Math.max(...result.nodes.map((n) => n.errorPixels)) < 1e-6);
  assert.equal(inspectDesign(plan.document).effectiveCutPlanes, 13);
  assert.ok(Math.abs(inspectDesign(plan.document).dimensions.z - 1.3) < 1e-9);
});
