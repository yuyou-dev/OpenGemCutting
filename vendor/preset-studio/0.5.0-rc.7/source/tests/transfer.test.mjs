import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readTransferFile, TRANSFER_EXPORTS, transferFilename } from '../src/domain/transfer.js';
import { generatePreset } from '../src/domain/generators.js';
const example = n => new File([fs.readFileSync(new URL('../examples/'+n,import.meta.url))],n);
const jsonFile = (x,n='example.json')=>new File([JSON.stringify(x)],n);
test('component import stages validated local geometry without mutating input',async()=>{
    const c=generatePreset(),copy=structuredClone(c),plan=await readTransferFile(jsonFile(c));
    assert.equal(plan.kind,'component');assert.equal(plan.payload.planes.length,c.planes.length);assert.deepEqual(c,copy);
    assert.match(plan.impact,/不改变原石/);
});
test('custom frozen component is still accepted after removal of single-face editor',async()=>{
    const plan=await readTransferFile(example('crown-custom.json'));assert.equal(plan.payload.family,'custom');assert.ok(plan.payload.planes.length);
});
test('workspaces validated and report their replacement scope',async()=>{
    const plan=await readTransferFile(example('workspace-brilliant.json'));assert.equal(plan.kind,'workspace');assert.equal(plan.payload.machine.teeth,96);assert.match(plan.impact,/替换当前工作区/);
});
test('native document goes through actual importer, not just a kind check',async()=>{
    const plan=await readTransferFile(example('native-brilliant.json'));assert.equal(plan.kind,'native');assert.ok(plan.payload.stock.polys.length);assert.ok(Array.isArray(plan.warnings));
});
test('OBJ nonconvex stock is validated without convex-hull replacement',async()=>{
    const plan=await readTransferFile(example('rough-L-shaped.obj'));assert.equal(plan.kind,'mesh');assert.equal(plan.payload.convex,false);
});
test('removed library files are rejected without mutation',async()=>{
    await assert.rejects(readTransferFile(example('builtin-library-70.json')), /未知 JSON/);
});
test('truncated JSON, empty input and unsupported formats rejected',async()=>{
    await assert.rejects(readTransferFile(new File(['{oops'],'bad.json')));
    await assert.rejects(readTransferFile(new File([],'empty.json')),/为空/);
    await assert.rejects(readTransferFile(new File(['<GemCutStudio/>'],'design.gcs')),/暂不支持/);
});
test('oversize input rejected before file I/O',async()=>{
    let read=false;await assert.rejects(readTransferFile({size:9*1024*1024,name:'large.json',text:()=>{read=true;return '{}'}}),/8 MiB/);assert.equal(read,false);
});
test('unknown JSON and invalid axis data rejected at the import boundary',async()=>{
    await assert.rejects(readTransferFile(jsonFile({kind:'not-supported'})),/未知 JSON/);
    const data=JSON.parse(await example('workspace-brilliant.json').text());data.state.transform.translation[0]=.1;
    await assert.rejects(readTransferFile(jsonFile(data)),/加工轴/);
});
test('all four file outputs have a unified descriptor',()=>{
    assert.deepEqual(TRANSFER_EXPORTS.map(x=>x.id),['workspace','component','native','obj']);
    assert.ok(TRANSFER_EXPORTS.every(x=>x.description&&x.note&&x.filename));
});
test('export filename adds format extension but rejects paths and control characters',()=>{
    assert.equal(transferFilename('测试冠部','component'),'测试冠部.json');assert.equal(transferFilename('final.OBJ','obj'),'final.OBJ');
    for(const s of ['../secret','a/b','C:\\file','<>','\0abc','', 'x'.repeat(161)])assert.throws(()=>transferFilename(s,'workspace'));
});
