# 实验室公共契约 1.2.0

状态：主项目与实验室之间现行的最小公共接口；原生接入已于 2026-09-25 通过人工验收；当前固定模块由 `src/application/labsModuleLock.json` 锁定，交付包按 MIT 随 OpenGemCutting 发布。本契约不授权覆盖项目或公开发布。

## 版本与权威

| 名称 | 当前值 | 职责 |
| --- | --- | --- |
| 公共文档 | `facet-96-document` schema 1 / 2 / 3 | 主项目已有格式，不另造实验室简化格式 |
| 公共契约 | `1.2.0` | 本文及样本的交换语义；1.1.0 在 1.0.0 上增加 `preset` 来源配置（cube 与有界凸 mesh）；1.2.0 增加按实验室声明的平切预算（`LAB_PROFILES`）、实验室持有元数据的登记与宿主保留规则，以及几何逐值复原时配方恢复 current |
| 公共规则模块 | `@facet96/labs-contract` `1.2.0` | 无运行依赖的 ESM 分度规则、能力预检、扩展校验 |
| 主项目产品 | 见 package.json | 与文档、契约版本独立 |
| 图案功能模块 | 已原生接入；版本由 `src/application/labsModuleLock.json` 锁定 | 固定交付模块与公共规则包分别管理，操作与草稿恢复见宿主仓库 `docs/labs/USER-GUIDE.md` |

实现单一来源为 [labsContract](../../src/domain/labsContract/index.js)；原 `domain/indexing.js` 只重导出该实现。宿主完整入口为 [readLabDocument](../../src/application/labDocuments.js)，使用正式导入器、领域校验器与实体内核。公共模块不依赖 React、DOM、MCP、几何引擎或相邻仓库。

## 文档与几何能力

主项目继续读取历史 v1 cube、v2 mesh 和 v3 多分度／独立凹切文档。当前固定图案模块沿用第一阶段交换范围： **v1 / v3、cube stock、空凹切数组、显式平面 CUT**；允许非默认 cube 大小、中心和独立 cube `cuttingReference`。v2 mesh、v3 mesh、mesh reference 和任何非空 `concaveCuts`（包括禁用工具）必须拒绝进入此实验室，不得删除后再接受。主项目自身的 mesh／凹切能力不受影响。

`importFacetingJSON` 负责历史兼容：缺失 stock 补默认 cube，缺失设备盘补 96，v3 缺失 concaveCuts 补空数组；facets 必须存在。旧角度快照仅按既有迁移条件重建，不能将任意错误平面当成旧格式自动修复。新版本 schema、未知 stock 或必需几何扩展明确拒绝。固定样本同时提供原始输入和宿主规范化结果，历史迁移不属于逐字节保留承诺。

每个实验室的接入范围只在 `LAB_PROFILES` 声明一次：`pattern` 接受 cube、最多 600 道平切；`preset` 接受 cube 与有界凸 mesh、最多 2048 道平切。预算计入被覆盖的工序，因为无编辑往返必须保留它们。实验室自身的上限读取同一常量，宿主入口检查与实验室挂载不能给出不同结论；宿主导入预算（4096）高于两者，超出实验室预算的设计在入口说明原因，不进入后才失败。

轻量 `inspectLabDocument(canonicalDocument)` 返回 `{ supported, errors }`，只检查格式头、能力范围、设备盘、显式平面基本结构和扩展；**supported 不代表完整几何通过**。任何保存／返回仍需宿主 `importFacetingJSON` 和 `assertValidDocumentGeometry`；`readLabDocument` 组合三者，且不写库、不替换项目。校验错误携带路径；不支持能力的错误码为 `LAB_UNSUPPORTED_DOCUMENT`。未通过时输入对象、文件和已有项目均保留。

## 坐标、角度、尺度

