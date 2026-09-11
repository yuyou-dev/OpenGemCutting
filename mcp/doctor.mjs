import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const client = new Client({ name: 'installation-check', version: '1.0.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))], stderr: 'inherit' }));
  const { tools } = await client.listTools();
  for (const name of ['workbench_open', 'workbench_sessions', 'design_read', 'design_plan', 'design_commit'])
    if (!tools.some(tool => tool.name === name)) throw new Error(`Missing tool: ${name}`);
  await client.readResource({ uri: 'facet://guide' });
  await client.readResource({ uri: 'facet://skill' });
  const opened = await client.callTool({ name: 'workbench_open', arguments: {} });
  if (opened.isError) throw new Error('Unable to open MCP host');
  const { url } = opened.structuredContent;
  const response = await fetch(url);
  if (!response.ok || !(await response.text()).includes('<html')) throw new Error('Workbench assets unavailable');
  console.log('MCP protocol, design resources and loopback workbench passed. This check does not verify the user browser connection.');
} finally {
  await client.close();
}
