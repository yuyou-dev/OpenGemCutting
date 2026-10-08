import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbenchDocument } from './document.js';
import {
  createFacetingDocument, exportFacetingJSON, importFacetingJSON, normalizeDocumentSchema, resolveFacet, rotateFacetsByTeeth,
  translateFacetsAlongZ, validateFacetingDocument, withDocumentIndexGear,
} from './faceting.js';
import { evaluateDocument, evaluatePlanarDocument } from './documentGeometry.js';
import { summarizeEffectiveFacets } from './meetJump.js';
import { resolveDraftGeometry } from './cutConstruction.js';
import { toolDraftPatch, defaultDraftForRegion } from './cutSession.js';
import { facetsAfterLayerEdit, layerEditMetadata } from './layerEdit.js';
import { gridPrimaryIndex, gridCutLayout } from './gridCut.js';
import {
  COMPOSITE_TOOLS, COMPOSITE_TOOL_VERSION, compositeTool, compositeToolAngle, compositeToolDefaults, compositeToolFrame,
  compositeToolFromFacets, compositeToolLayout, compositeToolMetadata, normalizeCompositeParams,
} from './compositeTools.js';
import { draftForPattern, planDesign } from '../application/designOperations.js';
import { toolHood } from './compositeHood.js';
import { envelopeMeets } from './meetSolver.js';

const ENGINE_TOOLS = COMPOSITE_TOOLS.filter((tool) => ['tier', 'fancy'].includes(tool.engine));
const base = createWorkbenchDocument('composite', 96);
const reference = base.stock;
const baseSolid = evaluatePlanarDocument(base);
const top = Math.max(...baseSolid.vertices.map((v) => v.z));
const bottom = Math.min(...baseSolid.vertices.map((v) => v.z));

function draftFor(id, region = 'crown', overrides = {}) {
  const apex = region === 'crown' ? 1 - top : bottom + 1;
  return {
    ...defaultDraftForRegion(region),
    industryAngle: compositeToolAngle(id, region), depth: apex + 0.05, baseIndex: 0, indexTeeth: 96, patternMode: 'composite',
    composite: { tool: id, params: compositeToolDefaults(id, region), extent: 0.8, snap: 'tooth' },
    ...overrides,
  };
}

/** The committed layer an editor commit writes for a composite draft. */
function commitLayer(draft, region = 'crown', patternId = 'tool') {
  const { facets } = resolveDraftGeometry(draft, region, reference);
  const metadata = layerEditMetadata({
    previous: null, patternMode: 'composite', indexTeeth: 96, facets,
    baseIndex: gridPrimaryIndex(facets, draft.baseIndex, 96), preform: false,
    composite: { composite: draft.composite, angle: draft.industryAngle, depth: draft.depth, rotation: draft.baseIndex },
  });
  const layer = facetsAfterLayerEdit(facets, [], { patternId, label: 'C1 冠部', metadata }).map((facet) => resolveFacet(facet, { stock: reference }));
  return { layer, document: createFacetingDocument({ ...base, facets: [...base.facets, ...layer] }) };
}

test('every composite tool cuts the crown and the pavilion as ordinary facets on whole teeth', () => {
  for (const tool of ENGINE_TOOLS) for (const region of ['crown', 'pavilion']) {
    const draft = draftFor(tool.id, region);
    const { facets, error } = resolveDraftGeometry(draft, region, reference);
    assert.equal(error, '', `${tool.id} ${region}`);
    assert.ok(facets.length > 0, `${tool.id} ${region}: facets`);
    assert.ok(facets.every((facet) => Number.isInteger(facet.index) && facet.region === region && facet.depth >= 0), `${tool.id} ${region}: machine settings`);
    const { document } = commitLayer(draft, region);
    assert.equal(validateFacetingDocument(document).valid, true, `${tool.id} ${region}: document`);
    const effective = new Set(summarizeEffectiveFacets(evaluateDocument(document)).effectiveFacetIds);
    assert.ok([...effective].some((id) => id.startsWith('tool:')), `${tool.id} ${region}: forms facets`);
  }
});

