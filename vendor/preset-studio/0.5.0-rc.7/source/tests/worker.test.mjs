import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { cubeSolid, generatePreset, instancePlanes, geometryStats, cutSolid } from '../src/index.js';
import { ringSolid, halfPlane } from './fixtures.mjs';
/** Executes the same src/worker.js protocol under Node, not a browser Worker claim. */
async function runJob(job) { const entry = new URL('../src/worker.js', import.meta.url).href, script = `const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:m=>parentPort.postMessage(m)};import(${JSON.stringify(entry)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({ready:true});});`, w = new Worker(script, { eval: true }); return new Promise((resolve, reject) => { const timer = setTimeout(() => { w.terminate(); reject(Error('timeout')); }, 10000); w.on('error', reject); w.on('message', m => { if (m.ready)
    w.postMessage(job);
else {
    clearTimeout(timer);
    w.terminate();
    resolve(m);
} }); }); }
test('Worker request version and convex result match synchronous core', async () => { const stock = cubeSolid(3), planes = instancePlanes(generatePreset()), r = await runJob({ version: 42, stock, planes, convex: true }); assert.equal(r.version, 42); assert.equal(r.error, undefined); assert.ok(Math.abs(r.stats.volume - geometryStats(cutSolid(stock, planes)).volume) < 1e-8); });
test('Worker executes actual nonconvex through-hole intersection', async () => { const r = await runJob({ version: 9, stock: ringSolid(), planes: [halfPlane], convex: false }); assert.equal(r.error, undefined); assert.ok(Math.abs(r.stats.volume - 4) < 1e-7); });
test('Worker errors preserve request revision', async () => { const r = await runJob({ version: 5, stock: cubeSolid(2), planes: [{ n: [0, 0, 0], d: 0 }], convex: true }); assert.equal(r.version, 5); assert.ok(r.error.includes('法线')); });
