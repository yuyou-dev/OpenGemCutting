# GemCad ASC 兼容说明

## 支持范围

Facet 96 读取 GemCad 5.0 文本 ASC，并以 GemCad 5.0 / 96 齿格式导出。解析器同时兼容带警告的 4.x 文件、UTF-8 BOM、LF/CRLF、缺少 `g` 前缀的真实文件、数字索引续行和独立 `G` 指令续行。

ASC 是几何交换格式，不是完整项目格式。JSON 仍是唯一完整主文件；ASC 不保存撤销历史、隐藏状态、毛坯、CUT 会话及除折射率以外的光学设置。

权威参考：

- [GemCad for Windows 用户手册](https://www.gemcad.com/downloads/gemcadman.pdf)，第 15 页定义 center-to-facet distance，第 20 页定义 ASC 记录。
- [GemCad DOS 用户手册镜像](https://manualzilla.com/doc/5697220/gemcad-user-s-manual)，用于交叉核对带符号齿轮与 location。
- [MIT 开源 GemCad reader](https://github.com/mbparker/gemcad-file-reader)，用于交叉核对 gear location 的有效方位公式。

## 文本结构

| 记录 | 语义 | 当前处理 |
| --- | --- | --- |
| `GemCad 5.0` | 文件签名 | 必需；4.x 警告兼容 |
| `ggear location` | 带符号齿数、齿位方位 | 精确换算；也接受 `g gear location`，真实样本的裸 `gear location` 警告兼容 |
| `y folds y/n` | 保存时的全局对称设置 | 作为元数据保留，不用于猜测 tier |
| `I value` | 折射率 | 写入 `metadata.optics.refractiveIndex` |
| `H text` / `F text` | 最多四行标题/脚注 | 保留并再次导出 |
| `a angle distance ...` | 一个刻面 tier | 一个不可变 CUT STACK 图层 |
| `n name` | 紧邻前一个索引的刻面名 | 逐面保留 |
| `G text` | tier 切割说明 | 行内或下一行保留 |

`y` 是保存文件时的当前工具设置，不描述此前每一层如何生成；因此 `a` 行的显式索引列表始终是几何真值。导入层使用同一 `patternId`，每面保存 `repeat: 1`、`mirror: 0`、`baseIndex: index` 与 `patternMode: "arbitrary"`，不擅自反推对称参数。

## 转换规则

- ASC 行业角带符号：负值为亭部，正值为冠部，`±90°` 为腰部；`0°` 且负距离为底尖，其他 `0°` 为台面。
- 内部几何 `β` 为 `sign × (90° - |angle|)`；冠部为正，亭部为负，腰部为 0。
- 有效源齿位为 `index - gearLocation`。目标齿位必须满足 `(index - gearLocation) × 96 / gear` 精确为整数；否则预检阻断，不做四舍五入。
- ASC 第三列是原点到切割平面的法向距离。导入整份文件使用同一比例 `s`，使所有平面都能转换为当前非负切入深度：`depth = rotationalSupport(normal) - s × abs(centerDistance)`。这会保持角度、索引、平面距离比、L/W 与高度比例；发生缩放时预检明确显示百分比。
- `T1` 按 Facet 96 不变量提升为 CUT STACK 固定首层，但原 ASC tier 序号保存在元数据中；再次导出会恢复源工序顺序。
- 缺少 `0°` 台面或包含多个 `0°` 水平层的 ASC 当前阻断导入。静默补台面或猜测固定 T1 都会虚构源工序；支持无台面、多台面设计需要未来显式扩展文档不变量。
- preform 记录当前阻断。应先在 GemCad 中把预形复制为真实刻面。

## 导出规则

导出固定写出 `GemCad 5.0`、`g96 0.0`、显式 tier 索引、折射率、标题、脚注和切割说明。每组刻面必须共享行业角与平面距离；否则不能表示为单个 ASC tier 并阻断导出。

重复与镜像会展开为显式索引。几何保持，但参数化生成意图不可逆；导出预检会提示。中文或其他非 ASCII 标题使用 UTF-8 写出，旧版 GemCad 的显示编码需要人工确认。

## 测试矩阵

| 范围 | 覆盖 |
| --- | --- |
| 真实样本 | Astryx Star：裸齿轮行、10 tier、57 面、注释、T1、完整几何回放 |
| 齿轮 | 96、64、72、80、120；每种精确和不精确索引 |
| 方位 | 整数/小数 gear location、负齿轮方向 |
| 几何 | 冠部、腰部、亭部、台面、底尖、统一比例、L/W、H/W、最终有效面 |
| 文本 | BOM、LF/CRLF、索引续行、独立 `G`、H/F、逐面 `n`、未知/preform 诊断 |
| 往返 | ASC → 文档 → ASC 平面等价；ASC 文档 JSON 往返；导入单命令撤销 |