test('a tool is region-free: the pavilion uses the crown construction mirrored', () => {
  for (const tool of ENGINE_TOOLS) {
    const params = compositeToolDefaults(tool.id, 'crown');
    const options = { indexTeeth: 96, reference, angle: 33, depth: 0.3, rotation: 4 };
    const crown = compositeToolLayout({ tool: tool.id, params, extent: 0.9 }, options);
    const crownFacets = resolveDraftGeometry(draftFor(tool.id, 'crown', { industryAngle: 33, depth: 0.3, baseIndex: 4, composite: { tool: tool.id, params, extent: 0.9 } }), 'crown', reference).facets;
    const pavilionFacets = resolveDraftGeometry(draftFor(tool.id, 'pavilion', { industryAngle: 33, depth: 0.3, baseIndex: 4, composite: { tool: tool.id, params, extent: 0.9 } }), 'pavilion', reference).facets;
    assert.equal(crownFacets.length, crown.facets.length, tool.id);
    pavilionFacets.forEach((facet, i) => {
      const mirror = crownFacets[i];
      assert.equal(facet.index, mirror.index, tool.id);
      assert.ok(Math.abs(facet.industryAngleDeg - mirror.industryAngleDeg) < 1e-12 && Math.abs(facet.depth - mirror.depth) < 1e-12, tool.id);
      assert.ok(Math.abs(facet.plane.normal.z + mirror.plane.normal.z) < 1e-12, `${tool.id}: mirrored normal`);
    });
  }
});

test('placement is rigid: whole-tooth rotation shifts every index, depth moves every plane along the axis', () => {
  for (const id of ['brilliant', 'stagger', 'rosette', 'pentagrid', 'arcweave']) {
    const composite = { tool: id, params: compositeToolDefaults(id), extent: 1, snap: 'tooth' };
    const still = compositeToolLayout(composite, { reference, angle: 34, depth: 0.25, rotation: 0 });
    const turned = compositeToolLayout(composite, { reference, angle: 34, depth: 0.25, rotation: 6 });
    const lowered = compositeToolLayout(composite, { reference, angle: 34, depth: 0.4, rotation: 0 });
    still.facets.forEach((facet, i) => {
      assert.equal(turned.facets[i].index, (facet.index + 6) % 96, id);
      assert.ok(Math.abs(turned.facets[i].depth - facet.depth) < 1e-9, id);
      // A vertical move of Δ deepens each plane by Δ · cos(angle).
      const cos = Math.cos((facet.industryAngleDeg * Math.PI) / 180);
      assert.ok(Math.abs(lowered.facets[i].depth - facet.depth - 0.15 * cos) < 1e-9, id);
    });
    assert.throws(() => compositeToolLayout(composite, { reference, rotation: 0.5 }), /整齿/);
  }
});

test('dome tools scale with the edge slope without regenerating; tier tools derive their tiers from the main angle', () => {
  const composite = { tool: 'rosette', params: compositeToolDefaults('rosette'), extent: 1, snap: 'exact' };
  const low = compositeToolLayout(composite, { reference, angle: 20, depth: 0.2 });
  const high = compositeToolLayout(composite, { reference, angle: 40, depth: 0.2 });
  const ratio = Math.tan((40 * Math.PI) / 180) / Math.tan((20 * Math.PI) / 180);
  low.facets.forEach((facet, i) => {
    if (facet.flat) return;
    assert.ok(Math.abs(Math.tan((high.facets[i].industryAngleDeg * Math.PI) / 180) / Math.tan((facet.industryAngleDeg * Math.PI) / 180) - ratio) < 1e-9);
  });
  const brilliant = compositeToolLayout({ tool: 'brilliant', params: compositeToolDefaults('brilliant'), extent: 1 }, { reference, angle: 34.5, depth: 0.2 });
  const mains = brilliant.facets.filter((facet) => facet.tier === 'main');
  assert.equal(mains.length, 8);
  assert.ok(mains.every((facet) => Math.abs(facet.industryAngleDeg - 34.5) < 1e-9));
  assert.deepEqual(brilliant.levels.map((level) => level.cells.length).sort((a, b) => a - b), [1, 8, 8, 16]);
});

