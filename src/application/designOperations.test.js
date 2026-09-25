import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorkbenchDocument } from '../domain/document.js';
import {
  createCommandHistory,
  executeFacetingCommand,
  createReplaceDocumentCommand,
  undoFacetingCommand,
  exportFacetingJSON,
  importFacetingJSON,
  createFacetingDocument,
  resolveFacetPattern,
  redoFacetingCommand,
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
  exportParameterGroup,
  prepareParameterGroupReplacement,
} from './designOperations.js';
import { measurePolyhedron } from '../domain/geometry.js';
import { buildConstructionStages } from '../domain/constructionHistory.js';
import { applyConcaveCuts } from '../domain/documentGeometry.js';
import { createCuttingReplay } from '../domain/cuttingAssistant.js';
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
test('a bad later step cannot partially change the source; fractional indices remain exact and unknown fields are rejected', () => {
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
  const fractional = planDesign(initial, [{ ...cut, draft: { ...cut.draft, baseIndex: 2.2 } }]);
  assert.equal(fractional.document.facets.find((f) => f.patternId === cut.patternId).baseIndex, 2.2);
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

test('report export language is optional and restricted without changing design protocol fields', () => {
  const args = { sessionId: 'test-browser', format: 'pdf' };
  for (const locale of ['zh-CN', 'en']) assert.doesNotThrow(() => validateTool('design_export', { ...args, locale }));
  assert.doesNotThrow(() => validateTool('design_export', args));
  assert.throws(() => validateTool('design_export', { ...args, locale: 'fr' }), /expected zh-CN, en/);
});

test('PDF export surface finish is optional, defaults to polished and matches the web choices', async () => {
  const { REPORT_SURFACE_MODES } = await import('../report/pdfReport.js');
  const args = { sessionId: 'test-browser', format: 'pdf' };
  for (const surfaceFinish of REPORT_SURFACE_MODES) assert.doesNotThrow(() => validateTool('design_export', { ...args, surfaceFinish }));
  assert.throws(() => validateTool('design_export', { ...args, surfaceFinish: 'matte' }), /expected polished, annotated/);
});

test('design export offers Gem Cut Studio beside JSON, ASC and PDF', async () => {
  for (const format of ['json', 'asc', 'gcs', 'pdf']) assert.doesNotThrow(() => validateTool('design_export', { sessionId: 'test-browser', format }));
  assert.throws(() => validateTool('design_export', { sessionId: 'test-browser', format: 'gem' }), /expected json, asc, gcs, pdf/);
  const { inspectProjectSource, planTarget } = await import('./formatCenter.js');
  const unfinished = planTarget(inspectProjectSource(createWorkbenchDocument('gcs export')), 'gcs');
  assert.equal(unfinished.outcome, 'blocked', 'an unclosed stone is refused rather than guessed');
  const preset = importFacetingJSON(await readFile(new URL('../../public/presets/documents/100058-pc-07-001c-square-emerald-1-4.json', import.meta.url), 'utf8'));
  const plan = planTarget(inspectProjectSource(preset), 'gcs');
  assert.equal(plan.verified, true);
  assert.match(plan.text, /^<\?xml[\s\S]*<GemCutStudio version="1000">/);
});

test('covered structural tiers remain editable and return with one-step undo', () => {
  const initial = createWorkbenchDocument('coverage');
  const plan = planDesign(initial, [{
    kind: 'cut', patternId: 'lower-table', region: 'crown',
    draft: { industryAngle: 0, depth: 0.4, repeat: 1, baseIndex: 0 },
  }]);
  assert.deepEqual(plan.requiredConfirmations, []);
  assert.equal(plan.changes[0].policy, 'warn');
  assert.ok(plan.document.facets.some((f) => f.patternId === 'table-facet'));
  assert.equal(inspectDesign(plan.document).groups.find((g) => g.patternId === 'table-facet').effectivePlanes, 0);
  const edited = planDesign(plan.document, [{
    kind: 'cut', patternId: 'table-facet', draft: { depth: 0.3 },
  }]);
  assert.equal(edited.document.facets.find((f) => f.patternId === 'table-facet').depth, 0.3);
  assert.equal(inspectDesign(edited.document).groups.find((g) => g.patternId === 'table-facet').effectivePlanes, 0);
  const restored = planDesign(edited.document, [{ kind: 'remove', patternId: 'lower-table' }]);
  assert.equal(inspectDesign(restored.document).groups.find((g) => g.patternId === 'table-facet').effectivePlanes, 1);
  const history = executeFacetingCommand(createCommandHistory(initial), createReplaceDocumentCommand(plan.document));
  assert.equal(exportFacetingJSON(undoFacetingCommand(history).present), exportFacetingJSON(initial));
  assert.equal(exportFacetingJSON(redoFacetingCommand(undoFacetingCommand(history)).present), exportFacetingJSON(plan.document));
});

test('120 tooth five-fold cuts use the same exact geometry in application and replay', () => {
  const initial = createFacetingDocument({ name: 'five-fold', indexGear: { teeth: 120 } });
  const plan = planDesign(initial, [{
    kind: 'cut', patternId: 'fivefold', region: 'girdle',
    draft: { industryAngle: 90, depth: 0.25, baseIndex: 0.5, indexTeeth: 120, repeat: 5 },
  }]);
  assert.equal(plan.document.facets.length, 5);
  assert.ok(plan.document.facets.every((f) => f.indexTeeth === 120));
  assert.equal(plan.document.facets[0].baseIndex, 0.5);
  const replay = createCuttingReplay(plan.document);
  assert.ok(replay.steps.every((step) => step.indexTeeth === 120));
  assert.ok(Math.abs(measurePolyhedron(replay.solidAt(replay.total)).volume - measurePolyhedron(solveDocument(plan.document)).volume) < 1e-9);
});

test('three independent parameter packages roundtrip, combine and undo through shared commands', () => {
  const initial = createFacetingDocument({ name: 'three groups' });
  const planar = resolveFacetPattern({ patternId: 'top', region: 'crown', industryAngleDeg: 0, depth: 0.25, repeat: 1 });
  const tool = { id: 'scoop', type: 'sphere', position: [1, 0, 0], radius: 0.4, repeat: 1, segments: 16 };
  const packages = [
    { kind: 'facet-parameter-group', schemaVersion: 1, group: 'stock', stock: initial.stock },
    { kind: 'facet-parameter-group', schemaVersion: 1, group: 'planar', facets: planar },
    { kind: 'facet-parameter-group', schemaVersion: 1, group: 'concave', concaveCuts: [tool] },
  ];
  const plan = planDesign(initial, packages.slice(1).map((parameterGroup) => ({ kind: 'replace-parameters', parameterGroup })));
  assert.equal(plan.document.facets.length, 1);
  assert.equal(plan.document.concaveCuts.length, 1);
  assert.deepEqual(plan.document.stock, initial.stock);
  assert.deepEqual(exportParameterGroup(plan.document, 'planar').facets, plan.document.facets);
  assert.equal(exportParameterGroup(plan.document, 'concave').concaveCuts[0].id, 'scoop');
  const before = exportFacetingJSON(plan.document);
  assert.throws(() => prepareParameterGroupReplacement(plan.document, {
    ...packages[0], stock: { ...initial.stock, size: 2.4 },
  }), error => error.code === 'STOCK_LOCKED');
  const cleared = prepareParameterGroupReplacement(plan.document, { ...packages[2], concaveCuts: [] });
  assert.deepEqual(cleared.document.facets, plan.document.facets);
  assert.deepEqual(cleared.document.stock, plan.document.stock);
  assert.ok(measurePolyhedron(cleared.solid).volume > measurePolyhedron(solveDocument(plan.document)).volume);
  const history = executeFacetingCommand(createCommandHistory(plan.document), cleared.command);
  assert.equal(exportFacetingJSON(undoFacetingCommand(history).present), before);
  const stages = buildConstructionStages(plan.document);
  const replay = createCuttingReplay(plan.document);
  assert.deepEqual(stages, buildConstructionStages(cleared.document));
  assert.ok(Math.abs(measurePolyhedron(stages.at(-1).afterSolid).volume - measurePolyhedron(cleared.solid).volume) < 1e-8);
  assert.ok(Math.abs(measurePolyhedron(applyConcaveCuts(plan.document, stages.at(-1).afterSolid)).volume - measurePolyhedron(solveDocument(plan.document)).volume) < 1e-8);
  assert.ok(Math.abs(measurePolyhedron(replay.solidAt(replay.total)).volume - measurePolyhedron(solveDocument(plan.document)).volume) < 1e-8);
  assert.equal(exportFacetingJSON(importFacetingJSON(before)), before);
  assert.throws(() => prepareParameterGroupReplacement(plan.document, { ...packages[2], stock: initial.stock }), /只包含/);
  assert.throws(() => prepareParameterGroupReplacement(plan.document, { ...packages[2], concaveCuts: [{ ...tool, radius: -1 }] }), /radius/);
  assert.equal(exportFacetingJSON(plan.document), before);
});

test('small-wheel application defaults preserve the same intended azimuth and custom index preferences', () => {
  const initial = createFacetingDocument({ indexGear: 32 });
  const symmetric = planDesign(initial, [{ kind: 'cut', patternId: 'small-wheel', region: 'girdle' }]);
  assert.ok(symmetric.document.facets.every(facet => facet.baseIndex === 12 && facet.indexTeeth === 32));
  const custom = planDesign(initial, [{ kind: 'cut', patternId: 'custom-wheel', region: 'crown',
    draft: { patternMode: 'arbitrary', baseIndex: 2 / 3, depth: 0.3 } }]);
  assert.equal(custom.document.facets.length, 8);
  assert.ok(custom.document.facets.every(facet => facet.index >= 0 && facet.index < 32));
});

test('editing a mixed-finish tier preserves each surviving member instead of copying its first finish', () => {
  const initial = planDesign(createWorkbenchDocument(), [cut]).document;
  const members = initial.facets.filter(f => f.patternId === cut.patternId);
  members[0].metadata.surfaceFinish = { version: 1, model: 'ggx-dielectric', state: 'frosted', alpha: .28, scatter: .15 };
  members[2].metadata.surfaceFinish = { version: 1, model: 'ggx-dielectric', state: 'polished', alpha: 0 };
  const snapshot = exportFacetingJSON(initial);
  const next = planDesign(initial, [{ kind:'cut', patternId:cut.patternId, draft:{industryAngle:36} }]).document;
  const after = next.facets.filter(f => f.patternId === cut.patternId);
  for (const f of after) assert.deepEqual(f.metadata.surfaceFinish, members.find(old => old.index === f.index).metadata.surfaceFinish);
  assert.equal(exportFacetingJSON(initial), snapshot);
  const history = executeFacetingCommand(createCommandHistory(initial), createReplaceDocumentCommand(next));
  assert.equal(exportFacetingJSON(undoFacetingCommand(history).present), snapshot);
  assert.deepEqual(redoFacetingCommand(undoFacetingCommand(history)).present.facets, history.present.facets);
});
