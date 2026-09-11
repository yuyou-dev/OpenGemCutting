import { readFile, writeFile } from 'node:fs/promises';
import {
  DESIGN_API_VERSION,
  DESIGN_TOOLS,
} from '../src/application/designContract.js';
const content = `${JSON.stringify({ apiVersion: DESIGN_API_VERSION, tools: DESIGN_TOOLS }, null, 2)}\n`;
const path = new URL('../docs/mcp/capabilities.json', import.meta.url);
if (process.argv.includes('--write')) await writeFile(path, content);
else {
  if ((await readFile(path, 'utf8')) !== content)
    throw new Error('Design API docs are stale. Run npm run design:docs.');
  const controller = await readFile(
    new URL('../src/components/useDesignController.js', import.meta.url),
    'utf8',
  );
  const app = await readFile(
    new URL('../src/App.jsx', import.meta.url),
    'utf8',
  );
  for (const tool of DESIGN_TOOLS)
    if (
      ![controller, app].some((source) =>
        source.includes(`name === '${tool.name}'`),
      )
    )
      throw new Error(`Design tool has no browser route: ${tool.name}`);
  const server = await readFile(
    new URL('../mcp/server.mjs', import.meta.url),
    'utf8',
  );
  if (!server.includes('DESIGN_TOOLS.map'))
    throw new Error('MCP must register the shared contract.');
  console.log(
    `Design API ${DESIGN_API_VERSION}: ${DESIGN_TOOLS.length} tools, browser routes and generated docs agree.`,
  );
}

// The optional Node server must never become a dependency of the static browser app.
const { readdir } = await import('node:fs/promises');
async function verifyBrowserBoundary(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = new URL(
      entry.name + (entry.isDirectory() ? '/' : ''),
      directory,
    );
    if (entry.isDirectory()) await verifyBrowserBoundary(file);
    else if (/\.(js|jsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      const source = await readFile(file, 'utf8');
      const imports = [
        ...source.matchAll(/(?:from\s*|import\s*\()(['"])([^'"]+)\1/g),
      ].map((match) => match[2]);
      if (
        imports.some(
          (specifier) =>
            specifier.startsWith('node:') ||
            /(^|\/)mcp\//.test(specifier) ||
            specifier.startsWith('@modelcontextprotocol/'),
        )
      )
        throw new Error(
          `Static app imports optional server code: ${file.pathname}`,
        );
    }
  }
}
await verifyBrowserBoundary(new URL('../src/', import.meta.url));
