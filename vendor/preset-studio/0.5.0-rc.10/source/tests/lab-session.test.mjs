import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresetStudioSession } from '../src/application/labSession.js';
import { generatePreset } from '../src/domain/generators.js';
import { moduleInfo } from '../src/lab/info.js';
import { cubeDocument } from './fixtures.mjs';
const source = () => ({ projectId: 'source', revision: 1, document: cubeDocument() });
const waitPreview = async store => { for (let i=0;i<200 && !store.getState().preview.valid;i++) await new Promise(r=>setTimeout(r,5)); assert.ok(store.getState().preview.valid); };
test('autosave + flush preserves unapplied edits and restores them without modifying source', async () => {
    let saved; const input = source(), before = structuredClone(input);
    const persistence = {load:()=>saved,save:value=>{saved=structuredClone(value);}};
    let s = await createPresetStudioSession({source:input,persistence});
    s.store.start(); s.store.api.loadComponent(generatePreset());
    s.store.onTransform({ translation:[0,0,.07],scale:[.8,.8,.8] });
    s.pause(); await s.flush();
    assert.equal(saved.workspace.state.groups.length,0);
    assert.equal(saved.workspace.state.draftActive,true);
    const pending = s.store.api.exportWorkspace(); s.dispose();
    s = await createPresetStudioSession({source:input,persistence});
    assert.deepEqual(s.store.api.exportWorkspace(),pending);
    await assert.rejects(s.returnResult(),/未应用/);
    s.store.start(); await waitPreview(s.store); assert.equal(await s.store.apply(),true);
    await waitPreview(s.store);
    assert.equal((await s.returnResult()).document.facets.length,33);
    assert.deepEqual(input,before); s.dispose();
});
test('failed save retries, pause stops edits, resume returns the same source', async () => {
    let fail = true, saves=0;
    const s = await createPresetStudioSession({source:source(),persistence:{save:()=>{saves++; if(fail) throw Error('disk full');}}});
    await assert.rejects(s.flush(),/disk full/); fail=false; await s.flush(); assert.ok(saves>=2);
    s.pause(); assert.equal(s.store.unlocked(),false); s.resume(); assert.equal(s.store.unlocked(),true);
    assert.deepEqual((await s.returnResult()).document,source().document); s.dispose(); s.dispose();
});
test('abort during delayed load does not create a late session', async () => {
    let release; const signal=new AbortController();
    const pending=createPresetStudioSession({source:source(),signal:signal.signal,persistence:{load:()=>new Promise(r=>release=r)}});
    signal.abort(); await assert.rejects(pending,{name:'AbortError'}); release(null);
});
test('editing while return is awaiting save cancels that candidate', async () => {
    let release; const s=await createPresetStudioSession({source:source(),persistence:{save:()=>new Promise(r=>release=r)}});
    let sent=0;
    const result=assert.rejects(s.returnResult(),{name:'AbortError'}); await new Promise(r=>setTimeout(r,0));
    s.store.api.loadComponent(generatePreset()); release();
    // A new queued save also needs completing; cancellation must not submit stale data.
    await new Promise(r=>setTimeout(r,0)); release();
    await result; assert.equal(sent,0); s.dispose();
});
test('new experiment starts like the editor default: a block and one visible whole-tooth girdle', async () => {
    const { compatibleRepeat } = await import('../vendor/labs-contract/1.3.0/index.js');
    for (const teeth of [96, 77, 120]) {
        const s=await createPresetStudioSession({newDesign:{teeth,sizeMm:8}});
        const result=await s.returnResult(); assert.equal(result.document.metadata.physicalScale.millimetersPerModelUnit,4);
        assert.equal(result.document.indexGear.teeth,teeth); assert.equal(result.document.stock.kind,'cube');
        const girdle=result.document.facets;
        assert.equal(girdle.length,compatibleRepeat(teeth)); assert.ok(girdle.every(f=>f.region==='girdle'&&f.patternId==='girdle-preform'&&Number.isInteger(f.index)));
        s.dispose();
    }
});
test('explicit replacement retains the opposite side and undo restores all original operations', async () => {
    const { makeNativeDocument } = await import('../src/adapters/opengemcutting.js');
    const { importNativeDocument } = await import('../src/domain/io.js');
    const { cubeSolid } = await import('../src/domain/geometry.js');
    const original=makeNativeDocument({polys:cubeSolid(2.4),nativeStock:cubeDocument().stock},null,[
        {id:'c',component:generatePreset(),transform:{}},{id:'p',component:generatePreset({part:'pavilion'}),transform:{}}
    ]);
    delete original.metadata.componentInstances; for(const f of original.facets) delete f.metadata.componentInstanceId;
    const s=await createPresetStudioSession({source:{projectId:'replace',revision:1,document:original}});
    s.store.start();s.store.api.loadComponent(generatePreset({params:{table:.4}}));
    const ids=original.facets.filter(f=>f.region==='crown').map(f=>f.id);
    assert.throws(()=>s.store.previewSourceReplacement([original.facets.find(f=>f.region==='pavilion').id]),/同部位/);
    s.store.previewSourceReplacement(ids);await waitPreview(s.store);assert.equal(await s.store.apply(),true);await waitPreview(s.store);
    const changed=(await s.returnResult()).document;
    assert.equal(changed.facets.length,original.facets.length);
    assert.deepEqual(changed.facets.filter(f=>f.region==='pavilion'),original.facets.filter(f=>f.region==='pavilion'));
    assert.ok(ids.every(id=>!changed.facets.some(f=>f.id===id)));
    const imported=importNativeDocument(changed);assert.equal(imported.groups.length,1);
    s.store.undo();await waitPreview(s.store);assert.deepEqual(s.store.getState().model.nativeDocument,original);
    assert.equal(s.store.getState().model.basePlanes.length,original.facets.length);
    s.dispose();
});

