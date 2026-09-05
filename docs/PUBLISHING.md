# OpenGemCutting release checklist

本文件是维护者的重复发布检查表。OpenGemCutting 是独立的公开发行仓库；每次版本更新都必须重新确认公开边界、构建产物与线上体验。

## 1. Legal and identity checks

- 确认根目录仍为完整 MIT License，并同步 README 和托管平台元数据。
- 确认 SUVA / 切磨工作台 / Facet 96 名称、Logo、截图与概念图可随公开仓库分发；商标边界见 `TRADEMARKS.md`。
- 公开提交必须使用已关联 GitHub 账号的 noreply 地址，避免暴露私人邮箱。
- 确认安全报告渠道，并在托管平台启用 Private Vulnerability Reporting。

## 2. Local preflight

```bash
npm ci
npm audit
npm run check
npm run build:pages
git remote -v              # 只允许指向公开 OpenGemCutting 仓库
git status --short --branch
```

检查 README、Issue labels 与维护者联系方式。重新打开 `docs/assets/` 中的真实运行截图，确认它们与发布版本一致且不含私人信息。确认以下公开产物存在：

- `public/presets/catalog.json` 与全部引用的规范化文档、四视图；
- `public/manual/facet-96-operation-manual.pdf`；
- README 顶部 Live Demo、操作手册与设计练习链接；
- 手册正文、页脚及案例均适用于当前公开版，不含其他发行版说明；
- `package.json`、手册页脚与发布 tag 的版本号一致。

## 3. Create a release commit

仅在确认公开提交身份后执行：

```bash
git config user.name "yuyou-dev"
git config user.email "34769581+yuyou-dev@users.noreply.github.com"
git add .
git commit -m "release: OpenGemCutting vX.Y.Z"
```

不要复制其他仓库的 `.git`、内部文档、个人路径、私有远程或未经确认的实验资产。公开提交保持独立、可审查和可回滚。

## 4. Verify the public remote and publish

```bash
git remote -v
git push -u origin main
git push origin vX.Y.Z
```

发布前再次确认 `npm run check` 通过、`git status` 干净、远程 URL 正确。发布后保持仓库 About 区域的 Website 指向 Live Demo。

## 5. Live demo

`.github/workflows/pages.yml` 在 `main` 更新后构建 `/OpenGemCutting/` 子路径并部署 GitHub Pages。发布后验证：

- `https://yuyou-dev.github.io/OpenGemCutting/` 可访问；
- `https://yuyou-dev.github.io/OpenGemCutting/manual/facet-96-operation-manual.pdf` 可下载且为当前版本；
- JS、CSS、字体和品牌资源没有 404；
- 启动品牌标志、预设四视图、CUT 新建、实体/X-ray、光学仿真、ASC 预检和文件导出入口正常；
- 浏览器控制台无错误。
