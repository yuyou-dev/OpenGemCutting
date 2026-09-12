import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const { terms } = JSON.parse(await readFile(new URL('src/i18n/terminology.json', root), 'utf8'));
const fields = ['id', 'zh', 'en', 'context', 'caution', 'source', 'reviewStatus', 'reviewer', 'suggestion'];
const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const csv = '\uFEFF' + [fields, ...terms.map(term => fields.map(field => term[field]))].map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
await writeFile(new URL('docs/i18n/terminology-review.csv', root), csv);
console.log(`Exported ${terms.length} terminology review rows.`);
