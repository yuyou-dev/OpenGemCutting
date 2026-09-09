import assert from 'node:assert/strict';
import test from 'node:test';
import { createMeshDocument, createStockSolid, inspectCrystalMesh, inspectCrystalOBJ } from './stockGeometry.js';
import { createWorkbenchDocument, ensureTableFacet } from './document.js';
import { applyFacetingCommand, createAddFacetsCommand, createCommandHistory, createFacetingDocument, createRemoveFacetsCommand, createReplaceDocumentCommand, executeFacetingCommand, exportFacetingJSON, importFacetingJSON, redoFacetingCommand, resolveFacetPattern, undoFacetingCommand, validateFacetingDocument } from './faceting.js';
import { clipPolyhedronByPlanes, clipPolyhedronPreview, createCenteredCube, polyhedronVolume } from './geometry.js';
import { uRough } from './mesh/fixtures.js';
import { parseMeshOBJ, validateMeshSolid } from './mesh/index.js';
import { planeEntry } from './cutConstruction.js';
import { enumerateTopologyEdges, enumerateTopologyVertices, createEdgeMeetTarget, resolvePersistedMeetTarget, solveVertexMeet, summarizeEffectiveFacets } from './meetJump.js';
import { buildConstructionStages } from './constructionHistory.js';
import { createCuttingReplay } from './cuttingAssistant.js';
import { serializeGemCadAsc } from './gemcadAsc.js';

function initial() {
  const mesh = uRough();
  return createMeshDocument({ mesh: { vertices: mesh.vertices, faces: mesh.faces.map(face => face.vertexIndices) }, name: '凹晶体 U', unit: 'mm', upAxis: 'z' });
}
const pattern = (document, id, { region = 'crown', depth = 0.2, industryAngleDeg = 0, repeat = 1, baseIndex = 0, metadata } = {}) => resolveFacetPattern({
  patternId: id, region, depth, industryAngleDeg, repeat, baseIndex, mirror: 0, metadata,
}, { stock: document.stock });

test('mesh project preserves original stock independently from zero initial CUTs and normalized source units', () => {
  const document = initial();
  assert.equal(document.schemaVersion, 2); assert.equal(document.facets.length, 0);
  assert.equal(ensureTableFacet(document), document);
  assert.deepEqual(document.stock.source.dimensions, [3, 3, 1]);
  assert.equal(document.stock.source.millimetersPerModelUnit, 1.5);
  assert.ok(Object.isFrozen(document.stock.mesh.vertices[0]));
  assert.ok(Object.isFrozen(document.stock.mesh.faces[0]));
  const stock = createStockSolid(document.stock);
  assert.equal(stock, createStockSolid(document.stock));
  assert.equal(stock.kind, 'mesh'); validateMeshSolid(stock);
  const facets = pattern(document, 'C1');
  const cut = applyFacetingCommand(document, createAddFacetsCommand(facets));
  assert.equal(cut.stock, document.stock);
  assert.equal(createStockSolid(cut.stock), stock);
  assert.ok(polyhedronVolume(clipPolyhedronByPlanes(stock, facets.map(planeEntry))) < polyhedronVolume(stock));
});

test('mesh JSON v2 roundtrip retains stock and CUT metadata; old cube remains v1 with T1 and G1', () => {
  const document = initial();
  const saved = applyFacetingCommand(document, createAddFacetsCommand(pattern(document, 'C1')));
  const imported = importFacetingJSON(exportFacetingJSON(saved));
  assert.equal(validateFacetingDocument(imported).valid, true);
  assert.deepEqual(imported, saved);
  assert.deepEqual(clipPolyhedronByPlanes(createStockSolid(imported.stock), imported.facets.map(planeEntry)), clipPolyhedronByPlanes(createStockSolid(saved.stock), saved.facets.map(planeEntry)));
  const cube = createWorkbenchDocument();
  assert.equal(cube.schemaVersion, 1); assert.equal(cube.stock.kind, 'cube');
  assert.equal(new Set(cube.facets.map(face => face.patternId)).size, 2);
  assert.equal(importFacetingJSON(exportFacetingJSON(cube)).schemaVersion, 1);
  assert.throws(() => importFacetingJSON({ ...saved, schemaVersion: 1 }));
  assert.throws(() => importFacetingJSON({ ...saved, stock: { ...saved.stock, mesh: { vertices: [], faces: [] } } }), error => error.errors.some(item => item.message.includes('closed material volume')));
});

