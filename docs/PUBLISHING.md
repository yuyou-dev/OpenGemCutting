# OpenGemCutting first-publication checklist

本文件是维护者的发布检查表。OpenGemCutting 由私有 Facet 96 主项目统一维护，并通过独立公开仓库发布。

## 1. Legal and identity checks

- 确认根目录仍为完整 MIT License，并同步 README 和托管平台元数据。
- 确认 SUVA / 切磨工作台 / Facet 96 名称、Logo、截图与概念图可随公开仓库分发；商标边界见 `TRADEMARKS.md`。
- 公开提交必须使用已关联 GitHub 账号的 noreply 地址，避免暴露私人邮箱。
- 确认安全报告渠道，并在托管平台启用 Private Vulnerability Reporting。

## 2. Local preflight

```bash
npm ci
npm run check
npm run build:pages
git remote -v              # 预期为空，直到维护者明确选择远程
git status --short --branch
```

检查 README、Issue labels 与维护者联系方式。重新打开 `docs/assets/` 中的真实运行截图，确认它们与发布版本一致且不含私人信息。

## 3. Create the first local commit

仅在确认公开提交身份后执行：

```bash
git config user.name "yuyou-dev"
git config user.email "34769581+yuyou-dev@users.noreply.github.com"
git add .
git commit -m "chore: prepare OpenGemCutting public baseline"
```

不要从原私有仓库复制 `.git` 历史，也不要把实验或仿真分支合入此基线。

## 4. Verify the public remote

首次发布使用 GitHub 公开仓库：

```bash
git remote add origin https://github.com/yuyou-dev/OpenGemCutting.git
git remote -v
git push -u origin main
```

发布前再次确认 `npm run check` 通过、`git status` 干净、远程 URL 正确。远程创建与 push 必须由维护者明确授权。

## 5. Live demo

`.github/workflows/pages.yml` 在 `main` 更新后构建 `/OpenGemCutting/` 子路径并部署 GitHub Pages。发布后验证：

- `https://yuyou-dev.github.io/OpenGemCutting/` 可访问；
- JS、CSS、字体和品牌资源没有 404；
- CUT 新建、实体/X-ray 和文件导出入口正常；
- 浏览器控制台无错误。
