import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

export async function verifyPortablePackage(directory) {
  const read = name => readFile(path.join(directory, name), 'utf8');
  for (const line of (await read('SHA256SUMS')).trim().split('\n')) {
    const [hash, name] = line.split('  ');
    assert.equal(createHash('sha256').update(await readFile(path.join(directory, name))).digest('hex'), hash, name);
  }
  const api = await import(pathToFileURL(path.join(directory, 'index.js')));
  const manifest = JSON.parse(await read('MANIFEST.json'));
  assert.equal(api.LAB_CONTRACT_VERSION, manifest.contractVersion);
  for (const entry of manifest.samples) {
    const sample = JSON.parse(await read(entry.file));
    const document = sample.normalized ?? sample.input;
    const inspection = api.inspectLabDocument(document, { profile: manifest.profile });
    assert.equal(inspection.supported, !sample.reject, entry.file);
    if (sample.reject) continue;
    assert.deepEqual(api.indexCompatibilityReport(document), sample.expected.all, entry.file);
    assert.deepEqual(api.indexCompatibilityReport(document, { scope: 'final', effectiveFacetIds: sample.expected.effectiveFacetIds }), sample.expected.final);
    assert.equal(api.millimetersPerModelUnit(document), sample.expected.millimetersPerModelUnit);
    for (const teeth of [96, 99, 120, 360]) {
      const facets = document.facets.map(f => api.facetOnIndexGear(f, teeth));
      assert.deepEqual(facets.map(f => f.plane), document.facets.map(f => f.plane));
    }
  }
  console.log(`Portable contract ${manifest.contractVersion}: checksums and ${manifest.samples.length} samples passed.`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await verifyPortablePackage(path.dirname(fileURLToPath(import.meta.url)));
