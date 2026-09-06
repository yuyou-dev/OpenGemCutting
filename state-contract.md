# 全局状态与 CUT 交互契约

本文件是 Facet 96 编辑器全局状态的单一约定：哪些状态存在、归谁所有、是否进入文档与撤销历史，以及 CUT 交互必须遵守的状态机契约。新增交互或状态前必须先读本文件；长期决策在此登记，`AGENTS.md` 与 `design-system.md` 只引用不重复。

## 开发契约

以下条款是规范性约束，违反的实现不予合入：

- CUT 交互一律经由 `src/domain/cutSession.js` 的事件驱动状态机：组件只调用 `dispatchCutSession` 发送 `CUT_SESSION_EVENT`，不得自行 setState 切换会话身份。
- UI 组件不得自行用 `mode` 推导操作权限或切换会话；操作权限只消费 `resolveCutSession(session)` 返回的能力位（`controlsEnabled`、`showGizmo`、`showCutPlane`、`showNewButton`、`highlightActiveLayer`、`canCancel`、`canPickLayer`、`canChangeRegion`、`canMutateStack`、`canStartGroup`、`canUseMeetJump`、`canJumpPrevious`、`canJumpNext`、`canPickMeetTarget`、`canLockMeet`、`canLockSecondMeet`、`canClearMeetA`、`canClearMeetB`、`canEditEdgeRatio`、`canMarkPreform`、`canCancelConstructionTool`、`depthEditable`、`angleEditable`、`constructionValid`、`exitLabel`）与派生态（`active`、`previewEnabled`、`canCommit`、`activePatternId`、`groupRegion`）。标题和状态文案可展示传入的会话身份，不得据此另建权限判断。
- 按钮与控件的 `disabled` 必须由能力位或派生态驱动，不得在组件内另写与 `CUT_SESSION_TABLE` 平行的条件。
- 新增 CUT 交互的标准流程：新增事件类型 → 在 `CUT_SESSION_TABLE` 评审并声明能力位 → 更新 reducer 转换 → 更新对应契约测试。四步缺一不可。
- 草稿参数（`industryAngle / depth / baseIndex / repeat / mirrorOffset / patternMode / customIndices / preform`）、草稿构造状态 `construction` 与群组参数（`deltaZ / scale / rotationTeeth`）只存在于会话对象的 `draft` / `construction` / `group` 字段，经状态机事件更新。参数 patch 和 Meet 自动求解后的深度必须由同一个 `changeDraftWithConstruction()` 编排入口原子派发到 `CHANGE_DRAFT`，禁止侧栏、行内编辑、Gizmo、分度环或组件本地 state 各自求解；区域默认值只从 `DEFAULT_DRAFT_ANGLES` / `DEFAULT_DRAFT_DEPTHS` / `defaultDraftForRegion` 取得。
- 领域锁定在状态机层强制，而不是只靠 UI 禁用：腰部 `industryAngle` 锁定 `90°` 由 `CHANGE_DRAFT` 直接压回，固定台面 `0°` 同理不依赖控件 disabled。UI 禁用只是配套提示。
- 图层的常显“编辑”按钮、参数／面数兼容入口和视口选层共用 `SELECT_LAYER` 事件与 `canPickLayer` 能力；传给列表的 `canSelectLayers` 仅映射该能力。选中只恢复保存参数和构造，不提交、不改变实体或历史；按钮样式归设计规范。此入口复用既有事件，不创建新的 CUT 状态。
- 提交、取消和文档替换都必须经状态机事件（`COMMIT_SUCCESS` / `CANCEL` / `DOCUMENT_*`）收尾，保证会话身份、`dirty`、草稿与 Gizmo 现场同步释放。

## Meet / Jump 构造契约（v0.7.2 当前规则）

本节是当前唯一构造约定；v0.7.0 单顶点版本的范围限制不再适用，旧 JSON 仍按兼容规则读取。

