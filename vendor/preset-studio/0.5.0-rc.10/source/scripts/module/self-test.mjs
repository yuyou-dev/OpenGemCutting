import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('./',import.meta.url);
for(const line of (await readFile(new URL('SHA256SUMS',root),'utf8')).trim().split('\n')) {
    const [hash,file]=line.split('  ');
    assert.equal(createHash('sha256').update(await readFile(new URL(file,root))).digest('hex'),hash,file);
}
const {moduleInfo,createPresetStudioSession}=await import(new URL('index.js',root));
assert.equal(moduleInfo.entryApiVersion,2);
const session=await createPresetStudioSession({newDesign:{teeth:96,sizeMm:10}});
{ const started=(await session.returnResult()).document; assert.equal(started.stock.kind,'cube'); assert.ok(started.facets.length&&started.facets.every(f=>f.patternId==='girdle-preform')); }
await session.flush();session.dispose();session.dispose();
console.log('Fixed package checksums and headless session passed.');