test('wheel policy: tooth snapping reports its turn; exact keeps fractional indices and their wheels', () => {
  const params = { ...compositeToolDefaults('rosette'), symmetry: 9 };
  const snapped = compositeToolLayout({ tool: 'rosette', params, snap: 'tooth' }, { reference, angle: 35, depth: 0.2 });
  const exact = compositeToolLayout({ tool: 'rosette', params, snap: 'exact' }, { reference, angle: 35, depth: 0.2 });
  assert.ok(snapped.facets.every((facet) => Number.isInteger(facet.index)));
  assert.ok(snapped.report.maxSnapDeg > 0 && snapped.report.maxSnapDeg <= 360 / 96 / 2 + 1e-9);
  assert.equal(snapped.report.exactSymmetry, false);
  assert.ok(exact.report.fractional > 0);
  assert.ok(exact.facets.some((facet) => !Number.isInteger(facet.index)));
  // An 8-fold brilliant sits on whole teeth of a 96 wheel exactly, with nothing to snap.
  const brilliant = compositeToolLayout({ tool: 'brilliant', params: compositeToolDefaults('brilliant'), snap: 'exact' }, { reference, angle: 34.5, depth: 0.2 });
  assert.equal(brilliant.report.fractional, 0);
  assert.equal(brilliant.report.maxSnapDeg, 0);
});

test('a saved tool layer stays editable while its facets match, through JSON and rigid edits', () => {
  const draft = draftFor('stagger', 'crown', { baseIndex: 3 });
  const { layer, document } = commitLayer(draft);
  const saved = compositeToolFromFacets(layer, reference);
  assert.equal(saved.tool, 'stagger');
  assert.equal(saved.rotation, 3);
  assert.deepEqual(saved.params, normalizeCompositeParams('stagger', draft.composite.params));
  const reopened = importFacetingJSON(exportFacetingJSON(document));
  assert.equal(validateFacetingDocument(reopened).valid, true);
  assert.equal(compositeToolFromFacets(reopened.facets.filter((facet) => facet.patternId === 'tool'), reference).tool, 'stagger');
  // Whole-tooth rotation and vertical moves keep the tool; half a tooth leaves explicit facets.
  assert.equal(compositeToolFromFacets(rotateFacetsByTeeth(layer, 2, { stock: reference }), reference).rotation, 5);
  assert.ok(Math.abs(compositeToolFromFacets(translateFacetsAlongZ(layer, -0.02, { stock: reference }), reference).depth - (draft.depth + 0.02)) < 1e-9);
  assert.equal(compositeToolFromFacets(rotateFacetsByTeeth(layer, 0.5, { stock: reference }), reference), null);
  const edited = layer.map((facet, i) => (i === 0 ? { ...facet, depth: facet.depth + 0.01 } : facet));
  assert.equal(compositeToolFromFacets(edited, reference), null);
});

test('a wheel change keeps whole-tooth tool rotations and drops tools it cannot carry', () => {
  const { document } = commitLayer(draftFor('brilliant', 'crown', { baseIndex: 2 }));
  const doubled = withDocumentIndexGear(document, 192);
  const facets = doubled.facets.filter((facet) => facet.patternId === 'tool');
  assert.equal(facets[0].metadata.composite.rotation, 4);
  const thirds = withDocumentIndexGear(document, 32);
  assert.equal(thirds.facets.find((facet) => facet.patternId === 'tool').metadata.composite, undefined);
  // Planes never move on a wheel change.
  const before = document.facets.filter((facet) => facet.patternId === 'tool').map((facet) => facet.plane);
  const after = thirds.facets.filter((facet) => facet.patternId === 'tool').map((facet) => facet.plane);
  before.forEach((plane, i) => assert.ok(Math.abs(plane.offset - after[i].offset) < 1e-9));
});