- 支持冠部／亭部对称及 arbitrary 自定义索引；固定台面／腰部继续不可用。arbitrary 主索引须在当前索引集合中，不能按排序首面代替；移除已锁 Meet 的主索引阻断该编辑并解释原因。
- `construction` 仍为会话唯一构造状态，含 `tool: none | pick-vertex | pick-edge | edit-edge`、`candidate`、`meet` 和仅供取消第二点预览的 `returnDraft`／`returnDirty`。`meet.target` 是 A，`meet.secondTarget` 可选为 B。点可为真实顶点或棱上比例点，比例 0–1，端点按顶点处理；端点身份和比例方向保持稳定。
- `START_MEET_PICK` 接收 `tool`；`SELECT_MEET_CANDIDATE` 接收已统一求解的点、深度与可选行业角。`CHANGE_EDGE_RATIO` 与其复用相同候选转换，但仅针对当前棱候选；`FINISH_EDGE_EDIT` 结束比例编辑。单 Meet 的第二点预览保留 A，并在首次预览时记录 `returnDraft`。不得另建组件参数副本。
- `LOCK_MEET` 显式将候选锁为 A 或 B；`CLEAR_MEET` 的 `slot: A | B | all` 支持解除，解除 A 时将 B 提升为 A，保留当前角度／深度；清除 B 回到 A。解除期间若存在 B 预览，先还原 `returnDraft`。
- `CANCEL_CONSTRUCTION_TOOL` 优先关闭棱编辑器、退出拾取，保留当前候选与参数；其后取消第二点预览并还原单 A 现场；再一次 Escape 才取消 CUT。模态弹窗与光学模式优先于这些事件。
- `CUT_SESSION_TABLE` 明确声明 `angleEditable`、`canPickMeetTarget`、`canLockMeet`、`canLockSecondMeet`、`canClearMeetA/B`、`canEditEdgeRatio`、`canMarkPreform` 等能力；`resolveCutSession` 根据 A/B、候选有效性及部位派生。已失效或不可达的 A 暂停第二点拾取，必须先修复自由参数或解除 A；单点接管深度，双点接管角度和深度，reducer 拒绝未经统一构造求解的锁定参数写入。
- 双 Meet 在固定主分度下解角度和深度；重合点、无唯一角度、超部位解域、负深度与来源失效分别诊断。不可解时保留约束和上次有效被锁参数，允许修改自由参数恢复，阻断提交及误导性预览。
- 无 A 的 Jump 保持按深度排序；单 A 的 Jump 仅枚举可解离散顶点 B，按行业角及稳定拓扑键排序去重、首尾不循环。候选预告不改草稿；Jump 才原子应用候选角度和深度，锁定后成为双 Meet。双 Meet 停止 Jump。枚举不裁切，只有显示／选择的候选按完整轨道分类。
- `M` 锁 A、`B` 锁 B、`V` 切换顶点拾取，`J`／`Shift+J` 前后浏览。输入、textarea、select、contenteditable 及模态状态隔离这些快捷键。
- 编辑来源为该层之前的可见施工阶段；新建来源为全部可见已提交工序。依赖诊断按文档及显隐变化重新派生，不能在连续草稿输入时重建全部阶段。来源不存在、不在前序阶段、隐藏、签名变化或主切面残差超差均标记 stale；已保存显式切面不自动变动，撤销恢复来源时诊断随之恢复。
- 新构造 metadata 使用 `vertex-meet | edge-meet | dual-meet`、solverVersion 2、`target`／可选 `secondTarget` 和 `primaryIndex`；旧 vertex-meet v1 继续读取。普通冠／亭层的 `metadata.preform` 只标记施工用途。所有成员 metadata 一致，经 JSON 统一验证并进入文档历史、备份和报告。
- 试切助理的开关、步骤和前后查看是 UI chrome，仅引用共享施工阶段及诊断，不修改 CUT 会话、文档、相机或历史。

- 通过视口直接选顶点／棱时，只能在显式拾取模式选择；Jump 仍可通过候选事件定位。普通点击、空白点击、相机旋转、缩放和平移不得创建或解除 Meet；禁止引用自身、未保存预览和隐藏来源。
- 草稿的角度、深度、分度、重复、镜像和自定义索引变化统一经过构造求解入口，再原子写入状态机。锁定参数不能由控件直接绕过求解；切换区域沿既有规则重建草稿并清除构造子状态。
- Meet 的几何参考始终是 `baseIndex` 主切面；排序后的首面、重复成员和镜像副轨道都不能取代它。目标携带稳定拓扑身份、来源面／图层及来源几何签名；`fallbackWorldPoint` 只用于诊断，不能在来源不匹配时据此恢复有效。
- 求解状态区分 `valid`、`unreachable`、`stale`、`destructive`。负深度保留原始 `requiredDepth`，不得压成零；不可解时保留约束、自由参数和上次有效被锁参数，隐藏误导性实体预览。恢复到可解参数后重新派生，不静默删除约束。
- 候选影响统一分为 `contact-only`（仅接触）、`facet`（形成有效面）与 `destructive`（覆盖影响）。零有效面的候选可以浏览、预览和锁定，但不能提交；普通 CUT、Jump 与 Meet 共用下面的提交前评估规则，不能由 helper 另写近似判断。
- 已提交拓扑和施工阶段必须复用缓存；候选枚举仅计算解析解、稳定排序与来源，不能同步裁切全部候选。只为当前预告／所选候选按完整重复和镜像轨道计算影响；来源采用施工前缀，最终提交影响仍采用完整工序实体。
- 未锁定的 Jump 只留下显式草稿参数，不单独持久化；提交后才将已锁构造快照写入同层全部 facet metadata。JSON／备份保留构造，PDF 展示来源与比例或明确失效，ASC 预检说明仅交换显式有效切面而丢失构造意图。
- 进入光学仿真只暂停构造交互；退出须恢复原会话及构造状态，不提交、不取消、不写入历史。