继承 [几何契约](../architecture/geometry-contract.md)：Z 为分度旋转轴，+Z 朝冠部；XY 中方位角逆时针增加。行业角为切面与水平面的夹角，冠部 β = 90° − 行业角，亭部 β = −(90° − 行业角)，腰部 β = 0°。裁切保留 `normal · point <= offset`，plane.keep 为 `less-than-or-equal`。参数与显式平面须通过宿主一致性校验，不能独立编辑为两套真值。

stock 是不可变毛坯；切深参考为 `cuttingReference ?? stock` 的固定旋转包络。cube 的半径和半高均为 size/2，含 center 的投影；depth 是支撑偏移减实际 offset。不能把实验室归一化坐标当宿主坐标，也不能由当前成品边界重新确定毛坯／深度零位。

几何长度沿用模型单位。已知毫米尺度使用 `metadata.physicalScale.millimetersPerModelUnit`（有限正数），兼容既有 `stock.source.millimetersPerModelUnit`；两者同时存在必须一致。`millimetersPerModelUnit(document)` 未知时返回 null，禁止默认猜成 1 mm 或 10 mm 成品。坐标、深度和 offset 均乘此值换算毫米，体积乘其三次方；改变索引盘不改此比例。历史 `metadata.patternStudy.finalWidthMm` 仍作为来源信息保留，实验室须根据其真实成品宽度显式适配，不能把宽度直接当单位比例。此阶段记录尺度，不改写现有光学标定。存在尺度时，主编辑器状态栏与 PDF 报告封面同时给出毫米外包尺寸与体积（`physicalMeasures()`）；工序参数仍为模型单位。

## 分度与兼容性

共享常用盘为 32、64、72、77、80、84、88、96、99、120、360，领域允许 1–360 整数齿数。默认 96；内部 index 是 `[0, teeth)` 的连续数，teeth 是 0 的显示别名。小数方向是合法几何，不能因不是整齿而拒绝保存或静默吸附。

换盘通过 `facetOnIndexGear` 换算 index、baseIndex、mirror 和 Meet 主索引，宿主 `withDocumentIndexGear` 只重标读数；原 plane、depth、面 ID、工序分组／顺序、来源和实际细面保持不变，禁止执行细面配方。重复次数不变；连续换盘允许浮点读数误差，实际平面须逐值不变。

`indexCompatibilityReport` 以实际 normal 检测，默认角误差容差 `1e-6°`；水平面免于绕 Z 的分度约束。`all` 含全部已提交平切工序及实际生成的细面，包括被覆盖的工序；`final` 必须传宿主完整实体求得的 effectiveFacetIds 或 finalFacets。毛坯面片、渲染三角形、凹切工具不是平切面，显隐不能代替最终有效性。360 不是其他盘的整齿超集，例如 96 的一齿是 3.75°。文件兼容、整齿匹配、实物加工可行性是三个不同结论。

## 几何、表面与实验配方