test('draft patches: a composite owns its draft until another mode, ring or grid takes over', () => {
  const draft = { ...defaultDraftForRegion('crown'), ...toolDraftPatch(defaultDraftForRegion('crown'), { composite: { tool: 'brilliant', params: {} }, patternMode: 'composite', baseIndex: 2.6 }) };
  assert.equal(draft.patternMode, 'composite');
  assert.equal(draft.baseIndex, 3);
  assert.equal(draft.composite.params.symmetry, 8);
  assert.equal(toolDraftPatch(draft, { industryAngle: 95 }).industryAngle, compositeTool('brilliant').angle.max);
  assert.equal(toolDraftPatch(draft, { patternMode: 'symmetric' }).composite, null);
  const grid = toolDraftPatch(draft, { grid: { symmetry: 4 }, patternMode: 'grid' });
  assert.equal(grid.composite, null);
  assert.equal(grid.patternMode, 'grid');
  assert.equal(toolDraftPatch(draft, { ring: { kind: 'fan', symmetry: 3, subdivisions: 3, spacingDeg: 15, rotation: 0 } }).composite, null);
});

test('the hood shows every tool plane that bounds the cutting surface, with its machining level', () => {
  for (const id of ['brilliant', 'rose', 'pentagrid']) for (const region of ['crown', 'pavilion']) {
    const { facets } = resolveDraftGeometry(draftFor(id, region), region, reference);
    const hood = toolHood({ facets, reference, region });
    assert.ok(hood && hood.faces.length > 0, `${id} ${region}`);
    assert.ok(hood.faces.every((face) => Number.isInteger(face.level) && face.points.length >= 3));
    const sign = region === 'crown' ? 1 : -1;
    assert.ok(hood.faces.every((face) => face.points.every(([, , z]) => sign * z >= -1e-9)), `${id} ${region}: hood stays on its side`);
  }
});

test('grid rounding that merges cells is reported instead of passing as an exact lattice', () => {
  const merged = gridCutLayout({ symmetry: 4, columns: 12, extent: 0.8 }, { indexTeeth: 32, edgeAngle: 36, depth: 0.5 });
  assert.ok(merged.report.mergedCells > 0);
  assert.equal(gridCutLayout({ symmetry: 4, columns: 6 }).report.mergedCells, 0);
});

test('the public schema declares composite and grid tool metadata that saved layers carry', async () => {
  const { readFileSync } = await import('node:fs');
  const { default: Ajv2020 } = await import('ajv/dist/2020.js');
  const schema = JSON.parse(readFileSync(new URL('../../public/schemas/document-v3.schema.json', import.meta.url)));
  const check = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const { document } = commitLayer(draftFor('rosette', 'crown'));
  // The portable schema describes the v3 format (an empty concave list promotes the document).
  const saved = importFacetingJSON(exportFacetingJSON(normalizeDocumentSchema({ ...document, concaveCuts: [] })));
  assert.equal(check(saved), true, JSON.stringify(check.errors?.slice(0, 3)));
  const broken = structuredClone(saved);
  broken.facets.find((facet) => facet.metadata?.composite).metadata.composite.snap = 'nearest';
  assert.equal(check(broken), false);
  assert.equal(validateFacetingDocument(broken).valid, false);
});

