# 光学 WebGPU 差异复现

此入口用于比较相同最终切型在 GLSL/WebGL2 与 WGSL/WebGPU 下的输出，不是 GPU 性能测试，也不预设差异来自几何错误。脚本直接导入当前分支的两个正式渲染器，不复制着色器或求解算法；缺少 WebGPU 时明确失败，不用回退画面充当 WebGPU 输出。

## 浏览器安装边界

网页根依赖使用官方 `@vgpu/core@0.5.0`，其安装链为 `@vgpu/core → @vgpu/wgsl → @vgpu/wgsl-std`。不安装 `vgpu` 总包、MCP Server/Core、`@vgpu/adapter-node`、`@vgpu/adapter-mock` 或原生 `webgpu` 包。不能通过只改为 `vgpu/core` 子路径或 tree shaking 达到这个安装边界，因为 npm 仍会安装总包的依赖。

后端通过 core 的 Device、Shader、Buffer 和 Queue 管理 GPU 资源、编译与数据上传；canvas、pipeline 和 bind group 使用原生 WebGPU API。没有裁剪第三方源码、提交预打包副本、修改 npm overrides 或跳过必要依赖。WGSL、采样、相机及材质语义保持一致。`opticsBrowserDependencies.test.js` 检查锁文件边界，`npm ci` 可验证干净安装。

## 固定输入

- 项目：仓库内的 [PC 08.024 Columbia-Willamette](../../public/presets/documents/100626-pc-08-024-columbia-willamette.json)，来源/设计者保持原项目元数据；不另维护一份项目副本。
- 文件 SHA-256：`67d00bd06b7b257d733f8eced22f075e68efa670a1479b441c6551f8ab517ed0`。脚本先验证哈希，避免换用同名不同版本。
- `importFacetingJSON` 读取项目，`buildConstructionStages(project).at(-1).afterSolid` 求得最终实体。凸路径使用 `normalizedOpticsPlanes(solid)`；网格路径显式使用 `normalizedOpticsMesh({ ...solid, kind: 'mesh' })`。**项目原本是凸体；网格转换仅用于复现第二条光学路径，并非声称该项目包含原石网格或几何错误。**
- 相机：yaw `-0.62`、elevation `0.42`（弧度）、zoom `1`、panX `0.12`、panY `-0.05`；传入 focusOffset `0.23`。网格实际构图仍由正式 `opticsMeshFraming` 按 384×384、无检查器遮挡计算，不能用凸体构图替代。
- 材质分别使用正式 `OPTICAL_PRESETS.diamond`（IOR 2.417、色散 0.044、体色 #ffffff、吸收 0）及 `blueSapphire`（IOR 1.766、色散 0.018、体色 #5987f2、吸收 0.08）。通过 `resolveOpticsSettings` 归一化，完整解析结果写入输出 JSON。
- 环境分别为 `studio`、`hearts`；环境旋转 27°，曝光 +0.2 EV，背景 `mist`，maxBounces 8。
- 浏览器视口 900×650，DPR 1；canvas 为 384×384 CSS/输出像素、1 spp。8 组条件：2 几何路径 × 2 材质 × 2 灯光。

## 复跑

在仓库根目录先执行 `npm ci` 和 `npm run dev`，保留服务运行。它只绑定 127.0.0.1，并输出系统分配的端口。第二个终端临时安装截图工具（不修改 package.json/lock，也不下载浏览器）：

```sh
npm install --no-save --package-lock=false puppeteer-core@25.11.0
```

将文末 JavaScript 保存为 `tmp/compare-optics.mjs`，或者自动提取：

```sh
node --input-type=module <<'NODE'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const doc = readFileSync('docs/architecture/optics-webgpu-reproduction.md', 'utf8');
const code = doc.split('```javascript\n')[1].split('\n```')[0];
mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/compare-optics.mjs', code);
NODE
```

设置 `CHROME_BIN` 为系统 Chrome 可执行文件，并将下方端口替换为 `npm run dev` 的实际端口。macOS 示例：

```sh
CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tmp/compare-optics.mjs http://127.0.0.1:PORT/
```

