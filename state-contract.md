# 全局状态与 CUT 交互契约

本文件是 Facet 96 编辑器全局状态的单一约定：哪些状态存在、归谁所有、是否进入文档与撤销历史，以及 CUT 交互必须遵守的状态机契约。新增交互或状态前必须先读本文件；长期决策在此登记，`AGENTS.md` 与 `design-system.md` 只引用不重复。

## 开发契约

以下条款是规范性约束，违反的实现不予合入：

- CUT 交互一律经由 `src/domain/cutSession.js` 的事件驱动状态机：组件只调用 `dispatchCutSession` 发送 `CUT_SESSION_EVENT`，不得自行 setState 切换会话身份。
- UI 组件不得自行判断 `mode` 分支渲染逻辑；只消费 `resolveCutSession(session)` 返回的能力位（`controlsEnabled`、`showGizmo`、`showCutPlane`、`showNewButton`、`highlightActiveLayer`、`canCancel`、`canPickLayer`、`canChangeRegion`、`canMutateStack`、`canStartGroup`、`canUseMeetJump`、`canJumpPrevious`、`canJumpNext`、`canPickMeetTarget`、`canLockMeet`、`canCancelConstructionTool`、`depthEditable`、`constructionValid`）与派生态（`active`、`previewEnabled`、`canCommit`、`activePatternId`、`groupRegion`）。
- 按钮与控件的 `disabled` 必须由能力位或派生态驱动，不得在组件内另写与 `CUT_SESSION_TABLE` 平行的条件。
- 新增 CUT 交互的标准流程：新增事件类型 → 在 `CUT_SESSION_TABLE` 评审并声明能力位 → 更新 reducer 转换 → 更新对应契约测试。四步缺一不可。
- 草稿参数（`industryAngle / depth / baseIndex / repeat / mirrorOffset / patternMode / customIndices`）、草稿构造状态 `construction` 与群组参数（`deltaZ / scale / rotationTeeth`）只存在于会话对象的 `draft` / `construction` / `group` 字段，经状态机事件更新。参数 patch 和 Meet 自动求解后的深度必须由同一个 `changeDraftWithConstruction()` 编排入口原子派发到 `CHANGE_DRAFT`，禁止侧栏、行内编辑、Gizmo、分度环或组件本地 state 各自求解；区域默认值只从 `DEFAULT_DRAFT_ANGLES` / `DEFAULT_DRAFT_DEPTHS` / `defaultDraftForRegion` 取得。
- 领域锁定在状态机层强制，而不是只靠 UI 禁用：腰部 `industryAngle` 锁定 `90°` 由 `CHANGE_DRAFT` 直接压回，固定台面 `0°` 同理不依赖控件 disabled。UI 禁用只是配套提示。
- 提交、取消和文档替换都必须经状态机事件（`COMMIT_SUCCESS` / `CANCEL` / `DOCUMENT_*`）收尾，保证会话身份、`dirty`、草稿与 Gizmo 现场同步释放。

## v0.7.0 Meet / Jump 构造契约