## 参数化工序与最终有效面

- `CUT STACK` 保存完整参数化工序；某个面被后续工序覆盖时不得从文档删除。最终有效面必须从完整保存实体派生，因此删除或撤销覆盖它的后续工序后，早先工序的面会自动恢复。临时隐藏只影响视口和 Meet / Jump 可选来源，不改变文档面数、切割指令、PDF 或 ASC。
- 提交评估分为四种结果：新 CUT 零有效面/仅接触时可用于定位但禁止提交；普通 C/P 层部分消面时就地提示但允许提交；普通 C/P 层整体消失时必须在提交前明确确认；实体为空或 T1、G1 等结构层整体失效时硬阻断。确认后的提交与普通提交一样只产生一条文档历史，不得先写入再补确认。
- 面数、切割指令、刻面台账、PDF 与 ASC 只消费最终实体中的有效面；被覆盖面和零有效面的工序不计入、不列出、不导出。JSON 继续完整保存 `CUT STACK`，包括暂时没有有效面的参数化工序。
- 新建冠部与亭部 CUT 的默认深度为 `0.000`，主切面从毛坯支撑位置开始，不应在进入会话时已经切入主体；腰部继续沿用自身结构默认深度。编辑已有层仍恢复其保存深度。

## 全局状态盘点

| 状态 | owner 模块 | 变更入口 | 入文档 | 入撤销历史 |
| --- | --- | --- | --- | --- |
| 文档与 `CUT STACK` | `src/WorkbenchEditor.jsx` 命令历史；`src/domain/faceting.js` 与 `src/domain/document.js` 提供领域操作和初始化 | `WorkbenchEditor` 命令编排，所有几何变更是一条命令 | 是（JSON 完整往返） | 是 |
| CUT 会话（含 `draft` / `construction` / `group`） | `src/domain/cutSession.js` 状态机，`src/WorkbenchEditor.jsx` `useReducer` | `dispatchCutSession` 事件 | 否；仅提交后的 Meet metadata 入文档 | 否 |
| 光学物理设置 | 持久化在 `document.metadata.optics`；归一化在 `src/domain/optics.js` | `document/optics` 命令更新；视图实时从文档派生 | 是（metadata） | 是 |
| 光学会话内 UI 态（激活、检查器折叠、观察位、VIEW ONLY 参数） | `src/WorkbenchEditor.jsx` 本地 state | 显示模式菜单、仿真命令条与画布视角条 | 否 | 否 |
| 编辑器 UI chrome（对话框、预设层、历史/台账面板、抽屉与 `CUT STACK` 折叠、toast） | `src/WorkbenchEditor.jsx` 与各组件本地 state | 组件自身交互 | 否 | 否 |
| 页面与当前项目身份 | `src/App.jsx` | 主页／编辑／实验室导航、新建与打开项目；切换前处理未保存预览 | 否；项目 id 在项目库中独立保存 | 否 |
| 本地项目库与保存反馈 | `src/domain/projectLibrary.js`、`src/components/useProjects.js`；`src/App.jsx` 编排自动保存 | 当前编辑器单向传出已提交快照，按项目 id 保存 | 保存文档与物理材质／计算参数；不含会话、相机、VIEW ONLY 参数和历史 | 保存不入历史；打开项目建立新的编辑器历史 |
| 预设库 provider | `src/domain/presetLibrary.js`（契约）+ 各 provider 实现 | `list / load / 可选 save`；载入经统一文档命令 | 载入结果入文档 | 载入入历史，浏览不入 |
| 旧本地恢复记录 | `src/domain/localRecovery.js` 与 `useLocalRecovery` | 兼容读取、显式删除与恢复；不再自动写入，恢复沿 `DOCUMENT_IMPORT` 收尾 | 载入旧文档与材质，不含草稿、相机、旧历史 | 恢复载入作为一次命令 |
| Sites / 构建产物 | `worker/`、`.openai/`、`scripts/prepare-sites-build.mjs` | `npm run build` / `npm run check` | 否 | 否 |

## 边界说明

