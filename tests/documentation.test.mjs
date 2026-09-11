import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkLinks, anchors } from '../scripts/check-docs.mjs';

test('document links catch missing files and retired anchors without following examples or external links', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gem-docs-'));
  try {
    await writeFile(path.join(root, 'README.md'), '# 入门\n[good](guide.md#开始)\n[old](guide.md#旧入口)\n[missing](absent.md)\n[external](https://example.com)\n```md\n[example](example.md)\n```\n');
    await writeFile(path.join(root, 'guide.md'), '# 开始\n');
    const result = await checkLinks(root);
    assert.equal(result.issues.length, 2);
    assert.ok(result.issues.some(item => item.includes('旧入口')));
    assert.ok(result.issues.some(item => item.includes('absent.md')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('anchors preserve Chinese and explicit ids, and disambiguate repeated headings', () => {
  const ids = anchors('# 开始\n# 开始\n<a id="install"></a>\n');
  assert.ok(ids.has('开始')); assert.ok(ids.has('开始-1')); assert.ok(ids.has('install'));
});
