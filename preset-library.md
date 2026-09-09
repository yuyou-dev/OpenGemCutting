# 预设琢型库

预设库从“文件 → 浏览预设琢型”打开居中浏览层。设计师先按轮廓、有效面数和真实长宽比缩小范围，再比较真实几何四视图、基础参数和作者来源，最后载入作为研究起点。

当前内置 catalog 为 252 项、27 类外形和 1,008 张四视图，数据以 `public/presets/catalog.json` 为准。文档职责见 [索引](docs/README.md)。

## 产品决策

- 收录归档内全部通过当前质量门槛且几何唯一的 ASC；正式构建至少 50 项，无固定收录上限，数量不能替代质量。历史扩充过程见 [归档](docs/milestones/preset-library-expansion.md)。
- 外形沿用来源分类并提供中英名称；未知分类明确保留，不从名称猜测风格、材质或难度。
- 可组合外形、有效面数（≤60、61–100、101–160、>160）和实体 L/W（≤1.05、>1.05 至1.30、>1.30 至1.60、>1.60）筛选，多关键词搜索名称、作者、来源。每页 60 项，筛选后回第一页。
- 每项显示 `45° 轴测 / 顶视 / 底视 / 正视`。四张 SVG 对实际裁切实体投影生成，统一白底黑线，与 PDF 工程视图采用相同语言。
- 载入替换当前文档，作为一次命令进入历史；一次撤销回到原保存文档。浏览、筛选、翻页、预览、取消不修改文档或 CUT 会话。未保存草稿的放弃影响必须明确说明。

## 质量门槛

构建器使用正式 `inspectGemCadAsc`，以编辑器 `buildConstructionStages` 的最终实体验收。拒绝：

- 解析错误、preform、缺少或存在多个台面、无法精确映射到 96 齿的索引；
- 毛坯面残留、未知记录或未知 tier token；
- 空实体、非有限或非正体积、退化或非共面刻面、半空间越界、未闭合/非流形边、错误 Euler 拓扑；
- 异常比例：L/W 不在 0.95–4，H/W 不在 0.12–1.6；不以固定绝对体积下限排除小而有效的实体；
- JSON 导出再导入后出现几何变化；
- 缺少设计者、来源页、归档开放声明/索引依据，或文件 SHA-256 不符。

重复索引按正式解析器去重、冗余历史工序保留；只要最终实体通过检查就允许收录，原警告写入审计。

拓扑验收首先使用原坐标；失败时只在实体尺度的百万分之一内合并近重合点，并对共线边分段，避免把计算精度与合法 T junction 当作破面。验收不会修改或补洞原始实体。工程有效不代表实际切磨收益或审美优劣。

去重先验证原始文件 SHA-256，再按最终有效面的单位化平面（1e-8 精度）排序指纹比较；忽略名称、层序与无效历史，但保留旋转方向差异。优先保留原生 96 齿且警告较少的记录，再按来源 ID / SHA 固定选择；字节相同及重复几何的关联来源（包括下载清单 associations）保留在规范化文档与 catalog 的 `duplicateSources`。不同角度、比例或旋转方案不按相似名称合并。

解析和数值门槛不能替代视觉验收。白底黑线四视图用于浏览与批量检查；真正肉眼可见破面的资料列入 `src/domain/presetLibrary.js` 导出的 `CURATION_EXCLUSIONS`，构建器和资产测试共同引用。排除项同时保存源文件哈希，未来归档仅含别名页面时仍不得回流。既有 `96655`（Small OMNI Oval 1.4）与 `100855`（Chevron Cushion CC Brilliant 1.10）不得回流。

## 归档与追溯

支持两种解压目录：原 `download-manifest.json` 归档；新版 `manifest.json` + `open_index.json` + `README.txt` + `files/` 的便携归档。新版按相对 canonical 路径读取，核对每条下载记录的哈希、Open 页面索引和归档声明，保留作者原文。界面明确说明“归档 README 声明”，不把它改写为自有授权或公共领域承诺。

