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
import { validateTool, validateInput, OPERATION_SCHEMA } from './designContract.js';
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

test('editing a layer keeps each surviving facet ID and lab identity; new directions inherit only layer metadata', () => {
  const initial = planDesign(createWorkbenchDocument(), [cut]).document;
  const members = initial.facets.filter(f => f.patternId === cut.patternId);
  // A preset-studio component and a pattern-lab study record identities per facet.
  members.forEach((f, i) => Object.assign(f.metadata, { componentInstanceId: 'inst-1', sourcePlaneId: `saved-${i}`, patternStudy: { version: 1, sourcePlaneId: `p-${i}` } }));
  const same = planDesign(initial, [{ kind: 'cut', patternId: cut.patternId, draft: { industryAngle: 36 } }]).document;
  const after = same.facets.filter(f => f.patternId === cut.patternId);
  assert.deepEqual(after.map(f => f.id), members.map(f => f.id));
  for (const f of after) {
    const old = members.find(m => m.index === f.index);
    assert.equal(f.metadata.sourcePlaneId, old.metadata.sourcePlaneId);
    assert.deepEqual(f.metadata.patternStudy, old.metadata.patternStudy);
  }
  const rotated = planDesign(initial, [{ kind: 'cut', patternId: cut.patternId, draft: { baseIndex: members[0].baseIndex + 1 } }]).document;
  const moved = rotated.facets.filter(f => f.patternId === cut.patternId);
  assert.equal(new Set(moved.map(f => f.id)).size, moved.length);
  assert.ok(moved.every(f => f.metadata.componentInstanceId === undefined && f.metadata.sourcePlaneId === undefined && f.metadata.patternStudy === undefined));
});

test('arc ring cuts link depths to the primary, and dissolve into one layer per level', async () => {
  const { ringCutFromFacets, ringCutLayout } = await import('../domain/ringCut.js');
  const ring = { kind: 'arc', symmetry: 3, subdivisions: 3, bulge: 0.55, rotation: 0 };
  assert.doesNotThrow(() => validateInput(OPERATION_SCHEMA, { kind: 'cut', patternId: 'arc', region: 'girdle', draft: { ring } }));
  assert.doesNotThrow(() => validateInput(OPERATION_SCHEMA, { kind: 'dissolve-ring', patternId: 'arc' }));
  assert.throws(() => validateInput(OPERATION_SCHEMA, { kind: 'cut', patternId: 'arc', draft: { ring: { ...ring, bulge: 1.5 } } }), /out of range/);
  const plan = planDesign(createWorkbenchDocument('arc'), [
    { kind: 'cut', patternId: 'arc', region: 'girdle', draft: { industryAngle: 90, depth: 0.45, ring } },
  ]);
  const layer = (document, id = 'arc') => document.facets.filter((facet) => facet.patternId === id);
  const depths = (facets) => new Map(facets.map((facet) => [facet.index, facet.depth]));
  assert.equal(layer(plan.document).length, 9);
  assert.equal(layer(plan.document)[0].metadata.primaryIndex, 6);
  assert.equal(depths(layer(plan.document)).get(6), 0.45);
  assert.ok(depths(layer(plan.document)).get(0) > 0.45, 'the arc middle cuts deeper than the primary');
  assert.deepEqual(ringCutFromFacets(layer(importFacetingJSON(exportFacetingJSON(plan.document)))), ring);

  // Editing only the bulge keeps the primary's depth and re-solves the rest.
  const bulged = planDesign(plan.document, [{ kind: 'cut', patternId: 'arc', draft: { ring: { ...ring, bulge: 0.8 } } }]);
  assert.equal(depths(layer(bulged.document)).get(ringCutLayout({ ...ring, bulge: 0.8 }, 96).primaryIndex), 0.45);

  const dissolved = planDesign(plan.document, [{ kind: 'dissolve-ring', patternId: 'arc' }]);
  assert.equal(dissolved.changes[0].layers, 2);
  const outer = layer(dissolved.document);
  const inner = layer(dissolved.document, 'arc-2');
  assert.deepEqual([outer.length, inner.length], [6, 3]);
  assert.ok([...outer, ...inner].every((facet) => facet.metadata.ring === undefined && facet.metadata.patternMode === 'arbitrary'));
  assert.equal(outer[0].metadata.primaryIndex, 6);
  assert.equal(inner[0].metadata.primaryIndex, 0);
  assert.deepEqual(outer.map((facet) => facet.id), layer(plan.document).filter((facet) => depths(outer).has(facet.index)).map((facet) => facet.id), 'the primary level keeps its facet ids');
  assert.deepEqual([...depths(outer), ...depths(inner)].sort(), [...depths(layer(plan.document))].sort(), 'every facet keeps its depth');
  assert.ok(inner[0].label.endsWith('b') || inner[0].label.includes('b '), `level label ${inner[0].label}`);
  assert.throws(() => planDesign(dissolved.document, [{ kind: 'dissolve-ring', patternId: 'arc' }]), /环切/);

  const fan = planDesign(createWorkbenchDocument('fan'), [cut,
    { kind: 'cut', patternId: 'fan', region: 'crown', draft: { industryAngle: 22, depth: 0.7, ring: { kind: 'fan', symmetry: 3, subdivisions: 3, spacingDeg: 15, rotation: 0 } } },
    { kind: 'dissolve-ring', patternId: 'fan' }]);
  assert.equal(fan.changes.at(-1).layers, 1);
  assert.equal(layer(fan.document, 'fan').length, 9);
});

