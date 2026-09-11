import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('published MCP resource URIs remain readable after documentation moves', async () => {
  const client = new Client({ name: 'documentation-regression', version: '1.0.0' });
  try {
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../server.mjs', import.meta.url))],
      stderr: 'inherit',
    }));
    const { resources } = await client.listResources();
    for (const uri of ['facet://guide', 'facet://architecture', 'facet://examples', 'facet://state', 'facet://skill', 'facet://capabilities'])
      assert.ok(resources.some(resource => resource.uri === uri), `Missing public resource: ${uri}`);
    for (const { uri } of resources) {
      const { contents } = await client.readResource({ uri });
      assert.equal(contents[0].uri, uri);
      assert.ok(contents[0].text.trim().length > 0, `Empty resource: ${uri}`);
      if (uri === 'facet://state')
        assert.equal(contents[0].text, await readFile(new URL('../../docs/architecture/state-contract.md', import.meta.url), 'utf8'));
    }
  } finally { await client.close(); }
});
