import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createProjectDatabase, PROJECT_DATABASE } from './projectDatabase.js';
import { createProjectStore } from '../domain/projectLibrary.js';
import { createLocalRecoveryStore } from '../domain/localRecovery.js';
import { createWorkbenchDocument } from '../domain/document.js';
import { createMeshDocument } from '../domain/stockGeometry.js';
import { createCenteredCube } from '../domain/geometry.js';
import { exportFacetingJSON } from '../domain/faceting.js';
const storage = () => {
  const data = new Map();
  return { get length() { return data.size; }, key: i => [...data.keys()][i] ?? null,
    getItem: key => data.get(key) ?? null, setItem: (key,value) => data.set(key,value), removeItem: key => data.delete(key) };
};
const fixture = () => {
  const indexedDB = new IDBFactory(), legacyStorage = storage();
  const make = () => createProjectDatabase({ indexedDB, legacyStorage });
  return { indexedDB, legacyStorage, make, db: make() };
};
const design = name => createWorkbenchDocument(name);
const req = request => new Promise((resolve,reject) => { request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error); });

// These tests use the real asynchronous IDB request/transaction interfaces. The
// browser regression additionally checks independent renderer connections.
test('concurrent transactions from separate connections accept one revision and reject every stale writer', async () => {
  const f=fixture(); await f.db.create(design('start'),{id:'shared'});
  const peers=Array.from({length:12},()=>f.make());
  const outcomes=await Promise.allSettled(peers.map((peer,i)=>peer.save('shared',design(`writer ${i}`),{expectedRevision:1})));
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  assert.ok(outcomes.filter(r=>r.status==='rejected').every(r=>r.reason.code==='PROJECT_CONFLICT'));
  const current=await f.make().read('shared');assert.equal(current.revision,2);
  assert.equal(current.document.name,outcomes.find(r=>r.status==='fulfilled').value.document.name);
  await assert.rejects(f.db.save('shared',design('missing baseline')), {code:'PROJECT_CONFLICT'});
  for(const peer of peers)await peer.close();await f.db.close();
});

test('save completes only after commit; abort rolls back the project and reports failure', async () => {
  const f=fixture();const old=await f.db.create(design('old'),{id:'protected'});
  const put=IDBObjectStore.prototype.put;
  try {
    IDBObjectStore.prototype.put=function(value,...args){const request=put.call(this,value,...args);if(this.name==='projects')request.addEventListener('success',()=>this.transaction.abort());return request;};
    await assert.rejects(f.db.save('protected',design('not durable'),{expectedRevision:1}), {code:'LOCAL_WRITE_ABORTED'});
  } finally { IDBObjectStore.prototype.put=put; }
  assert.deepEqual(await f.make().read('protected'),old);
  assert.equal((await f.db.save('protected',design('retry'),{expectedRevision:1})).revision,2);
});

test('legacy projects and recovery migrate once, preserve bytes, revisions, mesh geometry and caller isolation', async () => {
  const f=fixture();const legacy=createProjectStore(f.legacyStorage);
  const document=createMeshDocument({mesh:createCenteredCube(3),name:'mesh'});
  const original=legacy.create(document,{id:'mesh',now:100});
  createLocalRecoveryStore(f.legacyStorage).save('backup',design('backup'),50);
  const raw=f.legacyStorage.getItem('facet96:project:v1:mesh');
  const [a,b]=await Promise.all([f.db.migrateLegacy(),f.make().migrateLegacy()]);
  assert.equal(a.imported+b.imported,2);
  const migrated=await f.db.read('mesh');assert.deepEqual(migrated,original);
  migrated.document.name='caller mutation';
  assert.equal(exportFacetingJSON((await f.db.read('mesh')).document),exportFacetingJSON(original.document));
  assert.equal((await f.db.read('legacy-backup')).createdAt,50);
  await f.db.save('mesh',{...document,name:'new version'},{expectedRevision:1});
  assert.equal(f.legacyStorage.getItem('facet96:project:v1:mesh'),raw,'new writes never mirror into legacy storage');
  await f.db.remove('mesh');await f.db.remove('legacy-backup');
  assert.equal((await f.make().migrateLegacy()).imported,0);
  assert.equal((await f.db.list()).records.length,0,'deletion must not resurrect imported records');
  assert.equal(await f.db.needsStarterProjects(),false);
});

test('migration interruption atomically rolls back records and receipts, leaving legacy bytes available for retry', async () => {
  const f=fixture();createProjectStore(f.legacyStorage).create(design('legacy'),{id:'old'});
  const raw=f.legacyStorage.getItem('facet96:project:v1:old');
  const put=IDBObjectStore.prototype.put;
  try {
    IDBObjectStore.prototype.put=function(...args){if(this.name==='meta')throw new DOMException('full','QuotaExceededError');return put.apply(this,args);};
    await assert.rejects(f.db.migrateLegacy(), {name:'QuotaExceededError'});
  } finally { IDBObjectStore.prototype.put=put; }
  assert.equal((await f.db.list()).records.length,0);
  assert.equal(f.legacyStorage.getItem('facet96:project:v1:old'),raw);
  assert.equal((await f.make().migrateLegacy()).imported,1);
  assert.equal((await f.db.migrateLegacy()).imported,0);
});

test('an old version updating after migration becomes one independent copy, never an overwrite', async () => {
  const f=fixture(),legacy=createProjectStore(f.legacyStorage);legacy.create(design('original'),{id:'old'});
  await f.db.migrateLegacy();await f.db.save('old',design('new branch'),{expectedRevision:1});
  legacy.save('old',design('old branch'),{expectedRevision:1});
  const [a,b]=await Promise.all([f.db.migrateLegacy(),f.make().migrateLegacy()]);
  assert.equal(a.copies+b.copies,1);
  const records=(await f.db.list()).records;
  assert.equal(records.length,2);assert.equal((await f.db.read('old')).document.name,'new branch');
  const copy=records.find(r=>r.id!=='old');assert.equal(copy.document.name,'old branch（旧版更新副本）');
  await f.db.remove(copy.id);await f.db.migrateLegacy();assert.equal((await f.db.list()).records.length,1);
});