/** Largest |n · p - d| at the least-squares common point of planes n · p = d (min-norm when they share a line). */
function commonPointResidual(planes) {
  const A = [[1e-13, 0, 0], [0, 1e-13, 0], [0, 0, 1e-13]], b = [0, 0, 0];
  for (const { n, d } of planes) for (let i = 0; i < 3; i++) { b[i] += n[i] * d; for (let j = 0; j < 3; j++) A[i][j] += n[i] * n[j]; }
  for (let c = 0; c < 3; c++) {
    const p = [c, c + 1, c + 2].filter((r) => r < 3).reduce((best, r) => (Math.abs(A[r][c]) > Math.abs(A[best][c]) ? r : best), c);
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < 3; r++) { const f = A[r][c] / A[c][c]; for (let k = c; k < 3; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) x[r] = (b[r] - A[r].slice(r + 1).reduce((sum, v, k) => sum + v * x[r + 1 + k], 0)) / A[r][r];
  return Math.max(...planes.map(({ n, d }) => Math.abs(n[0] * x[0] + n[1] * x[1] + n[2] * x[2] - d)));
}

const toolPlane = (plane, teeth) => {
  const phi = (plane.index * 2 * Math.PI) / teeth, g = [plane.m * Math.cos(phi), plane.m * Math.sin(phi)], norm = Math.hypot(g[0], g[1], 1);
  // z = c - g · (x, y)  ⇔  (g, 1) · p = c
  return { n: [g[0] / norm, g[1] / norm, 1 / norm], d: plane.c / norm };
};

// Tools whose ideal shape has meets of four or more faces, the presets the designer named first.
const MEET_CASES = [
  ['asanoha', { lattice: 'tri' }], ['asanoha', { lattice: 'square' }],
  ['pentagrid', { offset: 0.2 }], ['pentagrid', { offset: 0.4 }],
  ['oblique', { crossAngle: 68 }], ['oblique', { crossAngle: 90 }],
  ['brilliant', { symmetry: 12 }], ['step', { symmetry: 16, layers: 4 }], ['scissor', {}], ['rose', { symmetry: 12, layers: 3 }],
  ['split', { symmetry: 6 }], ['arcweave', { shear: 0.55, rows: 12 }], ['spiro', {}],
];
const WHEELS = [96, 64, 72, 80, 120];

test('tooth snapping keeps every meet of four or more faces exact, on whole teeth and symmetric', () => {
  for (const [id, preset] of MEET_CASES) {
    const params = normalizeCompositeParams(id, { ...compositeToolDefaults(id), ...preset });
    const order = compositeTool(id).order(params);
    for (const teeth of WHEELS.filter((teeth) => teeth === 96 || teeth % order === 0)) {
      const label = `${id} ${JSON.stringify(preset)} ${teeth}`;
      const composite = { tool: id, params, extent: 0.9, snap: 'tooth' };
      const { shape, snapped } = compositeToolFrame(composite, { indexTeeth: teeth });
      const { planes, report } = snapped;
      const meets = envelopeMeets(shape);
      assert.ok(meets.length > 0, `${label}: has meets`);
      assert.ok(planes.every((plane) => Number.isInteger(plane.index)), `${label}: whole teeth`);
      if (report.maxSnapDeg === 0) continue;
      // Exact in the tool frame (rim radius 1, unit slope for dome tools).
      const worst = Math.max(...meets.map((meet) => commonPointResidual(meet.planes.map((i) => toolPlane(planes[i], teeth)))));
      assert.ok(worst <= 1e-9, `${label}: tool-frame residual ${worst}`);
      assert.equal(report.meets, meets.length, label);
      // The carried symmetry maps every plane onto a plane with the same slope and height.
      const { rotation, axis } = report.symmetry;
      const has = (index, plane) => planes.some((other) => other.index === ((index % teeth) + teeth) % teeth && Math.abs(other.m - plane.m) < 1e-12 && Math.abs(other.c - plane.c) < 1e-12);
      for (const plane of planes) {
        if (plane.flat) continue;
        for (let k = 1; k < rotation; k++) assert.ok(has(plane.index + (k * teeth) / rotation, plane), `${label}: rotation`);
        if (axis !== null) assert.ok(has(2 * axis - plane.index, plane), `${label}: mirror`);
      }
      if (teeth % order === 0) assert.equal(rotation, order, `${label}: a wheel that carries the symmetry keeps it`);
      // Placed on the stone: angle, depth, rotation and extent move it rigidly, the meets stay exact.
      const draft = draftFor(id, 'crown', { indexTeeth: teeth, industryAngle: compositeToolAngle(id) + 3, baseIndex: 5, composite });
      const facets = resolveDraftGeometry(draft, 'crown', reference).facets;
      const byCell = new Map(facets.map((facet) => [facet.metadata.compositeCell, facet]));
      for (const meet of meets) {
        const placed = meet.planes.map((i) => byCell.get(shape[i].cell));
        if (placed.some((facet) => !facet)) continue;
        const residual = commonPointResidual(placed.map((facet) => ({ n: [facet.plane.normal.x, facet.plane.normal.y, facet.plane.normal.z], d: facet.plane.offset })));
        assert.ok(residual <= 1e-9 * reference.size, `${label}: placed residual ${residual}`);
      }
    }
  }
});

test('the designer\'s lattice tools and the tier tools keep every meet as a corner on wheels that carry them', () => {
  const clean = [
    ['asanoha', { lattice: 'tri' }, [96, 120]], ['asanoha', { lattice: 'square' }, WHEELS],
    ['oblique', { crossAngle: 68 }, WHEELS], ['oblique', { crossAngle: 90 }, WHEELS],
    ['brilliant', { symmetry: 12 }, [64, 72, 80, 120]], ['step', { symmetry: 16, layers: 4 }, [72, 120]], ['scissor', {}, WHEELS],
    ['split', {}, WHEELS], ['arcweave', { shear: 0.55, rows: 12 }, WHEELS],
  ];
  for (const [id, preset, wheels] of clean) for (const teeth of wheels) {
    const params = normalizeCompositeParams(id, { ...compositeToolDefaults(id), ...preset });
    const { report } = compositeToolFrame({ tool: id, params }, { indexTeeth: teeth }).snapped;
    const label = `${id} ${JSON.stringify(preset)} ${teeth}`;
    assert.equal(report.lostMeets, 0, `${label}: every meet stays a corner`);
    assert.equal(report.mergedFacets, 0, `${label}: no facets merge`);
    assert.equal(report.newShortEdge, false, `${label}: no new short edge (${report.shortestEdge})`);
  }
  // The five-fold quasi-crystal keeps every corner on 120 teeth, where neighbouring rhombi less than a
  // tooth apart merge (reported); on 96 teeth some corners are cut off: it says so instead of passing as exact.
  const pentagrid = (indexTeeth) => compositeToolLayout({ tool: 'pentagrid', params: compositeToolDefaults('pentagrid'), snap: 'tooth' }, { indexTeeth, reference, angle: 34, depth: 0.2 }).report;
  assert.deepEqual([pentagrid(120).lostMeets, pentagrid(120).newShortEdge, pentagrid(120).mergedFacets], [0, false, 5]);
  assert.equal(pentagrid(96).meetsExact, true);
  assert.ok(pentagrid(96).lostMeets > 0 && pentagrid(96).exactSymmetry === false);
});

test('tooth snapping is solved once per shape and wheel: angle, depth, rotation and extent reuse it', () => {
  const composite = { tool: 'asanoha', params: compositeToolDefaults('asanoha'), extent: 1, snap: 'tooth' };
  const low = compositeToolFrame(composite, { angle: 20 }), high = compositeToolFrame(composite, { angle: 50 });
  assert.equal(low.snapped, high.snapped, 'a dome tool\'s edge angle only scales the solved shape');
  // A tier tool's tiers follow its main angle non-linearly: one solve per angle, the main angle kept.
  const brilliant = { tool: 'brilliant', params: { symmetry: 12 }, extent: 1, snap: 'tooth' };
  assert.notEqual(compositeToolFrame(brilliant, { indexTeeth: 64, angle: 34 }).snapped, compositeToolFrame(brilliant, { indexTeeth: 64, angle: 36 }).snapped);
  const placed = compositeToolLayout(brilliant, { indexTeeth: 64, reference, angle: 34.5, depth: 0.2 });
  assert.ok(placed.report.meets > 0);
  assert.ok(placed.facets.filter((facet) => facet.tier === 'main').every((facet) => Math.abs(facet.industryAngleDeg - 34.5) < 1e-9), 'the main angle stays as set');
  // Rigid placement: same snapped shape at every rotation, depth and extent.
  const a = compositeToolLayout(composite, { reference, angle: 30, depth: 0.2, rotation: 0 });
  const b = compositeToolLayout({ ...composite, extent: 0.7 }, { reference, angle: 30, depth: 0.35, rotation: 7 });
  a.facets.forEach((facet, i) => {
    assert.equal(b.facets[i].index, (facet.index + 7) % 96);
    assert.ok(Math.abs(b.facets[i].industryAngleDeg - facet.industryAngleDeg) < 1e-9);
  });
});

test('layers saved with the version 1 tooth rule retain their geometry and algorithm across editing', () => {
  const draft = draftFor('asanoha', 'crown', { baseIndex: 2 });
  const { layer } = commitLayer(draft);
  assert.equal(layer[0].metadata.composite.version, COMPOSITE_TOOL_VERSION);
  assert.equal(COMPOSITE_TOOL_VERSION, 2);
  // The same tool as an earlier build saved it: each facet pivoted about its anchor.
  const v1 = compositeToolLayout(draft.composite, { indexTeeth: 96, reference, angle: draft.industryAngle, depth: draft.depth, rotation: draft.baseIndex, version: 1 });
  const legacy = layer.map((facet) => {
    const cell = v1.facets.find((entry) => entry.cell === facet.metadata.compositeCell);
    return resolveFacet({
      ...facet, index: cell.index, baseIndex: cell.index, industryAngleDeg: cell.industryAngleDeg, depth: cell.depth,
      metadata: { ...facet.metadata, composite: { ...facet.metadata.composite, version: 1 } },
    }, { stock: reference });
  });
  assert.ok(legacy.some((facet, i) => Math.abs(facet.depth - layer[i].depth) > 1e-7), 'the two rules differ for this tool');
  const document = createFacetingDocument({ ...base, facets: [...base.facets, ...legacy] });
  assert.equal(validateFacetingDocument(document).valid, true);
  const saved = compositeToolFromFacets(legacy, reference);
  assert.equal(saved?.tool, 'asanoha', 'a version 1 layer is still a tool');
  assert.equal(saved.version, 1);
  // A mismatched rule is rejected; editing retains the stored algorithm.
  assert.equal(compositeToolFromFacets(legacy.map((facet) => ({ ...facet, metadata: { ...facet.metadata, composite: { ...facet.metadata.composite, version: 2 } } })), reference), null);
  assert.equal(compositeToolMetadata({ composite: saved, angle: saved.angle, depth: saved.depth, rotation: saved.rotation }).version, 1);
  const reopened = draftForPattern(legacy, reference);
  assert.equal(reopened.composite.version, 1);
  const patched = { ...reopened, ...toolDraftPatch(reopened, { depth: reopened.depth + 0.01 }) };
  assert.equal(patched.composite.version, 1);
  const unchanged = planDesign(document, [{ kind: 'cut', patternId: 'tool', draft: {} }]).document;
  assert.deepEqual(unchanged.facets.map(f => f.plane), document.facets.map(f => f.plane));
  assert.deepEqual(unchanged.facets.map(f => f.id), document.facets.map(f => f.id));
  const edited = planDesign(document, [{ kind: 'cut', patternId: 'tool', draft: { depth: patched.depth } }]).document;
  const editedLayer = edited.facets.filter(f => f.patternId === 'tool');
  assert.equal(editedLayer[0].metadata.composite.version, 1);
  assert.ok(compositeToolFromFacets(editedLayer, reference));
  assert.equal(importFacetingJSON(exportFacetingJSON(edited)).facets.find(f => f.patternId === 'tool').metadata.composite.version, 1);
  const unknown = structuredClone(document);
  unknown.facets.find((facet) => facet.metadata?.composite).metadata.composite.version = 3;
  assert.equal(validateFacetingDocument(unknown).valid, false);
});

test('default lattice tools solve quickly (timing logged)', (t) => {
  for (const id of ['asanoha', 'pentagrid', 'oblique', 'honeycomb']) {
    // A fresh shape (an unused density) so the cache cannot answer.
    const params = { ...compositeToolDefaults(id), density: id === 'pentagrid' ? 4 : 5 };
    const started = performance.now();
    const { report } = compositeToolFrame({ tool: id, params }, { indexTeeth: 96 }).snapped;
    const ms = performance.now() - started;
    t.diagnostic(`${id} density ${params.density}: ${report.meets} meets, ${ms.toFixed(1)} ms`);
    assert.ok(ms < 2000, `${id} took ${ms} ms`);
  }
});
