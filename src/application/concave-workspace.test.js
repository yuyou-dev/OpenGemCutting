import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createWorkbenchDocument } from '../domain/document.js';
import { createMeshDocument } from '../domain/stockGeometry.js';
import { createCenteredCube, polyhedronVolume } from '../domain/geometry.js';
import { createFacetingDocument, createCommandHistory, executeFacetingCommand, undoFacetingCommand, importFacetingJSON, exportFacetingJSON, getCuttingReference, DEFAULT_STOCK } from '../domain/faceting.js';
import { evaluateDocument } from '../domain/documentGeometry.js';
import { prepareConcaveTool, prepareParameterGroupReplacement, exportParameterGroup } from './designOperations.js';
import { CONCAVE_PRESETS, concaveToolDepth } from './concaveTools.js';
import { indexExportSummary } from '../domain/indexing.js';
import { createFacetReportModel } from '../report/pdfReport.js';
import { validateMeshSolid } from '../domain/mesh/index.js';
import { designJumpCandidates } from './designJump.js';

test('Columbia-Willamette supports every existing concave preset without clipping Boolean section boundaries', () => {
  const base = importFacetingJSON(readFileSync(new URL('../../public/presets/documents/100626-pc-08-024-columbia-willamette.json', import.meta.url), 'utf8'));
  const before = volume(base);
  for (const { id: preset } of CONCAVE_PRESETS) {
    const result = prepareConcaveTool(base, { toolId: 'groove', preset, toolDepth: .65 });
    assert.ok(validateMeshSolid(result.solid).volume > 0);
    assert.ok(polyhedronVolume(result.solid) < before);
    assert.deepEqual(result.document.facets, base.facets);
    assert.deepEqual(importFacetingJSON(exportFacetingJSON(result.document)), result.document);
  }
});

test('acute preset junctions remain closed without moving planar sources or discarding narrow cutter boundaries', () => {
  const cases = [
    ['100308-pc-07-082b-fvs-242-square-radiant.json', 'fine-flute'],
    ['100500-pc-07-163-triadiant.json', 'bowl'],
    ['101640-pc-09-167-a-new-cushion.json', 'v-groove'],
    ['101731-pc-09-208-easy-cushion-square-2-6-c2p2.json', 'flute'],
    ['101743-pc-09-212-whoopee-cz.json', 'v-groove'],
    ['106147-pc-37-024-brilliant-seven.json', 'flute'],
    ['92803-pc-38-039-nine-96-brilliant-mod1.json', 'bowl'],
  ];
  for (const [file, preset] of cases) {
    const document = importFacetingJSON(readFileSync(new URL(`../../public/presets/documents/${file}`, import.meta.url), 'utf8'));
    const original = exportFacetingJSON(document), before = volume(document);
    const result = prepareConcaveTool(document, { toolId: 'acute-groove', preset, toolDepth: .65 });
    const validation = validateMeshSolid(result.solid);
    assert.ok(validation.embeddingChecked && validation.volume > 0, file);
    assert.ok(validation.volume < before, file);
    assert.deepEqual(result.document.facets, document.facets, file);
    assert.equal(exportFacetingJSON(document), original, file);
    assert.ok(result.solid.faces.every(face => face.sourceOperationId), file);
    assert.deepEqual(evaluateDocument(importFacetingJSON(exportFacetingJSON(result.document))), result.solid, file);
  }
});

test('manual and MCP Jump use planar sources independent of concave parameters', () => {
  const base = createWorkbenchDocument('Jump isolation');
  const query = { region: 'crown', draft: { industryAngle: 32, baseIndex: 6 } };
  const expected = designJumpCandidates(base, query);
  assert.ok(expected.length);
  const combined = prepareConcaveTool(base, { toolId: 'groove', preset: 'flute' }).document;
  assert.deepEqual(designJumpCandidates(combined, query), expected);
});

const volume = doc => polyhedronVolume(evaluateDocument(doc));
test('new physical blanks use fixed cutting coordinates and cannot be replaced or resized', () => {
  const blank = createMeshDocument({ mesh: createCenteredCube(3), unit: 'mm' });
  const planar = createWorkbenchDocument('fixed');
  const combined = createFacetingDocument({ ...blank, facets: planar.facets });
  assert.deepEqual(getCuttingReference(combined), DEFAULT_STOCK);
  assert.deepEqual(combined.facets, planar.facets);
  assert.equal(combined.stock.source.millimetersPerModelUnit, 1.5);
  assert.throws(() => prepareParameterGroupReplacement(combined, { ...exportParameterGroup(combined, 'stock'), stock: DEFAULT_STOCK }), e => e.code === 'STOCK_LOCKED');
  assert.deepEqual(importFacetingJSON(exportFacetingJSON(combined)), combined);
});

