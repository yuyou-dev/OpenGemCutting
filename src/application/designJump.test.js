import assert from 'node:assert/strict';
import test from 'node:test';
import { designJumpCandidates } from './designJump.js';
import { constructionPrefix, topologyOf } from './designOperations.js';
import { createMeshDocument } from '../domain/stockGeometry.js';
import { createCenteredCube } from '../domain/geometry.js';
import { createFacetingDocument, getCuttingReference, resolveFacetPattern } from '../domain/faceting.js';
import { resolveDraftGeometry } from '../domain/cutConstruction.js';
import { generateJumpCandidates, generateDualJumpCandidates } from '../domain/meetJump.js';

function fixture(indexTeeth = 96, legacy = false) {
  const mesh = createMeshDocument({ mesh: createCenteredCube(3), unit: 'mm' });
  const { cuttingReference, concaveCuts, ...old } = mesh;
  const blank = legacy ? { ...old, schemaVersion: 2 } : mesh;
  const draft = { industryAngle: 35, depth: 0.3, baseIndex: indexTeeth / 8, repeat: 1, mirrorOffset: 0, patternMode: 'symmetric', indexTeeth };
  const facets = resolveFacetPattern({ ...draft, industryAngleDeg: draft.industryAngle, region: 'crown', patternId: 'C1' }, { stock: getCuttingReference(blank) });
  return { document: createFacetingDocument({ ...blank, indexGear: indexTeeth, facets }), draft };
}

test('bridge Jump depth uses the fixed reference on 96 and fractional multi-index designs', () => {
  for (const teeth of [96, 77, 120]) {
    const { document, draft } = fixture(teeth);
    const before = JSON.stringify(document);
    const candidates = designJumpCandidates(document, { region: 'crown', draft });
    assert.ok(candidates.length);
    assert.ok(Math.abs(candidates[0].depth - 0.3) < 1e-9);
    const geometry = resolveDraftGeometry(draft, 'crown', getCuttingReference(document));
    const baseSolid = constructionPrefix(document);
    assert.deepEqual(candidates, generateJumpCandidates({ baseSolid, normal: geometry.facets[0].plane.normal, stock: getCuttingReference(document) }));
    const wrong = generateJumpCandidates({ baseSolid, normal: geometry.facets[0].plane.normal, stock: document.stock });
    assert.ok(Math.abs(wrong[0].depth - candidates[0].depth) > 0.2, 'fixture distinguishes the old bridge path');
    assert.equal(JSON.stringify(document), before, 'read-only query does not edit the design');
  }
});

test('bridge dual Jump and saved-layer queries keep fixed and legacy coordinate systems', () => {
  for (const legacy of [false, true]) {
    const { document, draft } = fixture(96, legacy);
    const baseSolid = constructionPrefix(document, 'C1');
    const { vertices } = topologyOf(baseSolid);
    let checked = 0;
    for (const target of vertices) {
      const expected = generateDualJumpCandidates({ baseSolid, targetA: target, baseIndex: draft.baseIndex, indexTeeth: 96, region: 'crown', stock: getCuttingReference(document) });
      const actual = designJumpCandidates(document, { patternId: 'C1', region: 'crown', targetA: target.topologyKey });
      assert.deepEqual(actual, expected);
      checked += actual.length;
    }
    assert.ok(checked > 0);
    const candidates = designJumpCandidates(document, { region: 'crown', draft });
    assert.ok(Math.abs(candidates[0].depth - 0.3) < 1e-9);
  }
});
