import test from 'node:test';
import assert from 'node:assert/strict';
import { girdleContact } from '../src/domain/girdle.js';
import { generatePreset } from '../src/domain/generators.js';
import { prismSolid } from '../src/domain/geometry.js';
import { normalizeTransform, transformPlane } from '../src/domain/math.js';
import { createStudioStore } from '../src/application/studioStore.js';
const stock = { kind: 'preform', polys: prismSolid() };
const near = (a, b) => assert.ok(Math.abs(a-b) < 1e-7, `${a} != ${b}`);
for (const part of ['crown', 'pavilion']) test(`${part} exact polygon contact preserves angle, shape, radius and supports Z offset`, () => {
    const c = generatePreset({ family: 'fan', part, params: { symmetry: 32, phase: 5.625 } });
    const t = normalizeTransform({ scale: [Math.cos(Math.PI/32), Math.cos(Math.PI/32), 1.2], translation: [0,0,.4] });
    const before = structuredClone({ c, t, stock });
    const r = girdleContact(c,t,stock,.1);
    assert.equal(r.exact,true); near(r.transform.translation[2],.1);
    assert.deepEqual(r.transform.scale,t.scale); assert.deepEqual(r.transform.rotation,t.rotation);
    assert.deepEqual({c,t,stock},before);
    near(girdleContact(c,r.transform,stock,.1).deltaZ,0);
});
test('edge-interior envelope changes cannot be mistaken for full-ring contact', () => {
    const c=generatePreset(), t=normalizeTransform();
    const r=girdleContact(c,t,stock);
    assert.equal(r.exact,false); assert.ok(r.spread > .001);
    const planes=c.planes.map(p=>transformPlane(p,r.transform));
    for(const face of stock.polys.filter(p=>p.part==='girdle')) for(const v of face.v) {
        const h=Math.min(...planes.filter(p=>p.n[2]>1e-9).map(p=>(p.d-p.n[0]*v[0]-p.n[1]*v[1])/p.n[2]));
        assert.ok(h>=-1e-7);
    }
});
test('undefined girdle and inaccessible Z are rejected', () => {
    assert.throws(()=>girdleContact(generatePreset(),normalizeTransform(),{...stock,kind:'imported',convex:false}),/凸腰棱/);
    assert.throws(()=>girdleContact(generatePreset(),normalizeTransform(),stock,20),/范围/);
});
test('opposite-part contact preserves the unsaved crown and edits only pavilion Z, with undo', () => {
    const store=createStudioStore({storage:{getItem(){throw Error('must not read');},setItem(){throw Error('must not write');}}});
    const before=structuredClone(store.getState().model);
    store.contactGirdle('pavilion',0);
    const after=store.getState().model;
    assert.deepEqual(after.draft,before.draft);
    assert.deepEqual(after.transform,before.transform);
    assert.equal(after.editId,before.editId);
    assert.deepEqual(after.groups[0].component,before.groups[0].component);
    assert.deepEqual(after.groups[0].transform.scale,before.groups[0].transform.scale);
    assert.deepEqual(after.groups[0].transform.rotation,before.groups[0].transform.rotation);
    assert.notEqual(after.groups[0].transform.translation[2],before.groups[0].transform.translation[2]);
    store.undo(); assert.deepEqual(store.getState().model,before);
    assert.equal(store.exportStatus('library').enabled,false);
    assert.equal('personal' in store.getState(),false);
    store.destroy();
});
test('embedded contact cannot silently rewrite another committed component', () => {
    const store=createStudioStore({onApply:()=>{throw Error('unexpected host write');}});
    const before=structuredClone(store.getState().model);
    assert.throws(()=>store.contactGirdle('pavilion',0),/宿主/);
    assert.deepEqual(store.getState().model,before);
    store.contactGirdle('crown',0);
    assert.deepEqual(store.getState().model.groups,before.groups);
    store.destroy();
});
test('unsupported vertical constraints and reverse faces reject without modifying transform', () => {
    const c=generatePreset(),t=normalizeTransform();
    assert.throws(()=>girdleContact({...c,planes:[...c.planes,{n:[1,0,0],d:.5}]},t,stock),/竖直切面/);
    assert.throws(()=>girdleContact({...c,planes:[...c.planes,{n:[0,0,-1],d:0}]},t,stock),/反向切面/);
    assert.deepEqual(t,normalizeTransform());
});
test('circumferential envelope range agrees with dense independent edge samples', () => {
    for(const part of ['crown','pavilion']) {
        const c=generatePreset({part}), t=normalizeTransform({scale:[1.1,.8,1.2],rotation:[0,0,15],translation:[0,0,.1]});
        const r=girdleContact(c,t,stock), planes=c.planes.map(p=>transformPlane(p,t));
        const values=[];
        for(let i=0;i<32;i++) for(let k=0;k<=120;k++) {
            const a=i*Math.PI/16,b=(i+1)*Math.PI/16,u=k/120;
            const x=(1-u)*Math.cos(a)+u*Math.cos(b),y=(1-u)*Math.sin(a)+u*Math.sin(b);
            const hs=planes.filter(p=>Math.abs(p.n[2])>1e-9).map(p=>(p.d-p.n[0]*x-p.n[1]*y)/p.n[2]);
            values.push(part==='crown'?Math.min(...hs):Math.max(...hs));
        }
        const spread=Math.max(...values)-Math.min(...values);
        assert.ok(r.spread >= spread-1e-7 && r.spread-spread < .001);
    }
});
