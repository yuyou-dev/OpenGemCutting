// Compatibility CLI. Geometry and support policy live in application/domain.
// Usage: node meet-audit.mjs design.json [--json] [--brilliant]
// --brilliant is accepted for old callers; measurements are advisory in every family.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = process.env.FACET_REPO ? pathToFileURL(path.resolve(process.env.FACET_REPO) + path.sep) : new URL('../../../../', import.meta.url);
const { importFacetingJSON } = await import(new URL('src/domain/faceting.js', repo));
const { inspectMeetpoints } = await import(new URL('src/application/meetInspection.js', repo));
const file = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!file) throw new Error('usage: node meet-audit.mjs design.json [--json]');
const result = inspectMeetpoints(importFacetingJSON(await fs.readFile(file, 'utf8')));
console.log(JSON.stringify(result, null, 2));
// Unsupported is distinct from a clean audit; candidates never block delivery.
process.exitCode = result.status === 'unsupported' ? 2 : 0;