脚本创建独立的浏览器上下文并在结束时释放。也可以设置 `OPTICS_CDP_URL` 连接已有的**专用测试 Chrome**；这种模式只关闭它创建的上下文。不要把 SwiftShader 的软件渲染结果当作硬件 GPU 性能结论。完成后运行 `npm ci` 清除临时截图依赖。

输出均在忽略的 `tmp/optics-comparison/`：项目原文 `project.json`、每组 WebGL/WebGPU PNG、红色标记差异位置的 `*-diff.png` 和 `results.json`。JSON 包含提交号/脏状态、浏览器与适配器信息、项目哈希、所有参数、最大 RGB 通道差、平均绝对通道差、阈值以上像素数量/比例及逐个像素的坐标/RGB。坐标从 PNG 左上角开始；像素任一 RGB 通道的绝对差 **>8** 才计入阈值数量；忽略 alpha，不做容差滤波或边缘剔除。

每个后端使用新 canvas，清除旧的完成标记，等待本次绘制后截图。依次捕获再比较 PNG 解码的 8 位 RGB，避免 WebGPU 默认画布呈现后直接读回得到空白的问题。本入口不计性能；不能把截图时间当作 GPU 时间。其他设备可以得到不同的差异数量，零差异也应保留报告用于比较；脚本不会因为与历史数值不同就判失败。

## 复现脚本