- v0.7.0 只在对称模式的冠部与亭部新建/编辑会话中提供单顶点 Meet 和 Jump。它们是 `create` / `edit` 内的构造子状态，不新增 CUT 第五态；腰部、固定台面、arbitrary 自定义索引、Edge Meet、双 Meet 和全局依赖约束均不在本里程碑范围。
- 构造子状态由 `src/domain/cutSession.js` 所有，并通过 `START_MEET_PICK`、`CANCEL_CONSTRUCTION_TOOL`、`SELECT_MEET_CANDIDATE`、`LOCK_MEET`、`CLEAR_MEET` 与扩展后的 `CHANGE_DRAFT` 更新。`tool` 仅允许 `none | pick-vertex`；候选和已锁 Meet 分开保存，选择候选只预览，必须经显式“锁定 Meet”才能约束深度。
- Meet 顶点只可在显式拾取模式从当前可见、已提交的 base solid 选择；编辑时先排除正在编辑的图层，禁止引用自身、未保存预览或隐藏图层。普通点击、空白点击和相机旋转、缩放、平移不得创建或解除 Meet。
- 锁定 Meet 后，深度滑杆、数字输入、行内深度与 3D 深度杆统一只读；只能通过 `CLEAR_MEET` 明确解除。行业角、`baseIndex`、`repeat`、`mirrorOffset` 变化必须通过统一参数入口重新求解深度；锁定期间禁止切换到 arbitrary 自定义索引。切换区域沿既有规则重建新草稿，并完整清除构造子状态。
- `Escape` 在显式拾取期间只派发 `CANCEL_CONSTRUCTION_TOOL`，退出拾取且保留已有 Meet；再次按下才按原契约取消 CUT 会话。进入光学仿真只暂停构造交互，退出后必须原样恢复构造子状态。
- Jump 只从当前可见、已提交的 base solid 顶点生成，编辑时同样排除活动图层。候选按深度从浅到深稳定排序、按容差去重，同深度使用稳定拓扑键决定代表点；`J` 前进、`Shift+J` 后退，首尾不循环。手动改动 CUT 参数后清除 Jump 候选标记但保留当前深度，下次按键重新计算。
- 未锁定 Meet 时，视口应从当前显式深度实时派生并预告严格更深的“下一点”；预告只显示目标位置、序号、来源和所需深度，不移动切面、不写入 `construction`、历史或文档。点击“下一交点”或按 `J` 后才把该候选深度原子写入草稿；已到末尾时不显示预告。
- Jump 候选统一分类为 `contact-only`（仅接触）、`facet`（形成有效切面）或 `destructive`（产生覆盖影响）。`contact-only` 与求解后零有效面的 Meet 可以浏览、预览和锁定定位，但不得提交；普通 CUT、Jump 与 Meet 共用同一提交前影响评估，不能由 helper 或组件另写近似规则。
- Meet 求解状态必须区分 `valid`、`unreachable`、`stale`、`destructive`。所需深度为负时记录原始 `requiredDepth`，不得压成 0；保留用户新参数与上一次有效深度、隐藏误导性实体预览并显示目标诊断，恢复到可解参数后自动恢复求解。不可达、来源失效、实体为空或结构层整体失效始终硬阻断提交；普通 C/P 层的覆盖影响按下述有效面契约处理。
- Meet 始终绑定 `baseIndex` 对应的主切面；排序后的首面、重复成员和 Mirror 副轨道都不得取代主面。顶点记录稳定 `topologyKey`、来源面/图层标识与来源几何签名，`fallbackWorldPoint` 只用于诊断，来源不匹配时不得据此偷偷恢复有效状态。
- 提交后的 Meet 是构造快照而非实时依赖：显式切面仍是几何真值，来源层变更、隐藏、重排、群组变换或拓扑不匹配不得级联修改已提交切面。重新编辑和导出 PDF 时重新验证来源签名与 Meet 残差；不满足时标记 `stale`，要求重新选择或解除。
- 未锁定的 Jump 只留下最终显式深度，不单独写入文档、JSON 或 PDF。已锁定 Meet 将 `vertex-meet`、solver 版本、目标拓扑键、来源面/图层标识、来源几何签名和诊断坐标作为同层 facet metadata 写入文档并完整 JSON 往返；格式错误必须明确拒绝导入。ASC 只交换最终有效的显式切面，并在导出预检中提示 Meet 构造意图会被省略；PDF 显示有效 Meet 的顶点来源，失效时明确说明当前切面仅以显式参数为准。

## 参数化工序与最终有效面

- `CUT STACK` 保存完整参数化工序；某个面被后续工序覆盖时不得从文档删除。最终有效面必须从完整保存实体派生，因此删除或撤销覆盖它的后续工序后，早先工序的面会自动恢复。临时隐藏只影响视口和 Meet / Jump 可选来源，不改变文档面数、切割指令、PDF 或 ASC。
- 提交评估分为四种结果：新 CUT 零有效面/仅接触时可用于定位但禁止提交；普通 C/P 层部分消面时就地提示但允许提交；普通 C/P 层整体消失时必须在提交前明确确认；实体为空或 T1、G1 等结构层整体失效时硬阻断。确认后的提交与普通提交一样只产生一条文档历史，不得先写入再补确认。
- 面数、切割指令、刻面台账、PDF 与 ASC 只消费最终实体中的有效面；被覆盖面和零有效面的工序不计入、不列出、不导出。JSON 继续完整保存 `CUT STACK`，包括暂时没有有效面的参数化工序。
- 新建冠部与亭部 CUT 的默认深度为 `0.000`，主切面从毛坯支撑位置开始，不应在进入会话时已经切入主体；腰部继续沿用自身结构默认深度。编辑已有层仍恢复其保存深度。

## 全局状态盘点

