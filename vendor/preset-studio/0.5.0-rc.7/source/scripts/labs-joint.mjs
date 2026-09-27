// Real host importer and geometry, supplied explicitly; no local path in the package.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { importNativeDocument } from '../src/domain/io.js';
import { makeNativeDocument, instancePlanes } from '../src/adapters/opengemcutting.js';
import { cutSolid, geometryStats, cubeSolid } from '../src/domain/geometry.js';
import { builtinCatalog, instantiateCatalog } from '../src/domain/catalog.js';
import { compatibleGears } from '../src/domain/machine.js';
const main = process.argv[2];
if (!main) throw Error('Usage: node scripts/labs-joint.mjs <main-project>');
const { readLabDocument } = await import(pathToFileURL(path.resolve(main, 'src/application/labDocuments.js')));
const readHost = d => readLabDocument(d, { profile: 'preset' });
const directory = new URL('../vendor/labs-contract/1.1.0/', import.meta.url);
const read = p => JSON.parse(readFileSync(new URL(p, directory)));
let passed = 0, rejected = 0;
function compare(candidate) {
    const host = readHost(candidate), model = importNativeDocument(host.document, { convexOnly: true });
    const planes = [...model.basePlanes, ...model.groups.flatMap(g => instancePlanes(g.component, g.transform, g.id))];
    const result = geometryStats(cutSolid(model.stock.polys, planes), planes);
    assert.ok(Math.abs(result.volume - host.summary.volumeModelUnits) < 1e-9, `Volume ${result.volume} / ${host.summary.volumeModelUnits}`);
    assert.deepEqual(makeNativeDocument(model.stock, model.nativeDocument, model.groups), host.document);
    passed++;
}
for (const entry of read('MANIFEST.json').samples) {
    const sample = read(entry.file);
    if (sample.reject) { assert.throws(() => readHost(sample.input)); rejected++; }
    else compare(sample.normalized);
}
for (const entry of builtinCatalog()) {
    const component = instantiateCatalog(entry), gears = compatibleGears(component.planes).filter(g => g.teeth <= 360);
    const stock = { polys: cubeSolid(20), convex: true, nativeStock: {kind:'cube',size:20,center:[0,0,0]} };
    const groups = [{ id: `catalog-${entry.id}`, component, transform: {} }];
    if (!gears.length) { assert.throws(() => makeNativeDocument(stock, null, groups)); rejected++; }
    else compare(makeNativeDocument(stock, null, groups, [], { teeth: gears[0].teeth }));
}
console.log(JSON.stringify({ passed, expectedRejections: rejected, total: passed + rejected }));
