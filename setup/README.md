# 安装模块

`bootstrap.sh` / `bootstrap.ps1` 仅补齐用户目录的 Node 并进入同一个 `cli.mjs`。兼容的 Node 直接复用；缺少时下载 `runtime.json` 指定的官方版本并核对 SHA-256，不使用 sudo，不改系统 PATH。Node 的版本与哈希集中记录；来源为 https://nodejs.org/dist/v22.23.2/SHASUMS256.txt 。

`lifecycle.mjs` 负责命令调用、npm 定位、升级保护及 Codex 注册。`product.json` 只有发行名称、MCP 名、插件及市场名，私有与公开版各自配置，代码保持一致。MCP 独立依赖留在 mcp；插件入口只读取服务器提供的完整 skill。缺少 Codex CLI 或现有 CLI 不支持所需插件命令时安装已验证的 0.153.4 到忽略的 `.runtime/codex-cli`，不分发 Codex 本体或账号。

安装：`node setup/cli.mjs install`。升级：导出重要设计后 `node setup/cli.mjs upgrade`，仅对干净且配置上游的 Git 工作区进行 fast-forward，随后重新进入更新后的安装模块。源码 ZIP 无 Git 历史时按 UPGRADE.md 在新目录安装新版并导入 JSON，不覆盖本地修改。普通网页可用 `--app-only` 跳过全部 AI 依赖。

`doctor` 检查构建、协议、资源与本机 HTTP，不宣称 Codex 原生工具已加载或用户浏览器已绑定。浏览器打开与 `design_read` 验收由 INSTALL.md 和插件入口完成；脚本输出 `not-yet-verified`，避免把安装状态冒充创作就绪。MCP 不增加第二个后台宿主，避免安装页与对话指向不同服务。

维护：新增安装行为进入本目录；新设计操作进入 application/domain；协议进入 mcp。每项修改写明模块职责、可观察结果、测试和文档影响，不以临时脚本或越来越长的 skill 条款代替正式能力。

主项目继续使用 `facet96-design` 服务/插件与 `facet96` 市场。`local-server.mjs` 是开发/预览启动策略的唯一入口：只允许 dev/preview 两种模式，强制 IPv4 回环、系统临时端口与 strictPort，拒绝网络覆盖参数。Vite 6 dev 不直接支持端口 0，故先申请端口再启动；极小的竞争窗口只导致安全失败，可重新启动。网络回归验证并行启动不冲突及本机非回环地址无法访问。
