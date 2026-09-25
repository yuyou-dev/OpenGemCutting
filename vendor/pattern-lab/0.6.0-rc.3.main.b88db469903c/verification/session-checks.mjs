import assert from 'node:assert/strict';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const source = document => ({ projectId: 'package-source', revision: 'revision-7', document });

// Runs against both the source API and the extracted distribution API.
export async function checkSessionBoundaries({ createLabSession, moduleInfo }, document) {
  const passed = [];
  const check = async (name, run) => { await run(); passed.push(name); };
  await check('cancel pending host load without late saves', async () => {
    const gate = deferred(), abort = new AbortController(); let writes = 0, context;
    const loading = createLabSession({ source: source(document), signal: abort.signal,
      persistence: { load: value => { context = value; return gate.promise; }, save: () => writes++ } });
    abort.abort(); await assert.rejects(loading, { name: 'AbortError' });
    assert.equal(context.signal.aborted, true); gate.resolve(null); await Promise.resolve(); assert.equal(writes, 0);
  });
  await check('return waits for edits queued during an earlier save', async () => {
    const gates = [deferred(), deferred()], started = [deferred(), deferred()]; let count = 0, returned = 0;
    const session = await createLabSession({ source: source(document), persistence: {
      save: async draft => { const index = count++; started[index].resolve(draft); await gates[index].promise; },
    }, onResult: () => returned++ });
    try {
      await started[0].promise;
      const returning = session.returnResult();
      session.controller.renamePlan('saved after the first request');
      gates[0].resolve(); const finalDraft = await started[1].promise;
      await Promise.resolve(); assert.equal(returned, 0);
      gates[1].resolve(); const result = await returning;
      assert.equal(result.document.name, finalDraft.plan.name); assert.equal(returned, 1);
    } finally { session.dispose(); }
  });
  await check('host cannot mutate the origin through drafts or returned values', async () => {
    const origin = source(document), before = structuredClone(origin);
    const session = await createLabSession({ source: origin, persistence: { save: draft => {
      draft.source.revision = 'host-mutated'; draft.source.document.name = 'host-mutated'; draft.plan.name = 'host-mutated';
    } } });
    try {
      const result = await session.returnResult(); assert.deepEqual(result.source, before); assert.deepEqual(origin, before);
      result.source.revision = 'caller-mutated'; assert.deepEqual((await session.returnResult()).source, before);
    } finally { session.dispose(); }
  });
  await check('pause cancels an outstanding return, resume does not revive it', async () => {
    const gate = deferred(); let callbacks = 0;
    const session = await createLabSession({ source: source(document), persistence: { save: () => gate.promise }, onResult: () => callbacks++ });
    const returning = session.returnResult(); session.pause(); session.resume(); gate.resolve();
    assert.equal(await returning, undefined); assert.equal(callbacks, 0);
    assert.ok(await session.returnResult()); assert.equal(callbacks, 1); session.dispose();
  });
  await check('dispose aborts callback context and suppresses late return', async () => {
    const entered = deferred(), gate = deferred(); let context;
    const session = await createLabSession({ source: source(document), onResult: (_, value) => {
      context = value; entered.resolve(); return gate.promise;
    } });
    const returning = session.returnResult(); await entered.promise; session.dispose();
    assert.equal(context.signal.aborted, true); assert.equal(await returning, undefined); gate.resolve();
  });
  await check('pause aborts a candidate callback that is already waiting on host I/O', async () => {
    const entered = deferred(), gate = deferred(); let context;
    const session = await createLabSession({ source: source(document), onResult: (_, value) => {
      context = value; entered.resolve(); return gate.promise;
    } });
    const returning = session.returnResult(); await entered.promise; session.pause(); session.resume();
    assert.equal(context.signal.aborted, true); assert.equal(await returning, undefined); gate.resolve(); session.dispose();
  });
  await check('failed persistence blocks candidates and a later successful save recovers', async () => {
    let fail = true, callbacks = 0;
    const session = await createLabSession({ source: source(document), persistence: { save: async () => { if (fail) throw new Error('quota'); } }, onResult: () => callbacks++ });
    try {
      await assert.rejects(session.returnResult(), /quota/); assert.equal(callbacks, 0);
      assert.match(session.controller.getSnapshot().saveStatus, /保存失败/);
      fail = false; session.controller.renamePlan('retry saved');
      assert.equal((await session.returnResult()).document.name, 'retry saved'); assert.equal(callbacks, 1);
    } finally { session.dispose(); }
  });
  let saved;
  const first = await createLabSession({ source: source(document), persistence: { save: draft => { saved = draft; } } });
  await first.returnResult(); first.dispose();
  await check('accepted phase-one draft resumes without changing source geometry', async () => {
    const legacy = structuredClone(saved); legacy.moduleVersion = '0.5.1-alpha'; const untouched = structuredClone(legacy);
    let upgraded;
    const session = await createLabSession({ source: source(document), persistence: { load: () => legacy, save: draft => { upgraded = draft; } } });
    try {
      const result = await session.returnResult(); assert.deepEqual(result.document.facets, document.facets);
      assert.equal(upgraded.moduleVersion, moduleInfo.moduleVersion); assert.deepEqual(legacy, untouched);
    } finally { session.dispose(); }
  });
  for (const [label, patch] of [['foreign lab', { labId: 'different-lab' }], ['future module', { moduleVersion: '999.0.0' }],
    ['future contract', { contractVersion: '999.0.0' }], ['source revision conflict', { source: { ...saved.source, revision: 'revision-8' } }]]) {
    await check(`refuse ${label} without overwriting stored data`, async () => {
      const draft = { ...structuredClone(saved), ...patch }, before = structuredClone(draft); let saves = 0;
      await assert.rejects(createLabSession({ source: source(document), persistence: { load: () => draft, save: () => saves++ } }), /版本|修订/);
      assert.equal(saves, 0); assert.deepEqual(draft, before);
    });
  }
  return passed;
}
