# 设计师操作手册与练习

先阅读 [PDF 操作手册](../../public/manual/facet-96-operation-manual.pdf)。本手册按设计目标组织：选轮廓、调比例、安排刻面会合、比较节奏、检查材质表现，最后保存与交付。

## 跟着一颗圆形练习做设计

这些是原创教学造型，便于清楚观察面群变化，不是实际生产的推荐切磨配方。

在 v0.7.2 OpenGemCutting 工作台打开「文件 → 导入 JSON」，选择以下文件。建议先另存自己的名称。导入会替换当前设计，可以撤销；未保存草稿不属于导出文件。

| 练习 | 想解决的设计问题 | 用法 |
| --- | --- | --- |
| [01 圆形起点](examples/01-round-start.json) | 先把轮廓和八瓣冠部看清楚 | 49 面；为变体保留一份原方案 |
| [02 棱上 1/3](examples/02-edge-third.json) | 在主面之间增加一组装饰面 | 57 面；编辑 C2 看 A 的来源 |
| [03 棱上 2/3](examples/03-edge-two-thirds.json) | 比较装饰面的宽窄和台面周边留白 | 与 02 同角度、分度、重复，只改沿棱位置 |
| [04 双 Meet](examples/04-dual-meet.json) | 同时满足两处会合关系 | A 是棱点，B 是已有顶点；编辑 C2 查看 |
| [05 低冠](examples/05-low-crown.json) | 比较更平缓的整体姿态 | 冠部高度 70%，与 01 用同一正视比较 |
| [06 四向装饰](examples/06-four-accents.json) | 给构图安排主次与留白 | I6、30、54、78，主面 I6，共 53 面 |
| [07 来源变化](examples/07-source-changed.json) | 上游造型改变后重新确认会合 | 刻意保留失效提示；编辑 C2 重新选择来源 |

评审每个变体时，请回答：我希望改变什么？前后能看见哪处变化？为什么偏好这一个方案？下一步是否值得继续？操作成功并不自动等于造型更好。

## 更新手册

正文在 `scripts/manual/content.mjs`；分页生成器是 `scripts/generate-user-manual.mjs`。`screenshots/` 保存真实工作台截图，主截图为 1600 × 1000 桌面视口、2× 像素密度；预设浏览器图等完整功能区单独截图。用于同视角造型比较的局部图仅截取完整宝石，不截断控件，不改变几何或材质。

更新 UI 或规则时重新采集受影响的图；不得使用占位图、旧控件图或绘制的假界面。临时采集及审查记录放在被忽略的 `tmp/`。

```bash
npm run manual:build
```

生成器使用 Chrome / Chromium 与项目内 Noto Sans SC 字体，输出固定的 `public/manual/facet-96-operation-manual.pdf`，版本号来自 `package.json`。生成时校验图片存在、所有案例可以导入、案例的面数及构造状态符合清单。打印前应逐页检查正文、图像和页脚，确保文本可搜索。

案例源由 `node scripts/manual/build-examples.mjs` 重建；修改案例源后，应重采对比图、更新正文与 `examples/manifest.json`，不要仅替换 JSON。