- **实际几何**：完整 `facets` 参数和显式 plane；细面也是普通平切面，只保存一次。主项目导入不得执行实验配方再次生成细面。
- **表面**：既有 `facet.metadata.surfaceFinish`，`{ version: 1, model: 'ggx-dielectric', state: 'polished' | 'frosted', alpha, scatter? }`。抛光 alpha 为 0，磨砂 alpha 为 0.001–1，scatter 为 0–1。字段通过公共校验并完整保存。主项目光学“按设计表面”直接使用固定模块的 GGX 介质实现预览这些字段，但布光与积分方式由宿主决定，不承诺与实验室画面逐像素相同，也不把粗糙度解释为砂目；见 [光学渲染](../architecture/geometry-contract.md#按设计表面)。
- **配方**：可选 `document.metadata.labRecipe`，包含 version:1、labId、moduleVersion、status:`current`/`stale`、geometryKey 和实验室自己解释的 data。`labGeometryKey(document)` 是稳定排序的完整几何比较串，包含 stock、reference、scale、凹切与按保存顺序排列的面身份和 plane；不含基准盘读数和名称。它用于匹配，不是加密签名。核心从不执行 data。
- **扩展**：document／facet／stock／cuttingReference 的 `extensions` 是命名空间对象，每项声明 `{ version: 正整数, required: false, data: JSON值 }`。未知可选项完整保留；本版本无额外几何扩展处理器，required:true 一律明确拒绝。metadata 中的安全未知 JSON 字段也保留，包括来源、父面信息和旧 patternStudy。数据必须为有限、无环的 JSON，拒绝原型污染键。扩展不得藏在 UI 会话、camera、history 或未登记顶层字段中；这些不是公共持久化边界。

`refreshLabRecipe` 遇到几何、身份、工序顺序或尺度变化将配方标记 stale，并保留其 data 和旧 geometryKey；改名、表面注释和纯换盘不使配方过期。宿主命令、文件和项目保存使用同一检查；撤销恢复原文档，配方状态一起恢复；因几何变化失效的配方，在几何逐值回到其 geometryKey（例如加入凹切后又移除）时恢复 current，其他失效原因不自动恢复。宿主重建文档时，参数未变的面保留原平面数值（只差 1e-12 取整时不改写），避免指纹被无关操作打破。实验室只有在实际重新求解并验证后才能写入新的 geometryKey/current；禁止仅更新标记绕过失效状态。

## 实验室持有的元数据

宿主不解释实验室写入的元数据，但必须按归属保留它们。**切面（facets）是唯一几何真值**；元数据只能描述切面或从切面推导，不能成为另一份几何。

| 归属 | 位置 | 写入方 | 宿主编辑时 |
| --- | --- | --- | --- |
| 单个切面 | `surfaceFinish` | 宿主、两个实验室 | 层编辑按方向保留到仍存在的面；新方向不继承 |
| 单个切面 | `componentInstanceId`、`sourcePlaneId`、`sourceComponentId`、`componentPart`、`componentTier`、`componentRole` | 冠亭预设实验室 | 同上；整体变换、换盘、改名、重排不改动 |
| 单个切面 | `patternStudy`、`operationType` | 图案实验室 | 同上 |
| 整个图层 | `ring`（仅 `patternMode: arbitrary` 的环切／弧切层） | 宿主 | 拆分或改为对称的层必须删除 `ring`，成为普通层 |
| 整份文档 | `componentInstances` | 冠亭预设实验室 | 原样保留；不随切面更新 |
| 整份文档 | `labRecipe`、`labReturn`、`patternStudy` | 两个实验室、宿主 | `labRecipe` 由 `refreshLabRecipe` 判定；其余原样保留 |

宿主的单面归属列表为 [layerEdit.js](../../src/domain/layerEdit.js) 的 `FACET_OWNED_METADATA`，宿主界面与 MCP 编辑图层共用同一实现：仍存在的方向保留面 ID 与单面元数据，图层级元数据才在整层统一。

整份文档的记录（例如 `componentInstances` 的组件与变换）可能因宿主编辑而不再描述实际切面。写入方读取时必须以切面为准：能从成员切面精确推回记录（例如整体升降、比例、分度旋转对应的轴向变换）时更新记录并保留分组；不能推回时保留切面、放弃该记录，并在界面明确告诉设计师失去了什么。禁止静默丢弃，也禁止用记录改写切面。

实验室编辑后回传的工序结构可以与来源不同：图案实验室把被编辑的工序拆成单面工序（`pattern-study:<id>`），未编辑的工序保持原身份；依赖被编辑来源的 Meet 按上文诊断为 stale。

## 无编辑保留与约束失效

规范化后无编辑往返须保留：facet.id、patternId、ordinal、facets 数组顺序、全部已保存但可能被覆盖的 CUT、region、参数、plane、label、stock、cuttingReference、尺度、metadata、可选 extensions。禁止将每面重新分成一个独立工序、重排、重新编号，或只回传最终有效面。machining 是派生声明，导入忽略并重算，不作为来源真值。

已保存 Meet 使用既有 `metadata.construction`，不编辑须保留目标、来源身份和签名。宿主 `buildConstructionStages` 对真实前序实体诊断 valid/stale；来源删除、变形、重排或主面不再通过目标时明确 stale，显式平面不自动跟随。实验室不支持继续编辑约束时，应保留原约束作为来源并报告诊断；不能伪造新的来源身份或声称旧约束仍有效。共同样本包含真实 valid 和 source-missing 的 stale Meet。

## 原生接入的宿主边界

| 边界 | 宿主职责 | 实验室职责 |
| --- | --- | --- |
| 打开 | 提供不可变来源快照 `{ projectId, revision, document }`，或明确的新建设计入口；只含已提交文档 | 独立工作副本，不读写宿主项目库，不混入 CUT 草稿 |
| 保存实验稿 | 分配独立实验稿身份，保留来源修订与契约／模块版本，存储失败明确反馈 | 返回完整实验稿数据，不把下载成功当保存成功 |
| 返回候选 | 用真实校验器／实体求值检查；默认创建独立新项目，既有预览保护与冲突保护继续生效 | 输出公共文档、表面、配方及兼容／失效说明；不能直接覆盖来源 |
| 暂停 | 页面隐藏时发出暂停信号 | 停止求解、光学循环、拾取和快捷键，不提交编辑 |
| 释放 | 离开／卸载时结束此实例 | 取消任务、释放 Worker／GPU／事件资源，迟到结果不得回写 |

原生接入通过 `application/laboratories` 登记固定模块，`application/labHost` 校验候选，`application/labDatabase` 事务保存独立实验稿（`domain/labDrafts` 保留旧格式校验与兼容适配）；不使用 iframe 或远程运行时代码。宿主只提供单份实验的保存能力，带回创建独立项目，不覆盖来源或建立平行 CUT 会话。当前生命周期与存储边界见 [状态契约](../architecture/state-contract.md#项目与页面)；第一阶段未接入 UI 的描述仅适用于历史交接包。

## 固定交接包与使用

在主项目运行 `npm run labs:pack -- output/labs/contract-1.2.0 <pattern|preset>` 生成一次性快照；目标存在即失败，不原地覆写。包包括公共 ESM、公开 v3 schema、本文、宿主生成的原始／规范化样本与预期实体、独立自检脚本、MANIFEST.json 和 SHA256SUMS。快照随实验室交付包公开，manifest 只记录所用已发布宿主源文件的 SHA-256，不记录宿主提交、分支或工作区状态；联合验收按这些哈希核对宿主源码。压缩包另有 SHA-256。

```bash
# 解包后，无需安装依赖；先核验逐文件校验和并执行公共规则自检。
node /absolute/path/contract-1.2.0/self-test.mjs
# 主项目中调用真实几何内核复核同一固定包。
npm run labs:verify -- /absolute/path/contract-1.2.0
```

```js
import { LAB_CONTRACT_VERSION, inspectLabDocument, indexCompatibilityReport,
  facetOnIndexGear, millimetersPerModelUnit } from '/absolute/path/contract-1.2.0/index.js';
// 输入应先经过实验室适配与宿主规范化；supported 仅为能力预检。
const capability = inspectLabDocument(canonicalDocument);
const allOperations = indexCompatibilityReport(canonicalDocument);
```

不支持样本以原输入保存，主项目自检确认失败且输入未改；legacy omissions/angle 样本以规范化结果供公共预检。精确平面、身份、顺序和扩展比较为严格相等；实体重新求值的坐标／体积容差为 `1e-9`。本包自检与宿主复核不是实验室往返验证。消费后任何规则／样本变动均递增契约包版本，在交接记录列明差异并重新验收；旧快照保持不变。
