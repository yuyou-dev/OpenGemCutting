import test from 'node:test';
import assert from 'node:assert/strict';
import { planGirdleRecut } from '../src/domain/girdle.js';
import { generatePreset } from '../src/domain/generators.js';
import { prismSolid, cutSolid } from '../src/domain/geometry.js';
import { normalizeTransform, dot, signedVolume, polygonNormal } from '../src/domain/math.js';
import { instancePlanes, makeNativeDocument } from '../src/adapters/opengemcutting.js';
import { importNativeDocument } from '../src/domain/io.js';
import { validateWorkspace } from '../src/domain/workspace.js';
import { createStudioStore } from '../src/application/studioStore.js';
import { previewPlanesOf } from '../src/application/viewModels.js';
const stock = { kind: 'preform', polys: prismSolid(), convex: true };
const near = (a,b,tolerance=1e-7) => assert.ok(Math.abs(a-b)<tolerance, `${a} != ${b}`);
for (const part of ['crown','pavilion']) test(`${part} recut produces one level perimeter with matching facets, without moving component`, () => {
    const component=generatePreset({part,family:'fan',params:{symmetry:32}}), transform=normalizeTransform({translation:[0,0,part==='crown'?.045:-.045]});
    const before=structuredClone({component,transform,stock});
    const r=planGirdleRecut({component,transform,stock});
    assert.equal(r.facets,32); assert.equal(r.canApply,true); assert.ok(r.maxRelativeReduction<.01);
    // Independent analytic result: two half-step 32-gons nested in the same stock.
    for(const p of r.planes) near(p.d,Math.cos(Math.PI/32)**2);
    const polys=cutSolid(stock.polys,[...r.planes,...instancePlanes(component,transform)]);
    const girdle=polys.filter(f=>f.part==='girdle'); assert.equal(girdle.length,32);
    for(const face of girdle) {
        const z=part==='crown'?Math.max(...face.v.map(v=>v[2])):Math.min(...face.v.map(v=>v[2]));
        near(z,r.datumZ);
        near(polygonNormal(face.v)[2],0);
    }
    for(const p of r.planes) {
        const source=instancePlanes(component,transform).find(q=>q.sourcePlaneId===p.sourcePlaneId);
        const edge=r.polygon.filter(v=>Math.abs(p.n[0]*v[0]+p.n[1]*v[1]-p.d)<1e-7);
        assert.equal(edge.length,2);
        for(const v of edge) near(dot(source.n,[...v,r.datumZ]),source.d);
    }
    // No material grows beyond the old vertical faces.
    for(const face of stock.polys.filter(f=>f.part==='girdle')) {
        const n=polygonNormal(face.v), d=dot(n,face.v[0]);
        assert.ok(r.polygon.every(v=>dot(n,[...v,r.datumZ])<=d+1e-7));
    }
    assert.deepEqual({component,transform,stock},before);
});
test('classic brilliant permits the least-material 16-face recut despite a reduction above 1%', () => {
    const r=planGirdleRecut({component:generatePreset(),transform:normalizeTransform(),stock});
    assert.equal(r.facets,16); near(r.maxRelativeReduction,1-Math.cos(Math.PI/16));
    assert.equal(r.canApply,true); assert.deepEqual(r.reasons,[]);
});
test('exact geometry is retained while noninteger girdle normals block application', () => {
    const r=planGirdleRecut({component:generatePreset({family:'fan',params:{symmetry:32}}),transform:normalizeTransform({rotation:[0,0,3.75]}),stock,teeth:64});
    assert.equal(r.canApply,false); assert.match(r.reasons.join(),/整数分度/); near(Math.atan2(r.planes[0].n[1],r.planes[0].n[0])*180/Math.PI/3.75,Math.round(Math.atan2(r.planes[0].n[1],r.planes[0].n[0])*180/Math.PI/3.75));
});
test('an opposite cut invading the candidate perimeter is reported, not hidden', () => {
    const r=planGirdleRecut({component:generatePreset({family:'fan',params:{symmetry:32}}),transform:normalizeTransform(),stock,otherPlanes:[{n:[0,0,-1],d:-.5}]});
    assert.equal(r.canApply,false); assert.match(r.reasons.join(),/切入目标交线/);
});
test('recut is an independent reversible girdle operation; crown, pavilion and raw stock survive', () => {
    const s=createStudioStore();
    const before=structuredClone(s.getState().model), report=s.recutGirdle('crown'), after=s.getState().model;
    assert.equal(after.girdlePlanes.length,16);
    assert.ok(report.maxRelativeReduction>.01);
    for(const key of ['draft','transform','groups','stock','editId']) assert.deepEqual(after[key],before[key]);
    const restored=validateWorkspace(s.api.exportWorkspace()); assert.deepEqual(restored.girdlePlanes,after.girdlePlanes);
    const polys=cutSolid(after.stock.polys,previewPlanesOf(after));
    assert.ok(polys.some(f=>f.part==='crown'));assert.ok(polys.some(f=>f.part==='pavilion'));
    for(const f of polys.filter(f=>f.part==='girdle')) near(Math.max(...f.v.map(v=>v[2])),report.datumZ);
    s.undo(); assert.deepEqual(s.getState().model,before); s.redo(); assert.deepEqual(s.getState().model.girdlePlanes,report.planes); s.destroy();
});
test('physically impossible recut cannot modify state or consume undo history', () => {
    const s=createStudioStore();
    s.onTransform(normalizeTransform({translation:[0,0,-.5]}));
    const before=structuredClone(s.getState().model), historySize=s.getState().session.historySize;
    assert.throws(()=>s.recutGirdle('crown'), /切入目标交线/);
    assert.deepEqual(s.getState().model,before);assert.equal(s.getState().session.historySize,historySize);s.destroy();
});
test('embedded recut stays transactional even for a geometrically valid candidate', () => {
    const s=createStudioStore({onApply:()=>{throw Error('unexpected host write');}}),before=structuredClone(s.getState().model);
    assert.equal(s.planGirdle('crown').canApply,true);
    assert.throws(()=>s.recutGirdle('crown'), /宿主/);
    assert.deepEqual(s.getState().model,before);assert.equal(s.getState().session.historySize,0);s.destroy();
});
test('native round-trip preserves recut faces as true CUT and the complete assembled solid', () => {
    const s=createStudioStore();s.setDraft(generatePreset({family:'fan',params:{symmetry:32}}));s.recutGirdle('crown');
    const m=s.getState().model,groups=[...m.groups,{id:'test-crown',component:m.draft,transform:m.transform}];
    const doc=makeNativeDocument(stock,null,groups,m.girdlePlanes), restored=importNativeDocument(doc);
    assert.equal(doc.facets.filter(f=>f.region==='girdle').length,32);assert.equal(restored.basePlanes.length,32);
    const after=cutSolid(restored.stock.polys,[...restored.basePlanes,...restored.groups.flatMap(g=>instancePlanes(g.component,g.transform,g.id))]);
    near(signedVolume(after),signedVolume(cutSolid(stock.polys,previewPlanesOf(m))));s.destroy();
});
test('workspace rejects tilted, duplicate or invalid independent girdle planes', () => {
    const s=createStudioStore(),w=s.api.exportWorkspace();w.state.girdlePlanes=[{n:[1,0,.1],d:1,id:'bad'}];
    assert.throws(()=>validateWorkspace(w),/竖直平面/);w.state.girdlePlanes=[{n:[1,0,0],d:1,id:'a'},{n:[0,1,0],d:1,id:'a'}];
    assert.throws(()=>validateWorkspace(w),/ID/);s.destroy();
});
test('pavilion Z contact keeps the crown present in the actual cut result', () => {
    const s=createStudioStore(),before=structuredClone(s.getState().model);s.contactGirdle('pavilion',0);
    const after=s.getState().model,polys=cutSolid(after.stock.polys,previewPlanesOf(after));
    assert.equal(polys.filter(f=>f.part==='crown').length,33);
    assert.equal(polys.filter(f=>f.part==='pavilion').length,24);
    assert.deepEqual(after.draft,before.draft);assert.deepEqual(after.transform,before.transform);s.destroy();
});
