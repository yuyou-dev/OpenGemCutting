import assert from 'node:assert/strict';
import test from 'node:test';
import { createLabHost, labSourceState, mountLaboratory } from './labHost.js';
import { createLabDraftStore } from '../domain/labDrafts.js';
import { createProjectStore } from '../domain/projectLibrary.js';
import { createLabContractSamples } from './labContractSamples.js';
import { readLabDocument } from './labDocuments.js';
import { secondLaboratory } from '../../tests/fixtures/labs/probe.mjs';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
const moduleLock = JSON.parse(await readFile(new URL('./labsModuleLock.json', import.meta.url)));
const { createLabSession, moduleInfo } = await import(new URL(`../../${moduleLock.directory}/index.js`, import.meta.url));

const lab={id:'pattern',moduleId:moduleInfo.id,moduleVersion:moduleInfo.moduleVersion,contractVersion:moduleInfo.contractVersion};
const samples = new Map(createLabContractSamples().map(s=>[s.id,s.document]));
function memoryStorage() {
  const map=new Map();return {map,get length(){return map.size;},key:i=>[...map.keys()][i]??null,
    getItem:k=>map.get(k)??null,setItem(k,v){if(this.fail?.(k,v))throw new Error('simulated storage full');map.set(k,v);},removeItem:k=>map.delete(k)};
}
function fixture(sourceId) {
  const storage=memoryStorage(),projects=createProjectStore(storage),drafts=createLabDraftStore(storage),lifetime=new AbortController();
  const original=sourceId?projects.create(samples.get(sourceId),{id:'source'}):null;
  const source=original?{projectId:original.id,revision:original.revision,document:readLabDocument(original.document).document}:null;
  const record=drafts.create({labId:lab.id,moduleVersion:lab.moduleVersion,contractVersion:lab.contractVersion,
    ...(source?{source}:{newDesign:{teeth:99,symmetry:9,density:1,sizeMm:13,name:'Independent'}})});
  const host=createLabHost({record,lab,drafts,readProject:projects.read,createProject:projects.create,signal:lifetime.signal});
  return {storage,projects,drafts,lifetime,record,host,source,original};
}
const payload=f=>({labId:lab.moduleId,moduleVersion:lab.moduleVersion,contractVersion:lab.contractVersion,source:f.source,plan:{name:'opaque',edited:1}});
const candidate=f=>({moduleVersion:lab.moduleVersion,contractVersion:lab.contractVersion,source:f.source,
  document:f.source?.document??samples.get('99-ninefold'),diagnostics:{warnings:[]}});

for (const source of [null,'fixed-reference','surface-scale-source']) test(`real native session to host project: ${source??'new'}`,async()=>{
  const f=fixture(source),snapshot=structuredClone(f.original),s=await createLabSession(f.host.options);
  try {
    const before=readLabDocument((await s.returnResult()).document).document;
    await f.host.dismissCandidate();
    const c=s.controller;c.setDirectionMode('exact');c.setEditSettings({mode:'topology',lockOutline:false});
    c.selectEditTarget({kind:'face',key:source?'table:120':'C1:0'});
    assert.equal(await c.moveSelectionBy(.0001*c.getSnapshot().compiled.audit.mmPerUnit,0),true);
    await s.returnResult();
    const checked=f.host.state().record.candidate;
    assert.notDeepEqual(checked.document.facets,before.facets);
    const [a,b]=await Promise.all([f.host.accept({name:'Returned'}),f.host.accept({name:'duplicate'})]);
    assert.equal(a.id,b.id);assert.equal(a.document.name,'Returned');
    assert.equal(f.projects.list().records.length,source?2:1);
    assert.deepEqual(a.document.facets,checked.document.facets);assert.deepEqual(a.document.stock,checked.document.stock);
    assert.deepEqual(a.document.cuttingReference,checked.document.cuttingReference);
    assert.equal(a.document.metadata.labReturn.experimentId,f.record.id);
    if(source)assert.deepEqual(f.projects.read('source'),snapshot);
    assert.equal(f.drafts.read(f.record.id).returns.length,1);
  }finally{s.dispose();}
});

