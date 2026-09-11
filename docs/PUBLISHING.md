# 发布 OpenGemCutting

本文件维护发布流程；实际支持与验收结果见 [validation.md](validation.md)。先完成全部本地检查和可审查的提交，再确认远程发布动作。

## 本地交付

1. 确认代码、应用版本、锁文件、设计插件、README 与 PDF 页脚一致；插件本地缓存后缀不改变产品版本。
2. 核对许可证、预设来源与品牌范围；个人路径、账号、凭据、内部历史、个人参考图不进入发行内容。
3. 检查 [README](../README.md) 的真实截图、安装/升级提示词和文档链接。README 与手册共用 docs/manual/screenshots，不保留旧版本的重复展示图。
4. 运行：

```bash
npm ci
npm ci --prefix mcp
npm audit
npm audit --prefix mcp
npm run check:mcp
npm run build:pages -- --outDir tmp/pages-release
```

普通构建仍须留下 dist/client/index.html、dist/server/index.js、dist/.openai/hosting.json。Pages 单独输出用于验收，避免覆盖普通 MCP 构建。真实浏览器核对对话绑定、独立手动模式、图像/字体与手册下载；记录未验证的平台。

## 提交与公开边界

检查 Git 状态、公开远程、提交作者的公开 noreply 地址，以及将公开的完整差异和素材。只提交本轮确认的内容，不把别的工作区或私有 Git 历史带入。

本地提交和发布标签可以先准备；推送、PR 或 GitHub Release 是独立的外部写操作，必须展示具体对象和动作并取得用户确认。

## 远程验收

确认后按选定的发布路径推送。main 更新会触发 Pages；部署成功后检查：

- [Live Demo](https://yuyou-dev.github.io/OpenGemCutting/) 显示当前版本；
- [PDF 手册](https://yuyou-dev.github.io/OpenGemCutting/manual/facet-96-operation-manual.pdf) 可下载且页脚版本正确；
- JS、CSS、字体、品牌及预设资源正常；
- 在干净安装目录重新执行 README 提示词，确认插件、MCP、内置浏览器与真实项目连通；
- 更新支持记录中的实际发布状态，不将本地构建视为线上成功。
