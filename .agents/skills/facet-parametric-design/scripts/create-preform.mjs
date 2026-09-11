import fs from 'node:fs/promises';
import path from 'node:path';
import { extrudeStock } from '../../../../src/domain/stockPresets.js';
import { inspectCrystalOBJ } from '../../../../src/domain/stockGeometry.js';
import { exportFacetingJSON } from '../../../../src/domain/faceting.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node create-preform.mjs profile.json new-output-directory');
const profileText = await fs.readFile(input, 'utf8');
const profile = JSON.parse(profileText);
if (!Number.isFinite(profile.height) || profile.height <= 0) throw new Error('profile.height must be positive.');
const mesh = extrudeStock(profile.outer, profile.holes ?? [], profile.height);
const obj = ['# Custom extruded preform; +Z up; units declared in profile.json',
  ...mesh.vertices.map(p => `v ${p.x} ${p.y} ${p.z}`),
  ...mesh.faces.map(face => `f ${face.map(i => i + 1).join(' ')}`), ''].join('\n');
// Follow the actual external OBJ gate, including the 1000-patch budget.
const { document, summary } = inspectCrystalOBJ(obj, { fileName: `${profile.name ?? '自定义底胚'}.obj`, unit: profile.unit ?? 'unitless', upAxis: 'z' });
await fs.mkdir(output); // New directory only: preserve earlier preforms.
await fs.writeFile(path.join(output, 'profile.json'), profileText);
await fs.writeFile(path.join(output, 'preform.obj'), obj);
await fs.writeFile(path.join(output, 'preform.json'), exportFacetingJSON(document));
console.log(JSON.stringify({ ...summary, cutCount: document.facets.length, output }, null, 2));