test('failed draft save retains the last good draft and full recovery; retry persists newest plan',async()=>{
 const f=fixture();await f.host.options.persistence.save(payload(f));const good=f.drafts.raw(f.record.id);
 f.storage.fail=k=>k.startsWith('facet96:experiment:');const newer={...payload(f),plan:{edited:2}};
 await assert.rejects(f.host.options.persistence.save(newer),/storage full/);assert.equal(f.drafts.raw(f.record.id),good);
 assert.deepEqual(f.host.recovery().pendingDraft,newer);assert.equal(f.host.hasUnsaved(),true);
 f.storage.fail=null;await f.host.retrySave();assert.deepEqual(f.drafts.read(f.record.id).draft,newer);assert.equal(f.host.hasUnsaved(),false);
});

test('two open sessions conflict without overwriting or losing recovery',async()=>{
 const f=fixture(),other=createLabHost({record:f.record,lab,drafts:f.drafts,readProject:f.projects.read,createProject:f.projects.create,signal:new AbortController().signal});
 await f.host.options.persistence.save(payload(f));const good=f.drafts.raw(f.record.id);
 await assert.rejects(other.options.persistence.save({...payload(f),plan:{second:true}}),{code:'DRAFT_CONFLICT'});
 assert.equal(f.drafts.raw(f.record.id),good);assert.deepEqual(other.recovery().pendingDraft.plan,{second:true});
});

test('source change after review requires recheck; accepts as new and preserves newer source',async()=>{
 const f=fixture('fixed-reference');await f.host.options.onResult(candidate(f));const state=f.host.state().sourceState;
 await f.projects.save('source',{...f.original.document,name:'newer source'},{expectedRevision:1});
 const newer=f.projects.read('source');await assert.rejects(f.host.accept({expectedSourceState:state}),{code:'SOURCE_CHANGED'});
 const returned=await f.host.accept({expectedSourceState:f.host.state().sourceState});
 assert.deepEqual(f.projects.read('source'),newer);assert.equal(returned.document.metadata.labReturn.source.revision,1);
 assert.equal(returned.document.metadata.labReturn.sourceState.status,'changed');
 assert.equal(labSourceState(f.source,()=>null).status,'missing');assert.equal(labSourceState(f.source,()=>{throw new Error();}).status,'unreadable');
});

test('project creation followed by failed receipt is recoverable and idempotent across reload',async()=>{
 const f=fixture();await f.host.options.onResult(candidate(f));
 f.storage.fail=(k,v)=>k.startsWith('facet96:experiment:')&&JSON.parse(v).returns.length>0;
 await assert.rejects(f.host.accept(),/storage full/);assert.equal(f.projects.list().records.length,1);assert.equal(f.drafts.read(f.record.id).returns.length,0);
 f.storage.fail=null;const reload=createLabHost({record:f.drafts.read(f.record.id),lab,drafts:f.drafts,readProject:f.projects.read,createProject:f.projects.create,signal:new AbortController().signal});
 const returned=await reload.accept();assert.equal(f.projects.list().records.length,1);assert.equal(f.drafts.read(f.record.id).returns[0].projectId,returned.id);
});

test('failed new project write leaves persisted candidate intact for retry',async()=>{
 const f=fixture();await f.host.options.onResult(candidate(f));const before=f.drafts.raw(f.record.id);
 f.storage.fail=k=>!k.startsWith('facet96:experiment:');await assert.rejects(f.host.accept(),/storage full/);
 assert.equal(f.drafts.raw(f.record.id),before);assert.equal(f.projects.list().records.length,0);
 f.storage.fail=null;await f.host.accept();assert.equal(f.projects.list().records.length,1);
});

test('lifetime and queued-lock abort prevent stale result, draft and project writes',async()=>{
 const f=fixture();await f.host.options.onResult(candidate(f));const before=[...f.storage.map];f.lifetime.abort();
 await assert.rejects(f.host.options.onResult(candidate(f)),{name:'AbortError'});
 assert.throws(()=>f.host.options.persistence.save(payload(f)),{name:'AbortError'});await assert.rejects(f.host.accept(),{name:'AbortError'});
 assert.deepEqual([...f.storage.map],before);
 let release;const drafts=createLabDraftStore(f.storage,{locks:{request:(_,fn)=>new Promise((resolve,reject)=>{release=()=>{try{resolve(fn())}catch(e){reject(e)}};})}}),abort=new AbortController();
 const change=drafts.change(f.record.id,()=>({draft:'late'}),{signal:abort.signal});abort.abort();
 release();await assert.rejects(change,{name:'AbortError'});assert.deepEqual([...f.storage.map],before);
});