```javascript
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const url = new URL(process.argv[2]);
assert.equal(url.hostname, '127.0.0.1', 'Use the loopback URL printed by npm run dev.');
const projectPath = 'public/presets/documents/100626-pc-08-024-columbia-willamette.json';
const projectHash = '67d00bd06b7b257d733f8eced22f075e68efa670a1479b441c6551f8ab517ed0';
const project = await readFile(projectPath);
assert.equal(createHash('sha256').update(project).digest('hex'), projectHash);
const out = 'tmp/optics-comparison';
await mkdir(out, { recursive: true });
await writeFile(`${out}/project.json`, project);
const browser = process.env.OPTICS_CDP_URL
  ? await puppeteer.connect({ browserURL: process.env.OPTICS_CDP_URL })
  : await puppeteer.launch({ executablePath: process.env.CHROME_BIN, headless: false });
const context = await browser.createBrowserContext();
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const report = {
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
  browser: await browser.version(), projectPath, projectHash,
  viewport: { width: 900, height: 650, deviceScaleFactor: 1 },
  canvas: { width: 384, height: 384 },
  camera: { yaw: -0.62, elevation: 0.42, zoom: 1, panX: 0.12, panY: -0.05 },
  focusOffset: 0.23, threshold: 8, cases: [], errors,
};
try {
  await page.setViewport(report.viewport);
  await page.goto(url.href);
  report.device = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('A real WebGPU adapter is required; no fallback in this comparison.');
    return { webgl: renderer, webgpu: { vendor: adapter.info.vendor, architecture: adapter.info.architecture }, userAgent: navigator.userAgent };
  });
  await page.evaluate(async projectText => {
    const { createWebgpuOpticsRenderer } = await import('/src/components/opticsWebgpuRenderer.js');
    const { createWebglOpticsRenderer } = await import('/src/components/opticsWebglRenderer.js');
    const { normalizedOpticsPlanes, normalizedOpticsMesh } = await import('/src/domain/opticsGeometry.js');
    const { importFacetingJSON } = await import('/src/domain/faceting.js');
    const { buildConstructionStages } = await import('/src/domain/constructionHistory.js');
    const { resolveOpticsSettings, OPTICAL_PRESETS } = await import('/src/domain/optics.js');
    const project = importFacetingJSON(projectText);
    const solid = buildConstructionStages(project).at(-1).afterSolid;
    // Intentionally exercise both upstream solvers on the same final cut solid.
    // The source project is convex; this second path is a test-only mesh conversion.
    const shapes = { convex: normalizedOpticsPlanes(solid), mesh: { mesh: normalizedOpticsMesh({ ...solid, kind: 'mesh' }) } };
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;background:white';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:384px;height:384px;display:block';
    document.body.append(canvas);
    window.opticsComparison = { createWebgpuOpticsRenderer, createWebglOpticsRenderer, resolveOpticsSettings, OPTICAL_PRESETS, shapes, canvas, renderer: null, failures: [] };
  }, project.toString());
  for (const shape of ['convex', 'mesh']) for (const preset of ['diamond', 'blueSapphire']) for (const environment of ['studio', 'hearts']) {
    const images = [], key = `${shape}-${preset}-${environment}`;
    let settings;
    for (const backend of ['webgl', 'webgpu']) {
      settings = await page.evaluate(async options => {
        const q = window.opticsComparison;
        q.renderer?.destroy();
        const canvas = q.canvas.cloneNode();
        delete canvas.dataset.renderStage;
        q.canvas.replaceWith(canvas); q.canvas = canvas;
        const fail = error => { if (error !== '') q.failures.push(String(error || 'WebGPU render failed')); };
        q.renderer = options.backend === 'webgpu'
          ? await q.createWebgpuOpticsRenderer(canvas, fail)
          : q.createWebglOpticsRenderer(canvas, fail);
        if (!q.renderer) throw new Error('Renderer unavailable');
        const settings = q.resolveOpticsSettings({ material: q.OPTICAL_PRESETS[options.preset],
          view: { environment: options.environment, exposure: 0.2, environmentRotation: 27, background: 'mist' }, advanced: { maxBounces: 8 } });
        q.renderer.draw({ geometry: q.shapes[options.shape], settings, camera: options.camera, focusOffset: options.focusOffset });
        return settings;
      }, { backend, shape, preset, environment, camera: report.camera, focusOffset: report.focusOffset });
      await page.waitForFunction(() => window.opticsComparison.canvas.dataset.renderStage === 'complete' || window.opticsComparison.failures.length, { timeout: 30000 });
      assert.deepEqual(await page.evaluate(() => window.opticsComparison.failures), []);
      const canvas = await page.$('canvas');
      const png = await canvas.screenshot({ type: 'png' });
      await canvas.dispose();
      await writeFile(`${out}/${key}-${backend}.png`, png);
      images.push(Buffer.from(png).toString('base64'));
    }
    const comparison = await page.evaluate(async ({ images, threshold }) => {
      const pixels = await Promise.all(images.map(async data => {
        const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob());
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        if (canvas.width !== 384 || canvas.height !== 384) throw new Error('Unexpected screenshot dimensions');
        const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      }));
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 384;
      const ctx = canvas.getContext('2d'), diff = ctx.createImageData(384, 384);
      let maxChannelError = 0, total = 0;
      const mismatches = [];
      for (let i = 0; i < pixels[0].length; i += 4) {
        let max = 0;
        for (let c = 0; c < 3; c++) { const d = Math.abs(pixels[0][i + c] - pixels[1][i + c]); max = Math.max(max, d); total += d; }
        maxChannelError = Math.max(maxChannelError, max);
        diff.data[i] = max > threshold ? 255 : 0; diff.data[i + 3] = 255;
        if (max > threshold) mismatches.push({ x: (i / 4) % 384, y: Math.floor(i / 4 / 384), webgl: Array.from(pixels[0].slice(i, i + 3)), webgpu: Array.from(pixels[1].slice(i, i + 3)) });
      }
      ctx.putImageData(diff, 0, 0);
      return { maxChannelError, meanAbsoluteChannelError: total / (384 * 384 * 3), pixelsOverThreshold: mismatches.length,
        mismatchPercent: 100 * mismatches.length / (384 * 384), mismatches, diff: canvas.toDataURL('image/png').split(',')[1] };
    }, { images, threshold: report.threshold });
    await writeFile(`${out}/${key}-diff.png`, Buffer.from(comparison.diff, 'base64'));
    delete comparison.diff;
    report.cases.push({ shape, preset, environment, settings, ...comparison });
    console.log(key, { max: comparison.maxChannelError, pixelsOver8: comparison.pixelsOverThreshold });
  }
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.opticsComparison.renderer.destroy());
} finally {
  await writeFile(`${out}/results.json`, JSON.stringify(report, null, 2));
  await context.close();
  if (process.env.OPTICS_CDP_URL) await browser.disconnect(); else await browser.close();
}
```
