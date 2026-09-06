import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** New portable attachment archive, or the original download manifest. */
export async function readPresetArchive(root) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return JSON.parse(await readFile(path.join(root, 'download-manifest.json'), 'utf8'))
      .map((row) => ({ ...row, extension: path.extname(row.original_filename).slice(1).toLowerCase(), file: row.target_file,
        eligible: row.status === 'downloaded' }));
  }
  const readme = await readFile(path.join(root, 'README.txt'), 'utf8');
  const openIndex = JSON.parse(await readFile(path.join(root, 'open_index.json'), 'utf8'));
  const openPages = new Map(openIndex.map((row) => [String(row.post_id), row.url]));
  const declaredOpen = readme.includes('Open-design detail pages');
  return manifest.map((row) => {
    const relative = row.canonical_relpath || row.local_relpath;
    const file = path.resolve(root, relative);
    if (!file.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`归档路径越界：${relative}`);
    return {
      ...row,
      file,
      original_filename: path.basename(relative),
      page_url: row.url,
      source_url: row.attachment_url,
      designer: row.spans?.[0] || '',
      source_reference: row.spans?.slice(1).join('; ') || '',
      shape_class: row.shape?.toLowerCase().replaceAll(' ', '-') || 'unknown',
      open_declaration: declaredOpen && openPages.get(String(row.post_id)) === row.url
        ? '归档 README 声明：采集自 FacetDiagrams Open-design 页面；开放索引已匹配，作者与原始来源保留。' : '',
      eligible: true,
    };
  });
}

export function validatePresetProvenance(row, bytes) {
  const issues = [];
  if (sha256(bytes) !== row.sha256) issues.push('HASH_MISMATCH');
  if (!row.designer?.trim() || !row.open_declaration?.trim()
      || !/^https:\/\/facetdiagrams\.org\/diagram\//.test(row.page_url ?? '')
      || !/^https:\/\/facetdiagrams\.org\//.test(row.source_url ?? '')) issues.push('MISSING_PROVENANCE');
  return issues;
}
