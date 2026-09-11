import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

export function compatibleNode(version) {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  return (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22;
}

export function run(command, args, { cwd, capture = false, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', shell: false,
    env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}` },
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (!allowFailure && (result.error || result.status !== 0))
    throw new Error(`${path.basename(command)} ${args[0] ?? ''} failed: ${result.error?.message ?? result.stderr ?? result.status}`);
  return result;
}

export function npmEntry(nodePath = process.execPath) {
  const dir = path.dirname(realpathSync(nodePath));
  const candidates = [path.join(dir, 'node_modules/npm/bin/npm-cli.js'), path.resolve(dir, '../lib/node_modules/npm/bin/npm-cli.js')];
  const found = candidates.find(existsSync);
  if (!found) throw new Error('This Node runtime has no npm. Use the project bootstrap to install Node with npm.');
  return found;
}

// Avoid cmd.exe interpolation on Windows. npm-provided Codex shims have a JS entry.
export function findCodex(root, { localOnly = false } = {}) {
  const executable = process.platform === 'win32' ? 'codex.exe' : 'codex';
  for (const dir of (localOnly ? '' : process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const file = path.join(dir, executable);
    if (existsSync(file)) return { command: file, prefix: [] };
    const js = path.join(dir, 'node_modules/@openai/codex/bin/codex.js');
    if (existsSync(js)) return { command: process.execPath, prefix: [js] };
  }
  const js = path.join(root, '.runtime/codex-cli/node_modules/@openai/codex/bin/codex.js');
  return existsSync(js) ? { command: process.execPath, prefix: [js] } : null;
}

export function supportsSetup(codex, invoke = run) {
  if (!codex) return false;
  return [['mcp', '--help'], ['plugin', 'marketplace', '--help']].every(args => {
    const result = invoke(codex.command, [...codex.prefix, ...args], { capture: true, allowFailure: true });
    return !result.error && result.status === 0;
  });
}

export function verifyRegistration(existing, expected) {
  if (!existing) return false;
  const transport = existing.transport;
  if (transport?.type !== 'stdio' || path.resolve(transport.args?.[0] ?? '.') !== expected.entry)
    throw new Error(`MCP name ${expected.name} already belongs to another installation. Keep it; choose the intended workspace before changing its registration.`);
  return existing.enabled !== false && transport.command === expected.node;
}

export function guardUpgrade(root, invoke = run) {
  const status = invoke('git', ['status', '--porcelain'], { cwd: root, capture: true }).stdout.trim();
  if (status) throw new Error('Local changes exist. Upgrade stopped; no design or source was discarded.');
  const upstream = invoke('git', ['rev-parse', '--abbrev-ref', '@{upstream}'], { cwd: root, capture: true }).stdout.trim();
  if (!upstream) throw new Error('No tracked release branch. Choose the intended release before upgrading.');
  return upstream;
}

export function configureCodex(root, codex, product, invoke = run) {
  const call = (args, options = {}) => invoke(codex.command, [...codex.prefix, ...args], { cwd: root, ...options });
  const entry = path.join(root, 'mcp/server.mjs');
  const registrations = JSON.parse(call(['mcp', 'list', '--json'], { capture: true }).stdout);
  const existing = registrations.find(item => item.name === product.service);
  const registered = verifyRegistration(existing, { name: product.service, entry, node: process.execPath });
  const marketplaces = JSON.parse(call(['plugin', 'marketplace', 'list', '--json'], { capture: true }).stdout).marketplaces;
  const market = marketplaces.find(item => item.name === product.marketplace);
  if (market && path.resolve(market.root) !== root)
    throw new Error(`Marketplace ${product.marketplace} points to another installation. No marketplace was replaced.`);
  if (!registered) call(['mcp', 'add', product.service, '--', process.execPath, entry]);
  if (!market) call(['plugin', 'marketplace', 'add', root]);
  call(['plugin', 'add', `${product.plugin}@${product.marketplace}`, '--json'], { capture: true });
  const final = JSON.parse(call(['mcp', 'get', product.service, '--json'], { capture: true }).stdout);
  if (!verifyRegistration(final, { name: product.service, entry, node: process.execPath }))
    throw new Error('MCP registration verification failed.');
  return { registration: 'configured', browserConnection: 'not-yet-verified' };
}

export function readProduct(root) {
  return JSON.parse(readFileSync(path.join(root, 'setup/product.json'), 'utf8'));
}