| 状态 | owner 模块 | 变更入口 | 入文档 | 入撤销历史 |
| --- | --- | --- | --- | --- |
| 文档与 `CUT STACK` | `src/domain/faceting.js` + `src/domain/document.js`（初始化） | `src/App.jsx` 命令模式编排，所有几何变更是一条命令 | 是（JSON 完整往返） | 是 |
| CUT 会话（含 `draft` / `construction` / `group`） | `src/domain/cutSession.js` 状态机，`src/App.jsx` `useReducer` | `dispatchCutSession` 事件 | 否；仅提交后的 Meet metadata 入文档 | 否 |
| 光学物理设置 | 持久化在 `document.metadata.optics`；归一化在 `src/domain/optics.js` | `document/optics` 命令更新；视图实时从文档派生 | 是（metadata） | 是 |
| 光学会话内 UI 态（激活、检查器折叠、观察位、VIEW ONLY 参数） | `src/App.jsx` 本地 state | 显示模式菜单与仿真命令条 | 否 | 否 |
| UI chrome（对话框、预设层、历史/台账面板、抽屉与 `CUT STACK` 折叠、toast） | `src/App.jsx` 与各组件本地 state | 组件自身交互 | 否 | 否 |
| 预设库 provider | `src/domain/presetLibrary.js`（契约）+ 各 provider 实现 | `list / load / 可选 save`；载入经统一文档命令 | 载入结果入文档 | 载入入历史，浏览不入 |
| 本地恢复备份 | `src/domain/localRecovery.js` 与 `useLocalRecovery` | 已提交文档变化后自动备份；恢复沿 `DOCUMENT_IMPORT` 收尾 | 仅文档与材质，不含草稿、相机、旧历史 | 恢复载入作为一次命令 |
| Sites / 构建产物 | `worker/`、`.openai/`、`scripts/prepare-sites-build.mjs` | `npm run build` / `npm run check` | 否 | 否 |

## 边界说明

- 浮层统一隔离底层 CUT 快捷键：刻面表打开时 Escape 只关闭刻面表，J / Shift+J 不改变草稿；对话框管理焦点并在关闭时返回触发控件。
- 光学物理参数与计算参数从 `document.metadata.optics` 读取，通过文档命令更新；载入、撤销和重做自然恢复材质，不保留第二份可漂移的材质 state。VIEW ONLY 参数仅留在会话 UI 中。旧 ASC 的 `refractiveIndex` 与当前 `material.ior` 在领域边界统一兼容，当前字段优先。
- Jump 沿用 `SELECT_MEET_CANDIDATE` 事件；`resolveCutSession(session, { jumpCandidates })` 派生 `canJumpPrevious` / `canJumpNext`，在锁定 Meet、空候选及首尾边界禁用相应操作，按钮与键盘共用能力位。候选分类直接使用领域影响评估，不另做近似判定。
- 文档有效面数不含毛坯面；视口状态分别列出当前有效刻面与残余毛坯面。活动图层显示生成数与实际贡献的有效面数，切割指令只列出有效索引；未形成有效面的草稿以状态文字说明。JSON / ASC / PDF 只导出已提交文档，活动草稿不得被导出动作隐式提交。

- 会话状态永不写入 JSON 或 ASC：保存的是命令作用后的文档，不是编辑过程。唯一例外是提交后附着在显式 facet 上的 Meet 构造快照，它随文档写入 JSON，但不写 ASC，也不构成对来源图层的实时依赖。
- 光学仿真进入/退出只操作会话内 UI 态，不提交、不取消 CUT 会话；退出后按会话对象原样恢复。
- UI chrome 状态可以短暂存在，但不得反向影响文档或会话；快捷键处理必须以这些状态做守卫（如对话框打开时屏蔽 `Escape` 取消 CUT）。
- 新状态若无法归入上表任何一类，先在本文件登记新行并说明 owner 与持久化边界，再写实现。

## 本地恢复（已确认范围）

- 每个页面实例使用独立备份 id，复制标签页、刷新后恢复或在另一页恢复均创建独立副本，不覆盖来源或其他标签页。备份按更新时间排列，不自动清理历史记录；用户可在恢复窗口明确删除选中的备份。
- 只备份已提交文档及物理材质/计算参数，不写入 CUT 草稿、群组预览、相机、VIEW ONLY 参数或撤销历史。新页面的默认空白文档不自动覆盖已有备份。
- 启动发现备份时提示「恢复所选设计 / 开始新设计」，不擅自恢复。文件菜单常驻恢复入口；手动恢复未保存现场前明确说明草稿将被替换。恢复只使用经过同一 JSON 校验器验证的快照，并作为一次可撤销文档替换。
- 已提交文档变更后 300ms 保存，pagehide / 页面隐藏时补写尚未保存的最新文档。读取失败、损坏与写入失败必须明确提示；不得把失败标为成功，也不得悄悄删除损坏记录。失败时提供重试与 JSON 导出。
- OpenGemCutting 备份使用 `opengemcutting:recovery:v1:` 独立命名空间，不读取或删除同源其他应用的存储。
- localStorage 按当前浏览器与 origin 隔离；清理站点数据、使用其他浏览器或改变本地开发端口后不可承诺继续读取原备份。JSON 是长期归档格式，备份不是文件下载。