test('CUT commands, document metadata replacement, undo/redo and clear share one immutable mesh stock', () => {
  const initialDocument = initial();
  let history = createCommandHistory(initialDocument);
  const stock = history.initial.stock;
  history = executeFacetingCommand(history, createAddFacetsCommand(pattern(history.present, 'C1')));
  const saved = history.present;
  history = executeFacetingCommand(history, createReplaceDocumentCommand({ ...saved, name: '重新命名' }));
  assert.equal(history.present.stock, stock);
  history = undoFacetingCommand(history);
  assert.equal(history.present.name, saved.name); assert.equal(history.present.stock, stock);
  history = undoFacetingCommand(history);
  assert.equal(history.present.facets.length, 0); assert.equal(history.present.stock, stock);
  history = redoFacetingCommand(history);
  assert.equal(history.present.facets.length, 1); assert.equal(history.present.stock, stock);
  history = executeFacetingCommand(history, createRemoveFacetsCommand(history.present.facets.map(facet => facet.id)));
  assert.equal(history.present.facets.length, 0);
  assert.equal(history.present.stock, stock);
  assert.deepEqual(createStockSolid(history.present.stock), createStockSolid(initialDocument.stock));
});

test('multiple mesh cap patches count as one logical CUT facet and never count untouched rough as CUTs', () => {
  const document = initial(), facets = pattern(document, 'C1'), stock = createStockSolid(document.stock);
  assert.deepEqual(summarizeEffectiveFacets(stock).effectiveFacetIds, []);
  const solid = clipPolyhedronByPlanes(stock, facets.map(planeEntry));
  const summary = summarizeEffectiveFacets(solid);
  assert.ok(solid.faces.filter(face => face.facetId === facets[0].id).length > 1);
  assert.deepEqual(summary.effectiveFacetIds, [facets[0].id]);
  assert.equal(summary.operations[0].count, 1);
  assert.deepEqual(clipPolyhedronPreview(stock, facets.map(planeEntry)), solid);
});

test('mesh assistant and hidden/reordered stages replay the same immutable stock and ordered cuts', () => {
  const document = initial();
  const a = pattern(document, 'C1'), b = pattern(document, 'P1', { region: 'pavilion', industryAngleDeg: 30, depth: 0.3 });
  const saved = createFacetingDocument({ ...document, facets: [...a, ...b] });
  const stages = buildConstructionStages(saved), replay = createCuttingReplay(saved);
  assert.equal(replay.total, 2); assert.equal(replay.solidAt(0), createStockSolid(saved.stock));
  assert.deepEqual(replay.solidAt(2), stages.at(-1).afterSolid);
  const hidden = buildConstructionStages(saved, { hiddenPatternIds: ['C1'] });
  assert.equal(hidden[0].afterSolid, hidden[0].beforeSolid);
  const hiddenReplay = createCuttingReplay(saved, { hiddenPatternIds: ['C1'] });
  assert.equal(hiddenReplay.total, 1); assert.deepEqual(hiddenReplay.solidAt(1), hidden.at(-1).afterSolid);
  const reordered = buildConstructionStages({ ...saved, facets: [...b, ...a] });
  assert.deepEqual(reordered.map(stage => stage.id), ['P1', 'C1']);
  assert.ok(Math.abs(polyhedronVolume(reordered.at(-1).afterSolid) - polyhedronVolume(stages.at(-1).afterSolid)) < 1e-8);
  assert.equal(saved.stock, document.stock);
});

