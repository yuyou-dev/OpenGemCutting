import { fitRim } from '../src/application/fitRim.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitReferenceRim } from '../src/domain/rim-fit.js';
import { generatePreset } from '../src/domain/generators.js';
import { prismSolid } from '../src/domain/geometry.js';
import { normalizeTransform, transformPlane } from '../src/domain/math.js';
import { createStudioStore } from '../src/application/studioStore.js';
const stock = { kind: 'preform', convex: true, polys: prismSolid() };
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-7, `${a} != ${b}`);
for (const part of ['crown','pavilion']) test(`${part}: uniform fit matches identical outlines and preserves facet normals`, () => {
    const component = generatePreset({ family:'fan', part, params:{symmetry:32,phase:5.625} });
    for (const scale of [.6,1.4]) {
        const t=normalizeTransform({scale:[scale,scale,scale],translation:[0,0,part==='crown'?.045:-.045]});
        const original=structuredClone({component,t,stock});
        const r=fitReferenceRim(component,t,stock);
        assert.equal(r.exact,true);
        near(r.transform.scale[0],Math.cos(Math.PI/32));
        assert.deepEqual(r.transform.translation,t.translation);
        assert.deepEqual(r.transform.rotation,t.rotation);
        component.planes.forEach(p=>transformPlane(p,t).n.forEach((n,i)=>near(n,transformPlane(p,r.transform).n[i])));
        assert.deepEqual({component,t,stock},original);
        near(fitReferenceRim(component,r.transform,stock).factor,1);
    }
});
test('different outlines report nonzero residual and honor previously cut girdle',()=>{
    const c=generatePreset(), t=normalizeTransform();
    const r=fitReferenceRim(c,t,stock);
    assert.equal(r.exact,false); assert.ok(r.deviation>0);
    const narrowed=fitReferenceRim(c,t,stock,[{n:[1,0,0],d:.8}]);
    assert.ok(narrowed.factor<r.factor);
    assert.ok(narrowed.deviation>r.deviation);
    assert.throws(()=>fitReferenceRim(c,normalizeTransform({translation:[0,0,20]}),stock),/高度/);
    assert.throws(()=>fitReferenceRim(c,t,{...stock,kind:'imported',convex:false}),/凸底胚/);
});
test('fit is an unapplied draft edit; other groups and stock survive; undo restores it',()=>{
    const s=createStudioStore();
    try {
        s.onTransform(normalizeTransform({scale:[.6,.6,.6],translation:[0,0,.045]}));
        const before=structuredClone(s.getState().model);
        assert.equal(s.fitRim, undefined); // Existing mounted stores have no new command method.
        fitRim(s);
        const after=s.getState().model;
        assert.deepEqual(after.groups,before.groups);
        assert.deepEqual(after.stock,before.stock);
        assert.deepEqual(after.draft,before.draft);
        assert.ok(s.hasPendingDraft());
        assert.notDeepEqual(after.transform,before.transform);
        s.undo(); assert.deepEqual(s.getState().model,before);
    } finally {s.destroy();}
});
