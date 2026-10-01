import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importNativeDocument } from '../src/domain/io.js';
import { makeNativeDocument } from '../src/adapters/opengemcutting.js';
import { createStudioStore } from '../src/application/studioStore.js';
import { validateWorkspace } from '../src/domain/workspace.js';
import { generatePreset } from '../src/domain/generators.js';
import { normalizeTransform } from '../src/domain/math.js';
const directory = new URL('../vendor/labs-contract/1.2.0/', import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, directory)));
for (const entry of read('MANIFEST.json').samples) {
    const sample = read(entry.file);
    test(`public contract: ${entry.id}`, () => {
        const input = sample.normalized ?? sample.input, before = structuredClone(input);
        if (sample.reject) assert.throws(() => importNativeDocument(input, { convexOnly: true }));
        else {
            let doc = input;
            for (let i = 0; i < 3; i++) {
                const state = importNativeDocument(doc, { convexOnly: true });
                doc = makeNativeDocument(state.stock, state.nativeDocument, state.groups);
                assert.deepEqual(doc, input);
            }
        }
        assert.deepEqual(input, before);
    });
}
test('source session starts without default crown; workspace retains complete source', () => {
    const input = read('samples/surface-scale-source.json').normalized;
    const store = createStudioStore({ initialDocument: input, embedded: true });
    assert.equal(store.hasPendingDraft(), false);
    assert.equal(store.getState().model.draftActive, false);
    assert.deepEqual(store.candidateDocument(), input);
    const saved = store.api.exportWorkspace();
    assert.deepEqual(validateWorkspace(saved).nativeDocument, input);
    store.destroy();
});
test('recovered groups preserve interleaved operation identities, surfaces and extension data', () => {
    const input = read('samples/96-legacy.json').normalized;
    const model = importNativeDocument(input);
    const groups = [{ id: 'own-crown', component: generatePreset(), transform: normalizeTransform({ translation: [0,0,.045] }) }];
    const doc = makeNativeDocument(model.stock, input, groups);
    const own = doc.facets.filter(f => f.metadata?.componentInstanceId);
    const rest = doc.facets.filter(f => !f.metadata?.componentInstanceId);
    doc.facets = own.flatMap((f,i) => [f, ...(rest[i] ? [rest[i]] : [])]).concat(rest.slice(own.length));
    own[0].metadata.surfaceFinish = { version: 1, model: 'ggx-dielectric', state: 'frosted', alpha: .2 };
    own[1].extensions = { notes: { version: 1, required: false, data: 'keep' } };
    const restored = importNativeDocument(doc);
    assert.deepEqual(makeNativeDocument(restored.stock, restored.nativeDocument, restored.groups), doc);
    const ws = createStudioStore({ initialDocument: doc }).api.exportWorkspace();
    assert.equal(validateWorkspace(ws).groups.length, 1);
    restored.groups[0].transform.translation[2] += .02;
    const edited = makeNativeDocument(restored.stock, restored.nativeDocument, restored.groups);
    assert.deepEqual(edited.facets.map(f => f.id), doc.facets.map(f => f.id));
    for (const facet of rest) assert.deepEqual(edited.facets.find(f => f.id === facet.id), facet);
    assert.deepEqual(edited.facets[0].metadata.surfaceFinish, own[0].metadata.surfaceFinish);
    assert.deepEqual(edited.facets.find(f => f.id === own[1].id).extensions, own[1].extensions);
});

test('native crown section keeps both sides when vertices nearly lie on the section plane', async () => {
    const { createPresetStudioSession } = await import('../src/application/labSession.js');
    const { cutSolid, sectionSegments } = await import('../src/domain/geometry.js');
    const { instancePlanes } = await import('../src/adapters/opengemcutting.js');
    const session=await createPresetStudioSession({newDesign:{sizeMm:10,teeth:96}});
    const { stock, basePlanes }=session.store.getState().model;
    const polys=cutSolid(stock.polys,[...basePlanes,...instancePlanes(generatePreset(),{translation:[0,0,.045]})]);
    const segments=sectionSegments(polys.map(f=>({...f,v:f.v.map(([x,y,z])=>[x,z,y])})),0);
    for(const side of [-1,1]) assert.ok(segments.some(([a,b])=>Math.abs(a[0]-side)<1e-6 && Math.abs(b[0]-side)<1e-6 && Math.abs(a[1]-b[1])>1));
    session.dispose();
});

test('component export creates uniform angle/depth CUT groups for host instructions', () => {
    const input=read('samples/96-legacy.json').normalized, m=importNativeDocument(input);
    const c=generatePreset();const doc=makeNativeDocument(m.stock,null,[{id:'crown',component:c,transform:{}}]);
    const groups=new Map();for(const f of doc.facets) { if(!groups.has(f.patternId)) groups.set(f.patternId,[]);groups.get(f.patternId).push(f); }
    assert.ok(groups.size>1);
    for(const facets of groups.values()) {
        for(const f of facets) {assert.ok(Math.abs(f.industryAngleDeg-facets[0].industryAngleDeg)<1e-8);assert.ok(Math.abs(f.depth-facets[0].depth)<1e-8);}
        assert.deepEqual(facets.map(f=>f.ordinal),facets.map((_,i)=>i));
    }
    const restored=importNativeDocument(doc);assert.equal(restored.groups.length,1);
    assert.deepEqual(makeNativeDocument(restored.stock,restored.nativeDocument,restored.groups),doc);
});