test('unsupported critical geometry and mismatched module/source never become candidates',async()=>{
 const f=fixture('fixed-reference'),before=[...f.storage.map];
 for(const id of ['v3-mesh-rejected','v3-concave-rejected','required-extension-rejected'])await assert.rejects(f.host.options.onResult({...candidate(f),document:samples.get(id)}));
 await assert.rejects(f.host.options.onResult({...candidate(f),moduleVersion:'wrong'}),{code:'CANDIDATE_IDENTITY'});
 assert.throws(()=>f.host.options.persistence.save({...payload(f),source:null}),{code:'LAB_IDENTITY'});
 assert.deepEqual([...f.storage.map],before);
});

test('opaque corrupt records remain downloadable and recovery creates an independent record',async()=>{
 const f=fixture();f.storage.setItem('facet96:experiment:v1:corrupt','{"broken":');
 assert.deepEqual(f.drafts.list().unreadable,['corrupt']);assert.equal(f.drafts.raw('corrupt'),'{"broken":');
 const second=f.drafts.create({...f.record,recoveredFrom:f.record.id});assert.notEqual(second.id,f.record.id);assert.equal(f.drafts.read(f.record.id).revision,1);
});

test('second registration shares capability boundary and lifecycle; late mount is disposed',async()=>{
 const f=fixture(),events=[],probe=secondLaboratory(events),element={textContent:''};
 const instance=await mountLaboratory(element,{lab:probe,options:f.host.options});instance.pause();instance.resume();await instance.returnResult();instance.dispose();
 assert.deepEqual(events[1],{capabilities:['newDesign','onResult','persistence','presentation','signal'],persistence:['load','save']});
 assert.deepEqual(events.slice(2),['pause','resume','return','dispose']);assert.equal(element.textContent,'');
 const ac=new AbortController(),late={...probe,async load(){const m=await probe.load();return{...m,async mount(...args){const i=await m.mount(...args);ac.abort();return i;}}}};
 await assert.rejects(mountLaboratory(element,{lab:late,options:{...f.host.options,signal:ac.signal}}),{name:'AbortError'});assert.equal(element.textContent,'');
});

// Earlier deliveries stay private (unlicensed) and exist only in the private checkout.
for (const oldVersion of ['0.6.0-rc.1', '0.6.0-rc.3', '0.6.0-rc.3.main.92ee082cc1e1']) test(`${oldVersion} upgrade retains original recovery record and flush does not return a candidate`, {
 skip: !existsSync(new URL(`../../vendor/pattern-lab/${oldVersion}/index.js`, import.meta.url)) && 'retained private delivery not present',
}, async () => {
 const f=fixture('fixed-reference');
 const old=await import(`../../vendor/pattern-lab/${oldVersion}/index.js`);
 let draft;const prior=await old.createLabSession({source:f.source,persistence:{save:v=>{draft=structuredClone(v);}}});
 prior.controller.setDirectionMode('exact');await prior.returnResult();prior.dispose();
 const original=await f.drafts.change(f.record.id,()=>({moduleVersion:old.moduleInfo.moduleVersion,draft}));
 const host=createLabHost({record:original,lab,drafts:f.drafts,readProject:f.projects.read,createProject:f.projects.create,signal:f.lifetime.signal});
 const next=await createLabSession(host.options);
 try {
  next.controller.setIndexGear(99);next.pause();await next.flush();
  const saved=f.drafts.read(original.id);
  assert.deepEqual(saved.versionBackups,[original]);assert.equal(saved.moduleVersion,moduleInfo.moduleVersion);
  assert.equal(saved.candidate,null);assert.deepEqual(f.projects.read('source'),f.original);
  next.resume();next.controller.setIndexGear(120);await next.flush();
  assert.deepEqual(f.drafts.read(original.id).versionBackups,[original]);
  f.storage.fail=k=>k.startsWith('facet96:experiment:');next.controller.setIndexGear(360);next.pause();
  await assert.rejects(next.flush(),/storage full/);
  assert.equal(host.hasUnsaved(),true);f.storage.fail=null;next.resume();await host.retrySave();
  assert.deepEqual(f.drafts.read(original.id).versionBackups,[original]);
 }finally{next.dispose();}
});
