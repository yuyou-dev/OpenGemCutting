import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(process.argv[2] ?? path.dirname(fileURLToPath(import.meta.url)));
const sha = data => createHash('sha256').update(data).digest('hex');
const read = file => readFile(path.join(root, file), 'utf8');
const manifest = JSON.parse(await read('MANIFEST.json'));
const entries = (await read('SHA256SUMS')).trim().split('\n').map(line => { const [, hash, file] = line.match(/^([a-f0-9]{64})  (.+)$/); return [file, hash]; });
const forbidden = /\/(?:Users|home)\/[^\s"'<>]+|[A-Z]:\\(?:Users|Documents)\\|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|xox[baprs]-[A-Za-z0-9-]{20,}/;
for (const [file, hash] of entries) {
  const bytes = await readFile(path.join(root, file)); assert.equal(sha(bytes), hash, file);
  if (/\.(m?js|json|css|html|md|ts|txt)$/.test(file)) assert.equal(forbidden.test(bytes.toString()), false, `Nonportable path or credential in ${file}`);
}
assert.ok(manifest.resources.workers.length); assert.ok(manifest.resources.fonts.length); assert.ok(manifest.resources.images.length);
assert.equal(manifest.contractVersion, '1.0.0'); assert.deepEqual(manifest.runtimeDependencies, []);
const api = await import(pathToFileURL(path.join(root, 'index.js')));
assert.equal(api.moduleInfo.moduleVersion, manifest.moduleVersion); assert.equal(api.moduleInfo.react, '19.2.0'); assert.equal(api.moduleInfo.entryApiVersion, manifest.entryApiVersion);
const samples = [];
for (const file of (await readdir(path.join(root, 'verification/samples'))).sort()) samples.push(JSON.parse(await read(`verification/samples/${file}`)));
let accepted = 0, rejected = 0;
for (const sample of samples) {
  const source = { projectId: 'fixture', revision: '1', document: sample.input }, before = structuredClone(source);
  if (sample.reject) { await assert.rejects(api.createLabSession({ source })); rejected++; }
  else {
    const session = await api.createLabSession({ source });
    try {
      const { document } = await session.returnResult(); delete document.machining;
      assert.deepEqual(document, sample.normalized); accepted++;
    } finally { session.dispose(); }
  }
  assert.deepEqual(source, before);
}
const generated = [];
for (const [teeth, symmetry] of [[96,8],[99,9],[120,10],[360,12]]) {
  const session = await api.createLabSession({ newDesign: { teeth, symmetry, density: 1 } });
  try {
    const before = await session.returnResult(); session.controller.setIndexGear(teeth === 99 ? 120 : 99);
    const after = await session.returnResult();
    assert.deepEqual(after.document.facets.map(f => f.plane), before.document.facets.map(f => f.plane));
    const again = await api.createLabSession({ source: { projectId: 'generated', revision: 1, document: after.document } });
    try { assert.deepEqual((await again.returnResult()).document, after.document); } finally { again.dispose(); }
    session.controller.undo(); assert.deepEqual((await session.returnResult()).document, before.document); generated.push(teeth);
  } finally { session.dispose(); }
}
const { checkSessionBoundaries } = await import(pathToFileURL(path.join(root, 'verification/session-checks.mjs')));
const fixed = JSON.parse(await read('verification/samples/fixed-reference.json'));
const boundaries = await checkSessionBoundaries(api, fixed.normalized);
const nav = await import(pathToFileURL(path.join(root, 'navigation.js')));
const { checkNavigation, checkScaleWorkflow } = await import(pathToFileURL(path.join(root, 'verification/ux-checks.mjs')));
const navigation = checkNavigation(nav);
const ux = await checkScaleWorkflow(api, JSON.parse(await read('verification/ux/100626-pc-08-024-columbia-willamette.json')));
console.log(JSON.stringify({ navigation, ux: { passed: ux.passed, explicitTestWidthMm: ux.explicitTestWidthMm, sourceUnchanged: ux.sourceUnchanged }, moduleVersion: manifest.moduleVersion, contractVersion: manifest.contractVersion, checkedFiles: entries.length,
  portablePathAndCredentialScan: 'passed', accepted, rejected, generatedWheels: generated, sessionBoundaries: boundaries }, null, 2));