test('changing planar cuts or blank geometry cannot change concave depth readings or cutter parameters', () => {
  const original = prepareConcaveTool(createWorkbenchDocument('independent'), { toolId: 'flute', preset: 'flute' }).document;
  const cut = original.concaveCuts[0];
  const altered = createFacetingDocument({ ...original, cuttingReference: DEFAULT_STOCK,
    stock: { ...DEFAULT_STOCK, size: 4 }, facets: original.facets.map(f => ({ ...f, depth: f.depth + .05 })) });
  assert.equal(concaveToolDepth(altered, cut), concaveToolDepth(original, cut));
  const next = prepareConcaveTool(altered, { toolId: cut.id, toolDepth: concaveToolDepth(original, cut) });
  assert.deepEqual(next.document.concaveCuts, original.concaveCuts);
  assert.deepEqual(next.document.facets, altered.facets);
});

test('continuous preview preparations do not enter history; release commits one undoable change', () => {
  const base = prepareConcaveTool(createWorkbenchDocument('drag'), { toolId: 'flute', preset: 'flute' }).document;
  const history = createCommandHistory(base);
  const depth = concaveToolDepth(base, base.concaveCuts[0]);
  const previews = [.01, .02, .03].map(delta => prepareConcaveTool(base, { toolId: 'flute', toolDepth: depth + delta }));
  assert.ok(volume(previews[0].document) > volume(previews[2].document));
  assert.deepEqual(history.present, base);
  const committed = executeFacetingCommand(history, previews.at(-1).command);
  assert.deepEqual(undoFacetingCommand(committed).present, base);
});

test('planar JSON without optional stock or concave groups imports on 96 by default', () => {
  const original = createFacetingDocument({ ...createWorkbenchDocument('optional'), concaveCuts: [] });
  const raw = JSON.parse(exportFacetingJSON(original));
  delete raw.stock; delete raw.concaveCuts; delete raw.indexGear;
  const restored = importFacetingJSON(raw);
  assert.equal(restored.indexGear.teeth, 96);
  assert.deepEqual(restored.facets, original.facets);
  assert.equal(volume(restored), volume(original));
  delete raw.facets;
  assert.throws(() => importFacetingJSON(raw), e => e.errors.some(item => item.path === '$.facets'));
});

test('120 JSON has one numerical wheel, explicit compatible wheels and a non-96 reminder', () => {
  const original = createWorkbenchDocument('120', 120);
  const raw = JSON.parse(exportFacetingJSON(original));
  assert.ok(raw.facets.every(f => f.indexTeeth === 120));
  assert.equal(raw.machining.indexValuesUse, 120);
  assert.deepEqual(raw.machining.supportedTeeth, [120, 360]);
  assert.equal(raw.machining.compatibleWith96, false);
  assert.match(raw.machining.notice, /不能直接按 96/);
  raw.machining.supportedTeeth = [96];
  assert.deepEqual(indexExportSummary(importFacetingJSON(raw)).supportedTeeth, [120, 360]);
  const group = exportParameterGroup(original, 'planar');
  assert.equal(group.indexGear.teeth, 120);
  assert.equal(group.machining.indexValuesUse, 120);
});

test('PDF equipment declaration agrees with JSON while rendered rows use the selected wheel only', () => {
  for (const teeth of [96, 120]) {
    const document = createWorkbenchDocument('pdf', teeth);
    const report = createFacetReportModel({ document });
    assert.deepEqual(report.equipment, indexExportSummary(document));
    assert.equal(report.indexTeeth, teeth);
    assert.ok(report.regions.flatMap(r => r.rows).every(row => +row.index <= teeth));
    if (teeth === 96) assert.equal(report.equipment.notice, '');
  }
});

