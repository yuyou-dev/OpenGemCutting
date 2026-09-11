import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compatibleNode, run, npmEntry, findCodex, supportsSetup, guardUpgrade, configureCodex, readProduct } from './lifecycle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const action = process.argv[2] ?? 'install';
const appOnly = process.argv.includes('--app-only');
try {
  if (!['install', 'upgrade', 'doctor'].includes(action) || process.argv.slice(3).some(arg => arg !== '--app-only'))
    throw new Error('Usage: node setup/cli.mjs install|upgrade|doctor [--app-only]');
  if (!compatibleNode(process.versions.node)) throw new Error('Unsupported Node version. Use setup/bootstrap.sh or setup/bootstrap.ps1.');
  const product = readProduct(root);
  if (action === 'upgrade') {
    guardUpgrade(root);
    run('git', ['pull', '--ff-only'], { cwd: root });
    // Reload lifecycle code from the updated release before installing it.
    run(process.execPath, [fileURLToPath(import.meta.url), 'install', ...(appOnly ? ['--app-only'] : [])], { cwd: root });
  } else if (action === 'doctor') {
    if (!appOnly) run(process.execPath, ['mcp/doctor.mjs'], { cwd: root });
    else run(process.execPath, [npmEntry(), 'run', 'build'], { cwd: root });
  } else {
    const npm = (args) => run(process.execPath, [npmEntry(), ...args], { cwd: root });
    npm(['ci']);
    npm(['run', 'build']);
    if (appOnly) console.log('单机版已构建。请启动 npm run preview，并打开实际打印的本机地址；无需 Codex 或 MCP。');
    else {
      npm(['ci', '--prefix', 'mcp']);
      run(process.execPath, ['mcp/doctor.mjs'], { cwd: root });
      let codex = findCodex(root);
      if (!supportsSetup(codex)) {
        npm(['install', '--prefix', '.runtime/codex-cli', '--no-save', '--no-package-lock', '@openai/codex@0.153.4']);
        codex = findCodex(root, { localOnly: true });
      }
      if (!supportsSetup(codex)) throw new Error('Codex CLI setup capabilities are unavailable after installation.');
      console.log(JSON.stringify({ product: product.name, ...configureCodex(root, codex, product) }));
      console.log('安装配置已完成。接下来由 Codex 调用 workbench_open，在内置浏览器打开返回链接，再读取对应页面确认连接。若当前任务尚未加载工具，请刷新或新开本项目任务，发送“打开工作台，开始对话设计”。连接成功后即可直接描述切割需求。');
    }
  }
} catch (error) {
  console.error(`配置尚未完成：${error.message}`);
  process.exitCode = 1;
}
