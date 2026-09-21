import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// This is an install boundary, not a bundle-size check: tree shaking cannot
// remove the umbrella package's unused MCP/Node tools from npm ci.
test('browser optics installs the official core without MCP or native GPU tooling', () => {
  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(lock.packages[''].dependencies['@vgpu/core'], '0.5.0');
  const forbidden = ['vgpu', '@modelcontextprotocol/server', '@modelcontextprotocol/core', '@vgpu/adapter-node', '@vgpu/adapter-mock', 'webgpu'];
  for (const path of Object.keys(lock.packages)) {
    assert.ok(!forbidden.some(name => path.endsWith(`node_modules/${name}`)), `Unexpected browser install dependency: ${path}`);
  }
});
