import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createLabDatabase } from './labDatabase.js';
import { createLabDraftStore } from '../domain/labDrafts.js';
import { createLabHost } from './labHost.js';
const storage=()=>{const m=new Map();return {get length(){return m.size;},key:i=>[...m.keys()][i],getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};};
const input={labId:'pattern',moduleVersion:'1',contractVersion:'1',newDesign:{name:'base'},draft:{plan:{value:'base'}}};
const fixture=()=>{const indexedDB=new IDBFactory(),legacyStorage=storage();const make=()=>createLabDatabase({indexedDB,legacyStorage});return{indexedDB,legacyStorage,make,db:make()};};

test('experiment transactions admit exactly one of twelve stale writers, even without Web Locks',async()=>{
 const f=fixture();await f.db.create(input,{id:'same'});
 const outcomes=await Promise.allSettled(Array.from({length:12},(_,i)=>f.make().change('same',()=>({draft:{plan:{value:i}}}),{expectedRevision:1})));
 assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);
 assert.ok(outcomes.filter(o=>o.status==='rejected').every(o=>o.reason.code==='DRAFT_CONFLICT'));
 const current=await f.db.read('same');assert.equal(current.revision,2);
 assert.deepEqual(current,outcomes.find(o=>o.status==='fulfilled').value);
 await assert.rejects(f.db.change('same',()=>({draft:null})),{code:'DRAFT_CONFLICT'});
});
test('aborted write never reports success or replaces the prior draft; retry is durable',async()=>{
 const f=fixture(),original=await f.db.create(input,{id:'same'}),put=IDBObjectStore.prototype.put;
 try{IDBObjectStore.prototype.put=function(...args){const r=put.apply(this,args);if(this.name==='drafts')r.addEventListener('success',()=>this.transaction.abort());return r;};
 await assert.rejects(f.db.change('same',()=>({draft:null}),{expectedRevision:1}),{code:'LOCAL_WRITE_ABORTED'});
 }finally{IDBObjectStore.prototype.put=put;}
 assert.deepEqual(await f.make().read('same'),original);
 assert.equal((await f.db.change('same',()=>({draft:null}),{expectedRevision:1})).revision,2);
});
test('concurrent migration preserves every opaque payload and old byte once, without double writing',async()=>{
 const f=fixture(),old=createLabDraftStore(f.legacyStorage);old.create(input,{id:'old'});
 const original=await old.change('old',()=>({candidate:{id:'c',projectId:'p'},returns:[{projectId:'p'}],versionBackups:[{draft:'old-format'}],custom:{unknown:true}}),{expectedRevision:1});
 const raw=old.raw('old');const a=await Promise.all([f.db.migrateLegacy(),f.make().migrateLegacy()]);assert.equal(a.reduce((n,r)=>n+r.imported,0),1);
 assert.deepEqual(await f.db.read('old'),original);
 const clone=await f.db.read('old');clone.draft.plan.value='local mutation';assert.deepEqual(await f.db.read('old'),original);
 await f.db.change('old',()=>({draft:null}),{expectedRevision:2});assert.equal(old.raw('old'),raw);
});
test('migration rollback preserves originals and retry imports; changed old version creates one separate copy',async()=>{
 const f=fixture(),old=createLabDraftStore(f.legacyStorage);old.create(input,{id:'old'});const raw=old.raw('old'),put=IDBObjectStore.prototype.put;
 try{IDBObjectStore.prototype.put=function(...args){if(this.name==='meta')throw new DOMException('full','QuotaExceededError');return put.apply(this,args);};await assert.rejects(f.db.migrateLegacy(),{name:'QuotaExceededError'});}finally{IDBObjectStore.prototype.put=put;}
 assert.equal((await f.db.list()).records.length,0);assert.equal(old.raw('old'),raw);await f.db.migrateLegacy();
 const current=await f.db.change('old',()=>({draft:{plan:{value:'new'}}}),{expectedRevision:1});
 await old.change('old',()=>({draft:{plan:{value:'old branch'}}}),{expectedRevision:1});
 const runs=await Promise.all([f.db.migrateLegacy(),f.make().migrateLegacy()]);assert.equal(runs.reduce((n,r)=>n+r.copies,0),1);
 assert.deepEqual(await f.db.read('old'),current);const branch=(await f.db.list()).records.find(r=>r.id!=='old');assert.equal(branch.draft.plan.value,'old branch');assert.equal(branch.legacyCopy,true);
 assert.equal((await f.db.migrateLegacy()).imported,0);
});
test('corrupt legacy records stay downloadable and cancelled creation writes nothing',async()=>{
 const f=fixture();f.legacyStorage.setItem('facet96:experiment:v1:bad','{bad');
 assert.deepEqual((await f.db.migrateLegacy()).unreadable,[{id:'bad',raw:'{bad'}]);
 const abort=new AbortController();abort.abort();await assert.rejects(f.db.create(input,{signal:abort.signal}),{name:'AbortError'});
 assert.equal((await f.db.list()).records.length,0);assert.equal(f.legacyStorage.getItem('facet96:experiment:v1:bad'),'{bad');
});
test('two asynchronous hosts preserve the losing pending payload and recover it as a new record',async()=>{
 const f=fixture(),record=await f.db.create(input),lab={id:'pattern',moduleId:'pattern',moduleVersion:'1',contractVersion:'1'};
 const make=()=>createLabHost({record,lab,drafts:f.make(),readProject:async()=>null,createProject:async()=>null,signal:new AbortController().signal});
 const hosts=[make(),make()];await Promise.all(hosts.map(h=>h.options.persistence.load()));
 const payloads=['A','B'].map(name=>({labId:'pattern',moduleVersion:'1',contractVersion:'1',source:null,plan:{name}}));
 const outcomes=await Promise.allSettled(hosts.map((h,i)=>h.options.persistence.save(payloads[i])));
 const loser=outcomes.findIndex(o=>o.status==='rejected'),winner=1-loser;
 assert.equal(outcomes[loser].reason.code,'DRAFT_CONFLICT');assert.deepEqual((await f.db.read(record.id)).draft,payloads[winner]);
 assert.equal(hosts[loser].hasUnsaved(),true);await assert.rejects(hosts[loser].retrySave(),{code:'DRAFT_CONFLICT'});
 const backup=hosts[loser].recovery();assert.deepEqual(backup.pendingDraft,payloads[loser]);
 const recovered=await f.db.create({...backup.record,draft:backup.pendingDraft,recoveredFrom:backup.record.id});
 assert.notEqual(recovered.id,record.id);assert.deepEqual(recovered.draft,payloads[loser]);assert.equal((await f.db.list()).records.length,2);
});
