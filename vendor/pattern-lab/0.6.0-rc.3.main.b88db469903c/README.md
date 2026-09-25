# Facet Pattern Lab 模块消费说明

ESM 候选模块 `@facet96/pattern-lab`，模块版本 **0.6.0-rc.3**，宿主入口 API **2**，公共契约 **1.0.0**。候选仅作本地交付，没有发布到注册表或 GitHub，也不代表主项目已完成接入。

## 原生加载

将解包后的目录整体放入宿主的同源静态资源目录，保持相对路径。例如 `vendor/pattern-lab/0.6.0-rc.3/`。直接动态导入 `index.js`；不要只拷贝入口 JS，不要再次打包预编译文件，不需要 iframe、CDN、外部 React、import map 或主项目内部模块。

```js
const url = new URL('./vendor/pattern-lab/0.6.0-rc.3/index.js', document.baseURI);
const { mountPatternLab, moduleInfo } = await import(/* @vite-ignore */ url.href);
if (moduleInfo.moduleVersion !== '0.6.0-rc.3' || moduleInfo.contractVersion !== '1.0.0') {
  throw new Error('实验室版本不匹配');
}
const lifetime = new AbortController();
const lab = await mountPatternLab(document.querySelector('#pattern-lab'), {
  presentation: { layout: 'embedded', resultAction: 'host' },
  source: { projectId: committedProject.id, revision: committedProject.revision,
    document: structuredClone(committedProject.document) },
  // 由宿主先分配独立 draftId；闭包绑定该实验稿，不使用来源项目的存储键。
  persistence: {
    load: ({ signal }) => experimentStore.load(draftId, { signal }),
    save: (draft, { signal }) => experimentStore.save(draftId, draft, { signal }),
  },
  onResult: async (candidate, { signal }) => {
    if (signal.aborted) return;
    // 真实 readLabDocument / 实体重算、来源修订冲突检查、建立独立候选项目
    // 由宿主执行；实验室不会写入或覆盖来源项目。
    await acceptCandidate(candidate, { signal });
  },
  signal: lifetime.signal,
});
// 页面隐藏／重新显示
lab.pause();
lab.resume();
// 宿主管理结果按钮：await lab.returnResult()
// 保存并退出：先暂停取消尚未完成的预览/编辑，再等待实验稿保存。
lab.pause();
try { await lab.flush(); } catch (error) { lab.resume(); throw error; }
// 也可在 mount 尚未完成时直接 lifetime.abort()
lifetime.abort();
lab.dispose(); // 幂等；释放 React root、CSS link、事件、Worker、RAF 和 GPU
```

`#pattern-lab` 由宿主设置有效高度（例如 `height: calc(100dvh - 48px)`）和至少 320px 可用宽度。单个容器只接受一个活动实例；换来源前释放旧实例。当前交付验收为每页一个专业工作区，不承诺多工作区同时操作。打开来源和新建二选一，新建示例：`{ newDesign: { teeth: 99, symmetry: 9, density: 1, sizeMm: 10 }, persistence, onResult }`。

`presentation.layout` 正式控制布局：默认 `embedded` 不渲染实验室 Logo、首页、项目名、文件菜单及保存状态；保留一条图案设计/光学对比导航及必要编辑工具。`resultAction: 'host'` 由宿主提供唯一结果按钮，模块内不渲染候选按钮；省略时为 `'module'`，兼容由模块触发的回调。`standalone` 布局保留完整实验室顶栏；独立应用首页、项目管理和文件功能仍由原应用入口负责，算法与 UI 不另建一份。

宿主负责项目导航、来源身份与修订提示、实验稿保存状态、退出、候选落库和来源冲突核对；实验室负责局部编辑、约束、毫米标定、撤销和几何诊断。不要用宿主 CSS 隐藏内部 DOM。API 2 增加 `presentation` 和不触发候选回调的 `flush()`；主项目当前 API 1 的校验器需明确升级后再消费。来源信息不再重复展示，但完整不可变快照仍随实验稿和结果传递。

`index.d.ts` 描述上述宿主接口。`createLabSession(options)` 是同一控制器的无 React 会话入口，可在 Node 做数据／生命周期验收；不自动挂载 UI。`controller` 为现有实验室诊断面，宿主接线使用稳定的挂载、暂停、返回及释放方法，勿依赖整个内部状态树。

## 数据和持久化

