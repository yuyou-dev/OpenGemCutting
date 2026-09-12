# 中英双语与专业术语审核

工作台顶部的语言选择器提供 **跟随系统 / 简体中文 / English**。选择后立即切换，并在此浏览器、此站点地址记住偏好。没有 Codex 或 MCP 时也可完整使用语言切换与手动设计。系统语言不是中文时使用英文；可随时手动改选。

切换不会保存或放弃 CUT、改写项目名称、移动视角或增加撤销记录。既有项目和图层名称是设计者的数据，保持原文；文件格式、分度、单位及参数精度不随语言变化。

## 给珠宝专业人士

打开 [术语审阅表 CSV](terminology-review.csv)，或查看 [唯一维护源 JSON](../../src/i18n/terminology.json)。每行包含中英词、使用语境、容易混淆的含义、参考来源、审核状态及意见栏。CSV 使用 UTF-8 BOM，可用 Excel、Numbers 或表格软件打开。

建议先审核“行业角 / Faceting angle”“切入深度 / Cut depth”“亭深 / Pavilion depth”“主切面 / Primary facet”“主刻面 / Main facet”和“有效刻面 / Effective facet”。这些词直接影响使用者对切磨动作的理解。软件功能名 Meet / Jump 保留英文，语境与物理切磨术语分别说明。

在 reviewer 填姓名或署名，在 suggestion 写建议英文及原因。请一并说明适用语境，例如钻石／有色宝石、切磨机读数／几何坐标。所有初稿目前标记为 `pending-specialist-review`；引用 GIA 或 GemCad 不表示这些机构审核了本项目译文。

维护者将确认的修订回填 JSON，同步界面、报告和手册，再运行 `npm run terminology:export` 生成 CSV。不要分别改两份表形成分叉。

## 设计师验收

1. 新建一个测试项目，命名为“圆形低冠 / Round low crown”；在 CUT STACK 编辑或新增一组面，记住角度、深度与预览形状。
2. 顶栏切到 English。检查同一预览、名称及数值仍在，确认能找到 Save / Discard，而非只检查按钮是否可点。
3. 保存并 Undo，确认可回到原造型；再次切回简体中文，检查方向、参数和记录连续。
4. 打开 More tools → Help and manual，下载英文图解手册；中文模式下载中文版。打开 File → Export PDF report，检查报告标题、参数表和用户命名。
5. 刷新或重新打开此站点，检查语言偏好保留；项目恢复遵守原有已提交设计规则，不恢复未保存草稿。
6. 在较窄窗口检查关键按钮是否可读、菜单是否完整，分别记录词义疑问与排版问题。术语准确性与审美偏好由专业人士判断，不预填验收结果。

## 维护职责

- `src/i18n/format.js`：纯消息格式化、语言解析；`en.json` 为英文消息目录。
- `src/i18n/locale.js`：站点偏好；`react.jsx` 订阅显示语言。领域和几何模块不反向引用它们。
- 模板整句翻译并显式传递参数，用户名称作为不透明值；不能做 DOM 扫描或逐词替换。历史领域诊断仅在显示边界匹配完整注册模板。
- `src/report/pdfReport.js`：显式 locale 参数，异步生成使用入口语言快照。`design_export` 可单独选择 PDF 语言，JSON / ASC 不受影响。
- `scripts/manual/content.mjs` 共用案例结构，生成器按 locale 取文案及真实截图；不复制手册排版算法。中文、英文入口分别为 `facet-96-operation-manual.pdf` / `facet-96-operation-manual-en.pdf`。
- 新增界面消息时补目录与占位符回归；术语修改需同步受影响材料。完整验证入口仍为 `npm run check`，协议变更另运行 `npm run check:mcp`。