GEM 二进制和 PDF 不属于当前参数导入格式，不能从图片猜造切面。2026-09-04 归档的 4 个 ZIP 内均仅有 GEM，同样列入不支持格式。归档已去重的关联记录也纳入逐项统计。

`public/presets/catalog.json` 只含浏览摘要；单项 JSON 和四视图独立存放、按需请求。源 ZIP 保存在被忽略的 `output/source-archives/`，独有下载清单与历史采样归入 `output/archive/<日期>/`；解压及一次性验收放 `tmp/`。这些资料及本机路径不进入发布资源。

## 批量更新

```bash
# 解压到新的临时目录；归档内的根目录名是 facetdiagrams_open_parameters
unzip -q output/source-archives/facetdiagrams_open_parameters_complete_2026-09-04.zip -d tmp/preset-source
npm run presets:build -- --archive tmp/preset-source/facetdiagrams_open_parameters --report tmp/preset-library-audit.json
npm run check
```

2026-09-04 源 ZIP 的 SHA-256 为 `aa849abf2fbf9cebe61c5e80213a20628e4299f6565ad9d8bcfbce77bc512d21`。它与旧 `download-manifest.json` 采集工作目录结构不同；不能将旧目录当成该 ZIP 的解压副本。核对重建结果后可删除解压缓存，保留 ZIP 和独有来源记录。

默认导入全部合格唯一项，不使用类别配额。`--limit N` 仅用于开发抽样，报告记录 `limited`，不能冒充全量里程碑；`--allow-partial` 仅用于不足 50 项时开发 UI。输出先完整生成到 staging，成功后替换预设资产。报告为每条清单记录提供 accepted / rejected / duplicate-file / duplicate-geometry / unsupported-format 等去向及诊断，可核对总数。

## 可延续结构

`src/domain/presetLibrary.js` 定义 provider 边界：`list()` 返回摘要；`load(summary)` 返回可导入 JSON 文档；`save(document, metadata)` 是可选能力。内置只读资料、未来个人 ASC/JSON 及“当前文档存为预设”沿同一边界扩展，不复制浏览 UI 或把个人存储耦合到内置 catalog。

## 可复现的选型练习

起点：保留当前保存文档；打开“文件 → 浏览预设琢型”。目标是找到细长椭圆的研究起点，同时把有效刻面限制在100面以内，便于比较刻面组织。

选择 `Oval 椭圆`、`61–100 面`、L/W `>1.30 至1.60`。当前 catalog 得到12项；选取 [PC 02.036A Long Lazy Oval L/W=1.5](public/presets/documents/95644-pc-02-036a-long-lazy-oval-l-w-1-5.json)（71面、L/W约1.500）。先看顶视轮廓和底视刻面，再载入。载入前是原保存设计，载入后名称与71面读数对应这颗椭圆；一次撤销应恢复原保存文档。若有未保存动作，先按可见提示处理草稿。

比较时固定顶视或正视、显示模式和缩放，不用不同透视或不同光学环境判断差异。设计师自行回答：1.5的细长比例是否适合目标？台面与亭部刻面的安排是否值得作为自己的起点？工程验证只记录筛选、载入与撤销结果，不代填审美判断。

## 初始底胚预设

底胚不是已完成琢型，不进入 CUT 预设 catalog。`src/domain/stockPresets.js` 为四个原创规整轮廓的唯一来源：心形左右镜像、下半部外凸圆润且无内凹弧线，圆端十字四次旋转与镜像，蝴蝶结上下左右镜像，A 形左右镜像且内孔贯通。最大横向尺寸归一到 2，高度为 2（100%），不指定物理单位。选择后创建零 CUT 的 mesh 文档；旋转与镜像 CUT 仍独立于原石对称。

运行 `node scripts/build-stock-presets.mjs` 生成 `public/stock-presets/` 的四个 OBJ。回归验证对称、封闭、孔洞体积、实际水平裁切与 OBJ 导入，并检查静态文件和生成源一致。