- 来源为已提交的不可变快照。接收公共 v1/v3 cube 平面文档；网格、非空凹切和关键未知扩展在创建会话前拒绝。真实主项目最终校验职责不变。
- 实验稿是 `{ labId, moduleVersion, contractVersion, source, plan }`；`plan` 是实验室内部恢复数据，宿主不拆改或当作另一种公共琢型格式。各次保存和回调均提供独立副本。
- 宿主的适配器绑定独立实验稿身份，负责事务、容量和错误传播。保存串行执行；返回候选等待期间如又有编辑，继续等到最新保存完成。失败时显示保存错误并拒绝回传“已保存候选”。省略持久化仅用于临时内存体验，正式接入应注入适配器。
- 接受本版本、`0.6.0-rc.1`、`0.6.0-rc.2` 及已联合验收的 `0.5.1-alpha` 实验稿，恢复时仍校验来源 projectId/revision、契约和 labId；原数据不修改，下一次保存标注当前模块版本。未知模块／契约版本、不同来源修订拒绝，留给宿主提供恢复或另存途径。
- 回传 `{ document, source, moduleVersion, contractVersion, diagnostics }`。`document` 仍为公共格式；原表面、工序来源、实际细面和尺度沿用第一阶段已验收行为。不执行宿主的持久化落库、覆盖原设计或冲突裁决。
- 可选第二参数 `{ signal }` 传给 load/save/onResult；旧适配器忽略它仍兼容。暂停取消正在等待的候选回调；卸载还取消尚未派发的保存并停止等待。已经进入宿主 I/O 的调用不能由实验室撤销，宿主应消费 signal，并在提交事务或异步完成时复核会话仍有效。

## React、样式与资源

运行时 **没有外部 npm 依赖**。React / React DOM **19.2.0** 与 Scheduler、所用 Tabler 图标一并固化到模块私有 React root，不接收宿主 React 节点或 Hook，也不挂全局 React。宿主可保留自己的 React；边界是 DOM 元素与普通数据。

挂载等待模块自己的 `style.css`；卸载移除该 link。专业 UI 延续 `.facet-pattern-lab` 的 `@scope`，独立页面全局样式未进入交付模块。字体使用 `Facet Pattern Lab Sans/Mono` 家族名，避免注册到宿主已有字体名。HMR 开发模式由 Vite 管理样式，生产包才由实例管理 link。

JS chunk、CSS 字体、品牌图片、编辑 Worker 都从模块自身 URL 相对定位；支持非根目录部署。Worker 为独立的 module worker 文件，不使用 Blob Worker 或第三方来源。需要现代 ESM、CSS `@scope`、AbortController；光学预览需要 WebGL2。推荐同源静态部署；跨源页面直接创建 Worker 不在支持路径，开发联调请使用同源代理或本包验证页。

宿主应允许对应同源的脚本、样式、字体、图片及 `worker-src 'self'`，并设置 JS/CSS/font 正确 MIME。React 的组件内联布局沿用现有 UI；严格禁止内联 style 的 CSP 未作为支持承诺。目录内 `MANIFEST.json` 记录逐文件 SHA-256、资源种类、完整依赖版本、来源状态及构建命令；`THIRD_PARTY_NOTICES.md` 和 `licenses/` 保留依赖许可证。

## 验证与可复现构建

```bash
# 在解包目录，无需安装依赖：校验所有文件并运行候选本身的会话/数据测试
node self-test.mjs
# 同源本地验证服务器：127.0.0.1 + OS 分配端口，打印 host/index.html 地址
node serve.mjs .
# 可复现的模块构建，source/ 为最小构建输入快照，并非完整独立应用仓库
cd source
npm ci
npm run module:build
```

`source/` 固定全部构建输入与 lockfile；新产物在 `source/dist/module`，可与 manifest 的 `runtimeFiles` 比较 SHA-256。Node/npm/Vite/插件版本见 manifest。最小快照仅承诺上述模块构建命令；不含主项目源码、Git 仓库、历史交接、浏览器数据或凭证。完整独立应用仍在实验室仓库维护、验证。

主项目正式静态构建推荐继续通过其 Vite 插件将 `MANIFEST.runtimeFiles` 中的每个文件按固定版本整体 emit 到静态目录，并包含 `THIRD_PARTY_NOTICES.md` 与 `licenses/`。`navigation.js` 已在该清单中，不能遗漏。所有 URL 必须相对部署 base 定位，生产启动不连接实验室开发服务。源码、锁文件、字体/Logo 构建输入、Worker 源码和公共契约模块全部在 `source/`，可独立重建；无需从实验室仓库或主项目绝对路径补文件。预编译 JS 采用私有 React root，直接静态提供即可。

交付包内的实验室源码与品牌资源按 MIT 许可（见包内 `LICENSE`），经主项目验收后随 OpenGemCutting 公开发行；实验室仓库本身、开发历史与交接记录保持私有，不随交付公开。第三方 React/字体/图标许可见附带通知。`verification/ux` 包含原样复制的公开预设及来源 SHA 说明，仅供验收，生产无需部署 verification/、source/ 或 host/。

三维共同实现与主项目接线示例见 [NAVIGATION.md](NAVIGATION.md)。

实验室开发联调：仓库内 `npm run module:dev` 启动现有 Vite，访问打印地址的 `/lab-host.html`，共用 `src/lab/index.js` 与专业 UI；`npm run dev` 保留独立首页。`npm run build` 构建两种入口，`npm run module:pack -- <新的输出目录>` 构建并固定候选（已存在目录拒绝覆盖）。`npm pack` 仅生成本地压缩包，不执行 publish。分发目录不要放入实验稿或来源设计数据。
