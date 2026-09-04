# Contributing to OpenGemCutting

感谢你帮助改进 OpenGemCutting。We welcome reproducible bug reports, faceting examples, documentation, tests, and focused code changes.

## 不需要先学 Git · Contribute with Codex

安装 OpenGemCutting Companion 后，可以让 Codex 打开社区中心，帮你整理问题或建议、检查本地改动，并准备 Fork、分支和 Pull Request；Discussions 启用后还可直接浏览讨论。它会在任何公开发布、push 或 PR 创建前展示最终预览并等待你的明确确认。

With the OpenGemCutting Companion installed, ask Codex to open the community hub. It can guide GitHub onboarding, route a faceting question or idea, review local changes, run the repository checks, and prepare a Pull Request while preserving contributor attribution. Discussion browsing appears when the repository enables Discussions; until then the hub falls back to Issues and Pull Requests. Nothing is published without a final preview and explicit confirmation.

Installation instructions are in the [README](README.md#交给-codex-的一句话--one-sentence-for-codex). Traditional GitHub participation remains fully supported.

## 开始之前 · Before you start

- GitHub Discussions 启用后，开放式问题、产品想法和切型展示优先放在 Discussions；当前未启用时请使用 [GitHub Issues](https://github.com/yuyou-dev/OpenGemCutting/issues)，Companion 也会显示这一降级提示。
- Bug 请提供最小复现、浏览器/系统信息、期望与实际结果；涉及几何时附上可公开的 JSON。
- 新功能请先描述切磨场景、操作流程和可验收结果，再讨论实现。
- 安全问题或疑似凭据泄露不要放进公开 Issue，按 `SECURITY.md` 私下报告。
- 提交贡献即表示你有权提供相关内容，并同意其按仓库的 MIT License 分发。

## Pull request workflow

1. Fork 仓库并从 `main` 创建一个聚焦分支，避免夹带无关格式化或重构。
2. 阅读 `AGENTS.md` 和 `design-system.md`，保持 CUT 状态机、几何符号与视觉约定。
3. 为领域行为增加或更新 Node.js 测试；可见界面变化附真实截图。
4. 运行 `npm run check`，并在 PR 中写明命令结果和未覆盖风险。
5. 保持依赖最小；新增依赖需要说明现有代码无法简洁解决的问题。

Companion 只会将这些步骤变成对话式流程，不改变 GitHub 的 Fork、审查和作者记录。

## Project contracts

- `CUT STACK` 是唯一几何数据源；编辑必须在原布尔序列位置替换。
- `normal · point <= offset`、`+Z` 朝冠部、索引 `0` 显示为 `96`。
- CUT 空闲/新建/编辑/群组四态由 `src/domain/cutSession.js` 统一管理。
- 开发与预览只绑定 `127.0.0.1`，端口由操作系统分配。
- 保留 SUVA / 切磨工作台 / Facet 96 品牌拼写，不得写成 SUWA。
- 不提交密钥、个人绝对路径、私有主机、内部仓库信息、`dist/`、`tmp/` 或 `output/`。

## Commit and PR notes

提交信息建议使用简短祈使句。PR 需要说明：用户可见结果、动机、验证、视觉证据（如适用）以及有意不处理的范围。参与即表示同意遵守 `CODE_OF_CONDUCT.md`。
