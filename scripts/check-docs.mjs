import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const excluded = new Set(['.git', 'node_modules', 'dist', 'tmp', 'output', '.runtime']);
export async function markdownFiles(root) {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.name.endsWith('.md')) files.push(file);
    }
  }
  await walk(root);
  return files;
}
const prose = text => text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
export function anchors(markdown) {
  const ids = new Set();
  const counts = new Map();
  for (const match of prose(markdown).matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = match[1].replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').trim().toLowerCase().replace(/ /g, '-');
    const count = counts.get(base) ?? 0;
    ids.add(count ? `${base}-${count}` : base);
    counts.set(base, count + 1);
  }
  for (const match of markdown.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) ids.add(match[1]);
  return ids;
}
export async function checkLinks(root) {
  const issues = [];
  const documents = await markdownFiles(root);
  for (const file of documents) {
    const text = prose(await readFile(file, 'utf8'));
    const links = [...text.matchAll(/\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)].map(m => m[1].replace(/^<|>$/g, ''));
    links.push(...[...text.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)].map(m => m[1]));
    for (const link of links) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(link)) continue;
      const [relative, fragment] = decodeURIComponent(link).split('#');
      const target = relative ? path.resolve(path.dirname(file), relative.split('?')[0]) : file;
      if (!(await stat(target).catch(() => null))) issues.push(`${path.relative(root, file)}: missing ${link}`);
      else if (fragment && target.endsWith('.md') && !anchors(await readFile(target, 'utf8')).has(fragment))
        issues.push(`${path.relative(root, file)}: missing anchor ${link}`);
    }
  }
  return { documents: documents.length, issues };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkLinks(process.cwd());
  if (result.issues.length) { console.error(result.issues.join('\n')); process.exitCode = 1; }
  else console.log(`Documentation links OK: ${result.documents} Markdown files.`);
}