- 浮层统一隔离底层 CUT 快捷键：刻面表打开时 Escape 只关闭刻面表，J / Shift+J 不改变草稿；对话框管理焦点并在关闭时返回触发控件。
- 光学物理参数与计算参数从 `document.metadata.optics` 读取，通过文档命令更新；载入、撤销和重做自然恢复材质，不保留第二份可漂移的材质 state。VIEW ONLY 参数仅留在会话 UI 中。旧 ASC 的 `refractiveIndex` 与当前 `material.ior` 在领域边界统一兼容，当前字段优先。
- Jump 沿用 `SELECT_MEET_CANDIDATE` 事件；`resolveCutSession(session, { jumpCandidates })` 派生 `canJumpPrevious` / `canJumpNext`，在双 Meet 锁定、空候选及首尾边界禁用相应操作；单 A 锁定时继续按角度浏览第二点候选，按钮与键盘共用能力位。候选分类直接使用领域影响评估，不另做近似判定。
- 文档有效面数不含毛坯面；视口状态分别列出当前有效刻面与残余毛坯面。活动图层显示生成数与实际贡献的有效面数，切割指令只列出有效索引；未形成有效面的草稿以状态文字说明。JSON / ASC / PDF 只导出已提交文档，活动草稿不得被导出动作隐式提交。

- 会话状态永不写入 JSON 或 ASC：保存的是命令作用后的文档，不是编辑过程。唯一例外是提交后附着在显式 facet 上的 Meet 构造快照，它随文档写入 JSON，但不写 ASC，也不构成对来源图层的实时依赖。
- 光学仿真进入/退出只操作会话内 UI 态，不提交、不取消 CUT 会话；退出后按会话对象原样恢复。
- UI chrome 状态可以短暂存在，但不得反向影响文档或会话；快捷键处理必须以这些状态做守卫（如对话框打开时屏蔽 `Escape` 取消 CUT）。
- 新状态若无法归入上表任何一类，先在本文件登记新行并说明 owner 与持久化边界，再写实现。

## 旧本地恢复记录（兼容范围）

- v0.8.0 以前的恢复记录按页面实例独立保存；当前版本保留读取与显式恢复，不再创建或更新这类备份。列表按原保存时间排列，不自动清理；用户仍可明确删除选中的旧备份。
- 旧记录只包含已提交文档及物理材质／计算参数，不含 CUT 草稿、群组预览、相机、VIEW ONLY 参数或撤销历史。恢复会替换当前项目的文档并进入该项目的自动保存，不覆盖来源备份。
- v0.8.0 启动进入项目主页，旧备份按下方迁移约定列为项目，不擅自打开设计。文件菜单常驻恢复入口；手动恢复未保存现场前明确说明草稿将被替换。恢复只使用经过同一 JSON 校验器验证的快照，并作为一次可撤销文档替换。
- 旧记录读取失败、损坏或删除失败必须明确提示，不得悄悄删除损坏记录。当前项目的自动保存与失败处理遵守下节约定。
- localStorage 按当前浏览器与 origin 隔离；清理站点数据、使用其他浏览器或改变本地开发端口后不可承诺继续读取原备份。JSON 是长期归档格式，备份不是文件下载。

## v0.8.0 项目与页面

- 应用页面为主页、切型编辑、光学实验室，归 `src/App.jsx` 的页面 chrome；启动进入主页。页面导航不属于 CUT 会话，也不改变几何、提交/取消草稿或写入撤销历史。
- 当前编辑器保持挂载；去主页或实验室只暂停绘制、拾取与键盘事件，返回同一项目恢复原 CUT、Meet、相机与历史。切换到另一项目或新建项目才建立独立编辑器；若当前存在未保存预览，先明确保留当前现场或放弃预览后切换。
- 当前文档仍只归 `WorkbenchEditor` 的命令历史；项目列表读取单向传出的已提交快照，不反向修改编辑会话。项目打开后只以初始文档初始化历史，不能把自动保存后的列表更新重新灌入编辑器。
- 本地项目以稳定项目 id 独立存储，保存仅含已提交文档及物理材质／计算参数，300ms 合并写入，页面导航、切换项目、pagehide 与页面隐藏时冲刷待保存快照；持久化失败明确显示并保留内存中的设计、重试与 JSON 导出入口，不显示保存成功，不因失败切换到另一项目。
- 旧恢复记录按稳定来源 id 一次迁入项目；保留原备份，删除项目不重新迁回。新项目不再写入旧恢复记录；文件菜单继续提供旧备份的显式恢复。项目存储与旧恢复均按浏览器 origin 隔离，JSON 继续是长期归档格式。
- 右侧两个正交视图直接读取主视口的 `displaySolid`，包括当前新建、编辑或群组预览及显隐结果；上图冠部/亭部切换仅改变该预览的 top/bottom 观察位，下图固定 side。预览不提供 CUT 拾取或相机交互，不重新计算另一份切割状态。
- 光学实验室在本里程碑只提供导航、当前项目名称及空白三栏骨架；不生成实验结果。现有聚焦光学仿真继续保留显示菜单入口及原有挂起/恢复边界。

- OpenGemCutting 项目、迁移标记与旧备份分别使用 `opengemcutting:project:v1:`、`opengemcutting:project-migration:v1:`、`opengemcutting:recovery:v1:` 独立命名空间，不读取或删除同源其他应用的存储。