test('mesh vertex and edge Meet snapshots roundtrip and report hidden/reordered source without changing cuts', () => {
  const document = initial(), source = pattern(document, 'C1');
  const prefix = clipPolyhedronByPlanes(createStockSolid(document.stock), source.map(planeEntry));
  const target = createEdgeMeetTarget(enumerateTopologyEdges(prefix).find(edge => edge.sourceOperationIds.includes('C1')), 0.7);
  const primary = pattern(document, 'P1', { region: 'pavilion', industryAngleDeg: 30 })[0];
  const solved = solveVertexMeet({ normal: primary.plane.normal, target, stock: document.stock });
  assert.equal(solved.status, 'valid');
  const follower = pattern(document, 'P1', { region: 'pavilion', industryAngleDeg: 30, depth: solved.depth,
    metadata: { patternMode: 'symmetric', construction: { type: 'edge-meet', solverVersion: 2, primaryIndex: 0, target } } });
  const saved = createFacetingDocument({ ...document, facets: [...source, ...follower] });
  const imported = importFacetingJSON(exportFacetingJSON(saved));
  assert.equal(buildConstructionStages(imported)[1].construction.status, 'valid');
  assert.equal(buildConstructionStages(imported, { hiddenPatternIds: ['C1'] })[1].construction.reason, 'source-hidden');
  assert.equal(buildConstructionStages({ ...saved, facets: [...follower, ...source] })[0].construction.reason, 'source-order');
  const vertex = enumerateTopologyVertices(prefix).find(point => point.sourceOperationIds.includes('C1'));
  const reloaded = clipPolyhedronByPlanes(createStockSolid(imported.stock), imported.facets.filter(facet => facet.patternId === 'C1').map(planeEntry));
  assert.equal(resolvePersistedMeetTarget(vertex, reloaded).status, 'valid');
  assert.deepEqual(imported.facets, saved.facets);
});

test('mesh ASC export is explicitly blocked and OBJ preflight supplies a new zero-CUT project', () => {
  const document = initial(), blocked = serializeGemCadAsc(document);
  assert.equal(blocked.status, 'error'); assert.equal(blocked.text, '');
  assert.ok(blocked.diagnostics.some(item => item.code === 'MESH_STOCK_UNSUPPORTED'));
  const rough = uRough();
  const text = [...rough.vertices.map(p => `v ${p.x} ${p.y} ${p.z}`), ...rough.faces.map(face => `f ${face.vertexIndices.map(i => i + 1).join(' ')}`)].join('\n');
  const inspection = inspectCrystalOBJ(text, { fileName: 'U.obj', unit: 'cm', upAxis: 'y' });
  assert.equal(inspection.document.name, 'U'); assert.equal(inspection.document.facets.length, 0);
  assert.equal(inspection.document.stock.source.millimetersPerModelUnit, 15);
  assert.equal(inspection.summary.patchCount, rough.faces.length);
});

test('stock canonicalizes face records before creating Meet identities that survive JSON reload', () => {
  const mesh = createCenteredCube();
  mesh.faces = mesh.faces.map((face, index) => ({ ...face, id: `external:${index}`, facetId: 'external-cut' }));
  const document = createMeshDocument({ mesh });
  const solid = createStockSolid(document.stock);
  assert.ok(solid.faces.every((face, index) => face.id === `rough:patch:${index}` && face.facetId === undefined));
  const target = enumerateTopologyVertices(solid).find(point => point.fallbackWorldPoint[0] < 0 && point.fallbackWorldPoint[2] > 0);
  const primary = pattern(document, 'C1', { industryAngleDeg: 30 })[0];
  const solved = solveVertexMeet({ normal: primary.plane.normal, target, stock: document.stock });
  const facets = pattern(document, 'C1', { industryAngleDeg: 30, depth: solved.depth,
    metadata: { patternMode: 'symmetric', construction: { type: 'vertex-meet', solverVersion: 1, target } } });
  const saved = createFacetingDocument({ ...document, facets });
  const restored = importFacetingJSON(exportFacetingJSON(saved));
  assert.deepEqual(enumerateTopologyVertices(createStockSolid(restored.stock)), enumerateTopologyVertices(solid));
  assert.equal(buildConstructionStages(restored)[0].construction.status, 'valid');
  assert.deepEqual(restored.facets[0].metadata.construction.target, target);
});

