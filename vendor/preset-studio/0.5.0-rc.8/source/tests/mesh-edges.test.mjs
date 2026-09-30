import test from 'node:test';
import assert from 'node:assert/strict';
import { meshEdges } from '../src/viewport/mesh-edges.js';
import { createPresetStudioSession } from '../src/application/labSession.js';
import { prismSolid, cubeSolid, clipConvex } from '../src/domain/geometry.js';
import { triangulateFace, validateMesh } from '../src/domain/io.js';
import { signedVolume } from '../src/domain/math.js';

const edgeKey = ({ a, b }) => [a, b].map(v => v.map(n => Math.round(n * 1e7)).join(',')).sort().join('|');
const edgeKeys = polys => meshEdges(polys).map(edgeKey).sort();
const triangles = polys => polys.flatMap(f => triangulateFace(f.v).map(v => ({ ...f, v })));
const square = () => triangles([{ id: 'surface', isCut: false, v: [[0,0,0],[1,0,0],[1,1,0],[0,1,0]] }]);

test('native new and rc.5 restored experiments show 96 stock creases without changing the mesh', async () => {
    let saved;
    const options = { newDesign: { teeth: 96, sizeMm: 10 }, persistence: { load: () => saved, save: value => { saved = structuredClone(value); } } };
    for (let i = 0; i < 2; i++) {
        const session = await createPresetStudioSession(options);
        try {
            const polys = session.store.getState().model.stock.polys, before = structuredClone(polys);
            const document = (await session.returnResult()).document;
            assert.deepEqual(validateMesh(polys), { valid: true, convex: true, vertices: 64, shells: 1 });
            assert.equal(polys.length, 124);
            assert.equal(meshEdges(polys).length, 96);
            assert.deepEqual(edgeKeys(polys), edgeKeys(prismSolid()));
            assert.deepEqual(polys, before);
            assert.deepEqual((await session.returnResult()).document, document);
            assert.ok(Math.abs(signedVolume(polys) - signedVolume(prismSolid())) < 1e-10);
            await session.flush();
        } finally { session.dispose(); }
        saved.moduleVersion = '0.5.0-rc.5';
    }
});

test('triangulation preserves real ridges and open boundaries', () => {
    assert.equal(meshEdges(triangles(cubeSolid())).length, 12);
    assert.equal(meshEdges(square()).length, 4);
    const bent = square(); bent[0].v = bent[0].v.map(v => v[0] === 0 && v[1] === 0 ? [0,0,.1] : v);
    assert.equal(meshEdges(bent).length, 5);
});

test('CUT ownership boundaries remain visible and draft color wins regardless of face order', () => {
    const polys = square().map((f, i) => ({ ...f, isCut: true, id: `cut-${i}`, instanceId: i ? 'draft' : 'applied' }));
    const shared = meshEdges(polys).find(e => e.a[0] !== e.b[0] && e.a[1] !== e.b[1]);
    assert.equal(meshEdges(polys).length, 5);
    assert.equal(shared.draft, true);
    assert.deepEqual(meshEdges(polys.slice().reverse()).find(e => edgeKey(e) === edgeKey(shared)).draft, true);
    assert.equal(meshEdges(polys.map(f => ({ ...f, id: 'same-cut', instanceId: 'draft' }))).length, 4);
});

test('clipped stock hides the remaining diagonal but keeps the new CUT perimeter', () => {
    const cut = { n: [0,0,1], d: .5, id: 'table', isCut: true, instanceId: 'draft' };
    const result = clipConvex(triangles(cubeSolid()), [cut]);
    const edges = meshEdges(result);
    assert.ok(edges.some(e => e.draft));
    // Every visible edge lies along a real box ridge or the new horizontal cut.
    for (const { a, b } of edges) assert.equal(a.filter((v, i) => Math.abs(v - b[i]) > 1e-7).length, 1);
});

test('edge cache follows immutable geometry instead of leaking across edits', () => {
    const original = square();
    assert.equal(meshEdges(original), meshEdges(original));
    assert.equal(meshEdges(original.slice(0,1)).length, 3);
    assert.equal(meshEdges(original).length, 4);
});