test('V wheel and arbitrary group rotation preserve planar wheel, blank and existing tools across JSON and undo', () => {
  const base = prepareConcaveTool(createWorkbenchDocument('V star'), { toolId: 'old', preset: 'bowl', toolDepth: .15 }).document;
  const next = prepareConcaveTool(base, { toolId: 'v', preset: 'v-groove', repeat: 5, phaseDeg: 17.35, toolDepth: .55 });
  const cut = next.document.concaveCuts[1];
  assert.equal(cut.type, 'v-wheel');
  assert.ok(Math.abs(cut.phaseDeg - 17.35) < 1e-10);
  assert.equal(cut.length, 2 * cut.radius);
  assert.deepEqual(cut.axis, [0, 1, 0]);
  assert.deepEqual(next.document.facets, base.facets);
  assert.deepEqual(next.document.stock, base.stock);
  assert.deepEqual(next.document.concaveCuts[0], base.concaveCuts[0]);
  assert.deepEqual(indexExportSummary(next.document), indexExportSummary(base));
  assert.deepEqual(importFacetingJSON(exportFacetingJSON(next.document)), next.document);
  assert.ok(volume(next.document) < volume(base));
  assert.deepEqual(undoFacetingCommand(executeFacetingCommand(createCommandHistory(base), next.command)).present, base);
  assert.equal(prepareConcaveTool(next.document, { toolId: 'v', phaseDeg: -12.5 }).document.concaveCuts[1].phaseDeg, 347.5);
  assert.throws(() => prepareConcaveTool(next.document, { toolId: 'v', phaseDeg: NaN }));
});

test('drag finish and history clones reuse the exact validated result without changing undo semantics', () => {
  const base = createFacetingDocument({ ...createWorkbenchDocument('reuse'), cuttingReference: DEFAULT_STOCK });
  const history = createCommandHistory(base);
  const operation = { toolId: 'cached', preset: 'flute', phaseDeg: 17.35, toolDepth: .4 };
  const preview = prepareConcaveTool(history.present, operation);
  assert.equal(prepareConcaveTool(history.present, { ...operation }), preview);
  const committed = executeFacetingCommand(history, preview.command);
  assert.equal(getCuttingReference(committed.present), getCuttingReference(preview.document));
  assert.equal(evaluateDocument(committed.present), preview.solid);
  assert.equal(committed.cursor, 1);
  assert.deepEqual(undoFacetingCommand(committed).present, history.present);
  const changed = prepareConcaveTool(committed.present, { toolId: 'cached', phaseDeg: 28 });
  assert.notEqual(changed.solid, preview.solid);
  assert.equal(changed.document.concaveCuts[0].phaseDeg, 28);
});

test('worker result transport preserves validated geometry and immutable groups through commit', async () => {
  const { evaluateConcaveUpdate, receiveConcaveUpdate } = await import('./concaveEvaluation.js');
  const base = createFacetingDocument({ ...createWorkbenchDocument('worker'), cuttingReference: DEFAULT_STOCK });
  const operation = { toolId: 'async', preset: 'flute', toolDepth: .4, phaseDeg: 17.5 };
  const result = structuredClone(evaluateConcaveUpdate(createFacetingDocument(structuredClone(base)), operation));
  const prepared = receiveConcaveUpdate(base, result);
  assert.equal(prepared.document.stock, base.stock);
  assert.deepEqual(prepared.document.facets, base.facets);
  const committed = executeFacetingCommand(createCommandHistory(base), prepared.command);
  assert.equal(evaluateDocument(committed.present), result.solid);
  assert.deepEqual(undoFacetingCommand(committed).present, base);
});

test('triangular cutter dimensions preserve depth, survive JSON/worker transport and undo without planar edits', async () => {
  const { evaluateConcaveUpdate, receiveConcaveUpdate } = await import('./concaveEvaluation.js');
  const base = prepareConcaveTool(createWorkbenchDocument('Triangular groove'), { toolId: 'triangle', preset: 'triangle-groove', repeat: 5 }).document;
  const original = base.concaveCuts[0];
  const operation = { toolId: original.id, width: .8, length: 1.6, tipAngle: 60 };
  const result = structuredClone(evaluateConcaveUpdate(base, operation));
  const prepared = receiveConcaveUpdate(base, result);
  const tool = prepared.document.concaveCuts[0];
  assert.equal(tool.width, .8);
  assert.equal(tool.length, 1.6);
  assert.equal(tool.tipAngle, 60);
  assert.ok(Math.abs(concaveToolDepth(prepared.document, tool) - concaveToolDepth(base, original)) < 1e-10);
  assert.deepEqual(prepared.document.facets, base.facets);
  const restored = importFacetingJSON(exportFacetingJSON(prepared.document));
  assert.deepEqual(restored, prepared.document);
  assert.ok(Math.abs(volume(restored) - polyhedronVolume(result.solid)) < 1e-10);
  assert.deepEqual(undoFacetingCommand(executeFacetingCommand(createCommandHistory(base), prepared.command)).present, base);
  assert.throws(() => prepareConcaveTool(base, { toolId: original.id, width: -1 }));
});