test('ring cuts plan as one editable group that JSON keeps and a mode change dissolves', async () => {
  const { ringCutFromFacets } = await import('../domain/ringCut.js');
  const ring = { kind: 'fan', symmetry: 3, subdivisions: 3, spacingDeg: 15, rotation: 0 };
  assert.doesNotThrow(() => validateInput(OPERATION_SCHEMA, { kind: 'cut', patternId: 'ring', region: 'crown', draft: { ring } }));
  assert.throws(() => validateInput(OPERATION_SCHEMA, { kind: 'cut', patternId: 'ring', draft: { ring: { ...ring, subdivisions: 12 } } }), /out of range/);
  const plan = planDesign(createWorkbenchDocument('ring'), [
    cut,
    { kind: 'cut', patternId: 'ring', region: 'crown', draft: { industryAngle: 22, depth: 0.7, ring } },
  ]);
  const facets = () => plan.document.facets.filter((facet) => facet.patternId === 'ring');
  assert.deepEqual(facets().map((facet) => facet.index).sort((a, b) => a - b), [0, 4, 28, 32, 36, 60, 64, 68, 92]);
  assert.equal(facets()[0].metadata.patternMode, 'arbitrary');
  assert.deepEqual(facets()[0].metadata.ring, { version: 1, ...ring });
  const reopened = importFacetingJSON(exportFacetingJSON(plan.document));
  assert.deepEqual(ringCutFromFacets(reopened.facets.filter((facet) => facet.patternId === 'ring')), ring);

  const edited = planDesign(plan.document, [{ kind: 'cut', patternId: 'ring', draft: { industryAngle: 25, ring: { ...ring, subdivisions: 2 } } }]);
  const editedFacets = edited.document.facets.filter((facet) => facet.patternId === 'ring');
  assert.equal(editedFacets.length, 6);
  assert.equal(editedFacets[0].industryAngleDeg, 25);

  const turned = planDesign(edited.document, [{ kind: 'transform', region: 'crown', rotationTeeth: 4 }]);
  assert.equal(turned.document.facets.find((facet) => facet.patternId === 'ring').metadata.ring.rotation, 4);
  assert.ok(ringCutFromFacets(turned.document.facets.filter((facet) => facet.patternId === 'ring')));

  const plain = planDesign(turned.document, [{ kind: 'cut', patternId: 'ring', draft: { patternMode: 'arbitrary' } }]);
  const plainFacets = plain.document.facets.filter((facet) => facet.patternId === 'ring');
  assert.equal(plainFacets[0].metadata.ring, undefined);
  const sorted = (list) => list.map((facet) => facet.index).sort((a, b) => a - b);
  assert.deepEqual(sorted(plainFacets), sorted(turned.document.facets.filter((facet) => facet.patternId === 'ring')));
  assert.throws(() => planDesign(plan.document, [{ kind: 'cut', patternId: 'table-facet', draft: { ring } }]), /台面|LOCKED/);
});