test('corrupt legacy bytes are kept and block starter insertion; repairing them permits migration', async () => {
  const f=fixture();const key='facet96:project:v1:bad';f.legacyStorage.setItem(key,'{');
  assert.equal((await f.db.migrateLegacy()).unreadableCount,1);
  await f.db.seedStarterProjects([design('starter')]);assert.equal((await f.db.list()).records.length,0);
  assert.equal(f.legacyStorage.getItem(key),'{');
  const other=storage();createProjectStore(other).create(design('repaired'),{id:'bad'});
  f.legacyStorage.setItem(key,other.getItem(key));assert.equal((await f.db.migrateLegacy()).imported,1);
});

test('legacy migration markers and deleted starter markers remain effective', async () => {
  const f=fixture();const legacy=createProjectStore(f.legacyStorage);createLocalRecoveryStore(f.legacyStorage).save('deleted',design('old'));
  legacy.migrateLegacy();legacy.remove('legacy-deleted');
  assert.equal((await f.db.migrateLegacy()).imported,0);
  await f.db.seedStarterProjects([design('starter')]);assert.equal((await f.db.list()).records.length,0);
});

test('simultaneous first launches seed once; a user-created project wins over a late starter load', async () => {
  const f=fixture();const starters=[design('one'),design('two')];
  await Promise.all([f.db.seedStarterProjects(starters),f.make().seedStarterProjects(starters)]);
  assert.equal((await f.db.list()).records.length,2);
  for(const record of (await f.db.list()).records)await f.db.remove(record.id);
  await f.make().seedStarterProjects(starters);assert.equal((await f.db.list()).records.length,0);
  const g=fixture();assert.equal(await g.db.needsStarterProjects(),true);
  await g.db.create(design('mine'));await g.db.seedStarterProjects(starters);assert.equal((await g.db.list()).records.length,1);
});

test('deleted projects cannot be revived by stale saves and duplicate create never replaces data', async () => {
  const f=fixture();await f.db.create(design('original'),{id:'same'});
  await assert.rejects(f.make().create(design('replacement'),{id:'same'}),{code:'PROJECT_EXISTS'});
  await f.db.remove('same');await assert.rejects(f.make().save('same',design('stale'),{expectedRevision:1}),{code:'PROJECT_DELETED'});
});

test('cancellation and stale async creation abort before commit; unavailable storage never falls back to localStorage', async () => {
  const f=fixture(),controller=new AbortController();controller.abort();
  await assert.rejects(f.db.create(design('cancelled'),{signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(f.db.create(design('stale'),{assertCurrent(){throw Error('stale');}}),/stale/);
  assert.equal((await f.db.list()).records.length,0);
  const unavailable=createProjectDatabase({indexedDB:null,legacyStorage:f.legacyStorage});
  await assert.rejects(unavailable.create(design('not written')), {code:'LOCAL_STORAGE_UNAVAILABLE'});
  assert.equal(f.legacyStorage.length,0);
});

test('external database corruption invalidates cached bytes and is counted without deletion',async()=>{
  const f=fixture();await f.db.create(design('safe'),{id:'bad'});await f.db.read('bad');
  const db=await req(f.indexedDB.open(PROJECT_DATABASE,1));
  const tx=db.transaction('projects','readwrite');tx.objectStore('projects').put({id:'bad',raw:'{'});await new Promise(r=>tx.oncomplete=r);
  await assert.rejects(f.db.read('bad'));assert.equal((await f.db.list()).unreadableCount,1);
  assert.equal((await req(db.transaction('projects').objectStore('projects').get('bad'))).raw,'{');db.close();
});


test('an interrupted old recovery migration with an existing project does not import the backup twice', async () => {
  const f=fixture();createLocalRecoveryStore(f.legacyStorage).save('old',design('backup'));
  createProjectStore(f.legacyStorage).create(design('already migrated'),{id:'legacy-old'});
  assert.equal((await f.db.migrateLegacy()).imported,1);
  assert.equal((await f.db.list()).records.length,1);
  assert.equal((await f.db.read('legacy-old')).document.name,'already migrated');
});


test('failed deletion leaves the durable project available', async () => {
  const f=fixture();const original=await f.db.create(design('keep'),{id:'keep'});
  const remove=IDBObjectStore.prototype.delete;
  try {
    IDBObjectStore.prototype.delete=function(...args){const request=remove.apply(this,args);request.addEventListener('success',()=>this.transaction.abort());return request;};
    await assert.rejects(f.db.remove('keep'),{code:'LOCAL_WRITE_ABORTED'});
  } finally { IDBObjectStore.prototype.delete=remove; }
  assert.deepEqual(await f.make().read('keep'),original);
});

test('creation rechecks request identity after an asynchronous database read', async () => {
  const f=fixture();let current=true;
  const get=IDBObjectStore.prototype.get;
  try {
    IDBObjectStore.prototype.get=function(...args){const request=get.apply(this,args);if(this.name==='projects')request.addEventListener('success',()=>{current=false;});return request;};
    await assert.rejects(f.db.create(design('expired'),{id:'late',assertCurrent(){if(!current)throw Object.assign(Error('expired'),{code:'STALE_REVISION'});}}),{code:'STALE_REVISION'});
  } finally { IDBObjectStore.prototype.get=get; }
  assert.equal(await f.db.read('late'),null);
});