test('known rc.1, rc.6 and rc.7 drafts migrate on save; future drafts remain untouched', async () => {
    let saved;
    const persistence={load:()=>saved,save:value=>{saved=structuredClone(value);}};
    let s=await createPresetStudioSession({source:source(),persistence}); await s.flush();s.dispose();
    for (const version of ['0.5.0-rc.1', '0.5.0-rc.6', '0.5.0-rc.7']) {
        saved.moduleVersion=version;
        const workspace=structuredClone(saved.workspace);
        s=await createPresetStudioSession({source:source(),persistence});await s.flush();s.dispose();
        assert.equal(saved.moduleVersion,moduleInfo.moduleVersion);
        assert.deepEqual(saved.workspace,workspace);
    }
    saved.moduleVersion='9.0.0';const before=structuredClone(saved);
    await assert.rejects(createPresetStudioSession({source:source(),persistence}),/版本或来源不匹配/);
    assert.deepEqual(saved,before);
});
test('pausing while candidate awaits save cancels promptly without a late return', async () => {
    let release, sent=0;
    const s=await createPresetStudioSession({source:source(),persistence:{save:()=>new Promise(r=>release=r)},onResult:()=>{sent++;}});
    const pending=s.returnResult();await new Promise(r=>setTimeout(r,0));s.pause();
    assert.equal(await pending,undefined);release();await s.flush();assert.equal(sent,0);s.dispose();
});
test('a component that repeats a whole source operation asks first and replaces it by default', async () => {
    const { makeNativeDocument } = await import('../src/adapters/opengemcutting.js');
    const { cubeSolid } = await import('../src/domain/geometry.js');
    const original=makeNativeDocument({polys:cubeSolid(2.4),nativeStock:cubeDocument().stock},null,[
        {id:'c',component:generatePreset(),transform:{}},{id:'p',component:generatePreset({part:'pavilion'}),transform:{}}
    ]);
    delete original.metadata.componentInstances; for(const f of original.facets) delete f.metadata.componentInstanceId;
    const crown=original.facets.filter(f=>f.region==='crown').map(f=>f.id);
    const open=async()=>{
        const s=await createPresetStudioSession({source:{projectId:'repeat',revision:1,document:original}});
        s.store.start();s.store.api.loadComponent(generatePreset());s.store.onTransform({});await waitPreview(s.store);
        assert.equal(await s.store.apply(),false);
        const dialog=s.store.getState().overlay.dialog;
        assert.equal(dialog.type,'repeated-source');
        assert.deepEqual(dialog.operations.flatMap(o=>o.ids).sort(),[...crown].sort());
        return s;
    };
    let s=await open();
    s.store.resolveRepeatedSource(crown);s.store.closeDialog();await waitPreview(s.store);
    assert.equal(await s.store.apply(),true);await waitPreview(s.store);
    let result=(await s.returnResult()).document;
    assert.equal(result.facets.length,original.facets.length);
    assert.ok(crown.every(id=>!result.facets.some(f=>f.id===id)));
    s.dispose();
    s=await open();
    assert.equal(await s.store.resolveRepeatedSource([]),true);s.store.closeDialog();await waitPreview(s.store);
    result=(await s.returnResult()).document;
    assert.equal(result.facets.length,original.facets.length+crown.length);
    s.dispose();
});
test('the designer sees how component records were recovered from the source facets', async () => {
    const { makeNativeDocument } = await import('../src/adapters/opengemcutting.js');
    const { cubeSolid } = await import('../src/domain/geometry.js');
    const stock = { polys: cubeSolid(2.4), nativeStock: cubeDocument().stock };
    const before = [{ id: 'c', component: generatePreset(), transform: { translation: [0, 0, .045] } }];
    const lifted = makeNativeDocument(stock, null, [{ ...before[0], transform: { translation: [0, 0, -.05] } }]);
    lifted.metadata.componentInstances = makeNativeDocument(stock, null, before).metadata.componentInstances;
    const s = await createPresetStudioSession({ source: { projectId: 'lifted', revision: 1, document: lifted } });
    const notes = s.store.getState().session.sourceNotes;
    assert.equal(s.store.getState().model.groups.length, 1);
    assert.deepEqual(notes.map(n => n.kind), ['info']);
    assert.match(notes[0].text, /整体变换更新位置/);
    s.dispose();
});