test('source XYZ dimensions remain unchanged while +X/+Y axis selection changes machine dimensions', () => {
  const mesh = createCenteredCube();
  mesh.vertices = mesh.vertices.map(p => ({ x: p.x * 2 + 7, y: p.y * 3 - 2, z: p.z * 5 + 11 }));
  for (const [upAxis, dimensions] of [['z', [0.8, 1.2, 2]], ['y', [0.8, 2, 1.2]], ['x', [2, 1.2, 0.8]]]) {
    const inspection = inspectCrystalMesh(mesh, { upAxis, unit: 'mm' });
    assert.deepEqual(inspection.summary.sourceDimensions, [4, 6, 10]);
    inspection.summary.dimensions.forEach((value, axis) => assert.ok(Math.abs(value - dimensions[axis]) < 1e-12));
    const source = inspection.document.stock.source;
    assert.deepEqual(source.dimensions, [4, 6, 10]);
    assert.equal(source.millimetersPerModelUnit, 5);
    const reloaded = importFacetingJSON(exportFacetingJSON(inspection.document));
    assert.deepEqual(reloaded.stock.source, source);
  }
});

test('parsed OBJ supports repeated parameter preflight without bypassing transformed-stock validation', () => {
  const rough = uRough();
  const text = [...rough.vertices.map(p => `v ${p.x} ${p.y} ${p.z}`), ...rough.faces.map(face => `f ${face.vertexIndices.map(i => i + 1).join(' ')}`)].join('\n');
  const mesh = parseMeshOBJ(text), snapshot = JSON.stringify(mesh);
  const first = inspectCrystalMesh(mesh, { unit: 'mm', upAxis: 'y' });
  const second = inspectCrystalMesh(mesh, { unit: 'cm', upAxis: 'y' });
  assert.deepEqual(first.solid, second.solid);
  assert.equal(second.document.stock.source.millimetersPerModelUnit, first.document.stock.source.millimetersPerModelUnit * 10);
  assert.deepEqual(inspectCrystalOBJ(text, { unit: 'cm', upAxis: 'y' }), second);
  assert.equal(JSON.stringify(mesh), snapshot);
  assert.throws(() => inspectCrystalMesh({ ...mesh, faces: mesh.faces.slice(1) }, { upAxis: 'x' }), /open boundary/);
  assert.throws(() => inspectCrystalOBJ('v 0 0 0\nf 1 2 3'), /顶点索引无效/);
});

test('crystal import accepts 1000 source faces and rejects the next face before geometry work', () => {
  const lines = [];
  for (let i = 0; i < 250; i++) {
    const x = (i % 10) * 3, y = (Math.floor(i / 10) % 5) * 3, z = Math.floor(i / 50) * 3;
    lines.push(`v ${x} ${y} ${z}`, `v ${x + 1} ${y} ${z}`, `v ${x} ${y + 1} ${z}`, `v ${x} ${y} ${z + 1}`);
    const b = i * 4;
    for (const face of [[1,3,2],[1,2,4],[2,3,4],[3,1,4]]) lines.push(`f ${face.map(v => v + b).join(' ')}`);
  }
  const obj = lines.join('\n');
  assert.equal(inspectCrystalOBJ(obj).summary.patchCount, 1000);
  assert.throws(() => inspectCrystalOBJ(`${obj}\nf 1 3 2`), /1000.*超过上限/);
  assert.throws(() => inspectCrystalMesh({ vertices: [], faces: Array(1001).fill([0,1,2]) }), /1000/);
});

test('crystal import also limits patches produced by concave faces', async () => {
  const { readFile } = await import('node:fs/promises');
  const obj = await readFile(new URL('../../docs/manual/examples/08-concave-crystal.obj', import.meta.url), 'utf8');
  assert.equal(parseMeshOBJ(obj).sourceFaces, 8);
  assert.throws(() => parseMeshOBJ(obj, { maxFaces: 8 }), /分解后有 14 个面片.*8 面上限/);
});
