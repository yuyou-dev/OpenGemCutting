# 全局状态与 CUT 交互契约

本文件是 Facet 96 编辑器全局状态的单一约定：哪些状态存在、归谁所有、是否进入文档与撤销历史，以及 CUT 交互必须遵守的状态机契约。新增交互或状态前必须先读本文件；长期决策在此登记，其他文档按 [文档索引](../README.md) 引用此处规则。

## 开发契约

以下条款是规范性约束，违反的实现不予合入。新增状态先登记 owner 与持久化边界，再写实现。CUT 只有 idle / create / edit / group 四态，视口模式不增加 CUT 状态。

- CUT 交互一律经由 `src/domain/cutSession.js` 的事件驱动状态机：组件只调用 `dispatchCutSession` 发送 `CUT_SESSION_EVENT`，不得自行 setState 切换会话身份。
- UI 组件不得自行用 `mode` 推导操作权限或切换会话；操作权限只消费 `resolveCutSession(session)` 返回的能力位（`controlsEnabled`、`showGizmo`、`showCutPlane`、`showNewButton`、`highlightActiveLayer`、`canCancel`、`canPickLayer`、`canChangeRegion`、`canMutateStack`、`canStartGroup`、`canUseMeetJump`、`canJumpPrevious`、`canJumpNext`、`canPickMeetTarget`、`canLockMeet`、`canLockSecondMeet`、`canClearMeetA`、`canClearMeetB`、`canEditEdgeRatio`、`canMarkPreform`、`canEditParameterGroups`、`canCancelConstructionTool`、`depthEditable`、`angleEditable`、`constructionValid`、`exitLabel`）与派生态（`active`、`previewEnabled`、`canCommit`、`activePatternId`、`groupRegion`）。标题和状态文案可展示传入的会话身份，不得据此另建权限判断。
- 按钮与控件的 `disabled` 必须由能力位或派生态驱动，不得在组件内另写与 `CUT_SESSION_TABLE` 平行的条件。
- 新增 CUT 交互的标准流程：新增事件类型 → 在 `CUT_SESSION_TABLE` 评审并声明能力位 → 更新 reducer 转换 → 更新对应契约测试。四步缺一不可。
- 草稿参数（`industryAngle / depth / indexTeeth / baseIndex / repeat / mirrorOffset / patternMode / customIndices / preform`）、草稿构造状态 `construction` 与群组参数（`deltaZ / scale / rotationTeeth`）只存在于会话对象的 `draft` / `construction` / `group` 字段，经状态机事件更新。参数 patch 和 Meet 自动求解后的深度必须由同一个 `changeDraftWithConstruction()` 编排入口原子派发到 `CHANGE_DRAFT`，禁止侧栏、行内编辑、Gizmo、分度环或组件本地 state 各自求解；区域默认值只从 `DEFAULT_DRAFT_ANGLES` / `DEFAULT_DRAFT_DEPTHS` / `defaultDraftForRegion` 取得。
- 领域锁定在状态机层强制，而不是只靠 UI 禁用：腰部 `industryAngle` 锁定 `90°` 由 `CHANGE_DRAFT` 直接压回，固定台面 `0°` 同理不依赖控件 disabled。UI 禁用只是配套提示。
- 图层的常显“编辑”按钮、参数／面数兼容入口和视口选层共用 `SELECT_LAYER` 事件与 `canPickLayer` 能力；传给列表的 `canSelectLayers` 仅映射该能力。选中只恢复保存参数和构造，不提交、不改变实体或历史；按钮样式归设计规范。此入口复用既有事件，不创建新的 CUT 状态。
- 实时 CUT 的 helper 与实体预览必须使用同一版草稿；不得只延后实体派生而显示新参数的机械臂。缓存只复用输入未变的计算，不跳过当前草稿的提交检查。复杂度、容差边界与复测方法见 [CUT 性能](../cut-performance.md)。
- cube 的索引／批量求交用于瞬时预览与影响预告；提交、保存实体、Meet 来源、施工前缀及逐刀回放保留原顺序精确内核，不能引用预览顶点作为持久化来源。mesh 的预览与保存均使用保孔洞的索引内核，提交仍验证完整工序；报告消费已提交真实实体。
- 提交、取消和文档替换都必须经状态机事件（`COMMIT_SUCCESS` / `CANCEL` / `DOCUMENT_*`）收尾，保证会话身份、`dirty`、草稿与 Gizmo 现场同步释放。
- 完整文件入口（JSON、预设、ASC、旧备份恢复）先校验，再由 App 创建独立项目；原项目和底胚保留。有未保存预览时统一经 switchProject / pendingSwitch 确认，取消保留完整现场。

## CUT 会话转换与群组变换

- 主页普通新建项目和新建 CUT 立即显示草稿切面；mesh 导入例外见下节。空闲态切换区域只改变筛选；新建或编辑中切换区域会退出当前会话并以新区域默认值开始草稿，已有图层不改区域、不被删除。
- 选择已保存图层只恢复参数和构造，仍显示活动主切面与 Gizmo；参数实际变化前保持已提交实体，变化后才派生未保存预览。保存编辑在原序列位置替换图层。
- 新建或编辑保存成功后退出编辑并释放 Gizmo；只有用户主动选择已保存层才重新进入编辑。新建状态条与新增按钮共用区域标签下方的位置；编辑的放弃／保存放在当前图层行内。入口移动只复用既有提交、取消与能力位，不改变历史或保护条件。区域标签下方、列表上方的新建入口由 `showNewButton` 驱动，仅在无已有层编辑、无未保存草稿且无群组会话时出现。
- 冠部整体升降连同固定台面沿世界 Z 轴移动；亭部只作用于全部亭部层。台面原有的单层深度编辑保持不变。
- 群组“整体变换”在一次预览与一次撤销中组合 `ΔZ`、以腰线为基准的世界 Z 轴高度比例和当前设计分度盘对应的旋转。冠部包含固定台面；比例必须大于零。所有目标层同步重算行业角、深度和裁切平面，保持重复、镜像、层序和拓扑关系；旋转先将当前盘齿数转换为统一角度，再按每层 `indexTeeth` 重算 `baseIndex/index`；固定水平台面不旋转。允许覆盖腰部与先前层，只有最终无效实体阻断。
- 切型名称属于 `document.name` 文档元数据；命令条以 `Enter` 或失焦提交、`Escape` 取消，经过统一文档命令进入撤销/重做。输入键盘事件不得冒泡影响 CUT 会话；JSON、ASC、PDF 文件名和报告标题均读取此字段。

## 初始晶体与 CUT 的独立契约（v0.9.0）

- `document.stock` 是不可变初始晶体，`document.facets` 是已提交 CUT 参数；最终实体由共享 `documentGeometry.evaluateDocument` 派生：平切结果与启用凹切工具的差集；平切约束只依赖原始底胚和平切工序。撤销历史共享 stock，不在每次拖动或保存时复制网格；BVH、视图遮挡与 GPU 缓存只属于派生数据。
- 普通新建与清除保持立方体 + 固定 T1 / 默认 G1。OBJ 导入是 App 管理的新项目流程：选择文件、单位、轴向与几何预检只影响对话框；确认创建 mesh 文档，初始 CUT 为 0，`activate` 不创建默认草稿。当前项目与未保存预览继续遵守 `switchProject` / `pendingSwitch`，取消不修改旧现场。
- mesh 项目的“清除切割”只清除 CUT，保留同一 stock，在统一文档命令中写入一次撤销；不自动补台面或腰部。没有新增 CUT 第五态。底胚仅在项目创建时确定，创建后禁止替换或缩放；平切与凹切组各自保留。
- mesh 使用导入时固定的机台包络作为深度零位；重复／镜像只生成指令，空切成员可存在，但提交仍须至少一个有效 CUT 平面。一个 `facetId` 的多个面片只统计一个有效刻面；原石面片单独统计，不成为工序。
- 群组整体变换通过 `resolveGroupReference` 从固定机台设计包络与完整平切参数计算腰线上下沿、冠高和亭深，忽略实体底胚与凹切。没有有效平切腰面时以固定机台赤道为基准，不能回退到毛坯顶部。网页操纵器与 application 共用此参考；群组只改目标 CUT，实时显示再与原 stock、concaveCuts 组合。覆盖腰部不阻断，最终无效实体仍阻断。
- 真实可选棱排除同来源共面三角剖分内缝；Meet 来源失效仍显式 stale，不按最近坐标偷偷续接。旧 cube Meet v1 身份兼容不变。
- JSON v2 保存 mesh 原石与完整 CUT；cube JSON v1 继续往返。项目保存与恢复使用同一校验器。mesh ASC 明确阻断，不能输出丢失原石的替代凸形；PDF 与光学消费真实网格。
- mesh 的普通 CUT／Meet／Jump 影响检查与实际裁切共用按实体尺度计算的几何容差；只有源实体和完整平面序列一致时才可复用结果。cube 的既有影响检查容差与精确保存入口保持不变。

## Meet / Jump 构造契约

当前支持顶点、棱比例点与双 Meet，兼容旧单顶点 JSON。

- 支持冠部／亭部对称及 arbitrary 自定义索引；固定台面／腰部继续不可用。arbitrary 主索引须在当前索引集合中，不能按排序首面代替；移除已锁 Meet 的主索引阻断该编辑并解释原因。
- `construction` 仍为会话唯一构造状态，含 `tool: none | pick-vertex | pick-edge | edit-edge`、`candidate`、`meet` 和仅供取消第二点预览的 `returnDraft`／`returnDirty`。`meet.target` 是 A，`meet.secondTarget` 可选为 B。点可为真实顶点或棱上比例点，比例 0–1，端点按顶点处理；端点身份和比例方向保持稳定。
- `START_MEET_PICK` 接收 `tool`；`SELECT_MEET_CANDIDATE` 接收已统一求解的点、深度与可选行业角。`CHANGE_EDGE_RATIO` 与其复用相同候选转换，但仅针对当前棱候选；`FINISH_EDGE_EDIT` 结束比例编辑。单 Meet 的第二点预览保留 A，并在首次预览时记录 `returnDraft`。不得另建组件参数副本。
- `LOCK_MEET` 显式将候选锁为 A 或 B；`CLEAR_MEET` 的 `slot: A | B | all` 支持解除，解除 A 时将 B 提升为 A，保留当前角度／深度；清除 B 回到 A。解除期间若存在 B 预览，先还原 `returnDraft`。
- `CANCEL_CONSTRUCTION_TOOL` 优先关闭棱编辑器、退出拾取，保留当前候选与参数；其后取消第二点预览并还原单 A 现场；再一次 Escape 才取消 CUT。模态弹窗、光学仿真与切割助手模式优先于这些事件。
- `CUT_SESSION_TABLE` 明确声明 `angleEditable`、`canPickMeetTarget`、`canLockMeet`、`canLockSecondMeet`、`canClearMeetA/B`、`canEditEdgeRatio`、`canMarkPreform` 等能力；`resolveCutSession` 根据 A/B、候选有效性及部位派生。已失效或不可达的 A 暂停第二点拾取，必须先修复自由参数或解除 A；单点接管深度，双点接管角度和深度，reducer 拒绝未经统一构造求解的锁定参数写入。
- 双 Meet 在固定主分度下解角度和深度；重合点、无唯一角度、超部位解域、负深度与来源失效分别诊断。求解状态区分 `valid`、`unreachable`、`stale`、`destructive`。负深度保留原始 `requiredDepth`，不得压成零；不可解时保留约束、自由参数和上次有效被锁参数，允许修改自由参数恢复，阻断提交并隐藏误导性预览，不静默删约束。
- 无 A 的 Jump 保持按深度排序；单 A 的 Jump 仅枚举可解离散顶点 B，按行业角及稳定拓扑键排序去重、首尾不循环。候选预告不改草稿；Jump 才原子应用候选角度和深度，锁定后成为双 Meet。双 Meet 停止 Jump。`resolveCutSession(session, { jumpCandidates })` 派生前后步进能力，空候选和首尾边界禁用对应操作，按钮与键盘共用能力位。
- `M` 锁 A、`B` 锁 B、`V` 切换顶点拾取，`J`／`Shift+J` 前后浏览。输入、textarea、select、contenteditable 及模态状态隔离这些快捷键。
- 编辑来源为该层之前的可见施工阶段；新建来源为全部可见已提交工序。依赖诊断按文档及显隐变化重新派生，不能在连续草稿输入时重建全部阶段。来源不存在、不在前序阶段、隐藏、签名变化或主切面残差超差均标记 stale；已保存显式切面不自动变动，撤销恢复来源时诊断随之恢复。
- 新构造 metadata 使用 `vertex-meet | edge-meet | dual-meet`、solverVersion 2、`target`／可选 `secondTarget` 和 `primaryIndex`；旧 vertex-meet v1 继续读取。普通冠／亭层的 `metadata.preform` 只标记施工用途。所有成员 metadata 一致，经 JSON 统一验证并进入文档历史、项目保存和报告。
- 试切助理的开关、步骤和前后查看是 UI chrome，仅引用共享施工阶段及诊断，不修改 CUT 会话、文档、相机或历史。
- 通过视口直接选顶点／棱时，只能在显式拾取模式选择；Jump 仍可通过候选事件定位。普通点击、空白点击、相机旋转、缩放和平移不得创建或解除 Meet；禁止引用自身、未保存预览和隐藏来源。
- 草稿的角度、深度、分度、重复、镜像和自定义索引变化统一经过构造求解入口，再原子写入状态机。锁定参数不能由控件直接绕过求解；切换区域沿既有规则重建草稿并清除构造子状态。
- Meet 的几何参考始终是 `baseIndex` 主切面；排序后的首面、重复成员和镜像副轨道都不能取代它。目标携带稳定拓扑身份、来源面／图层及来源几何签名；`fallbackWorldPoint` 只用于诊断，不能在来源不匹配时据此恢复有效。
- 候选影响统一分为 `contact-only`（仅接触）、`facet`（形成有效面）与 `destructive`（覆盖影响）。零有效面的候选可以浏览、预览和锁定，但不能提交；普通 CUT、Jump 与 Meet 共用下面的提交前评估规则，不能由 helper 另写近似判断。
- 已提交拓扑和施工阶段必须复用缓存；候选枚举仅计算解析解、稳定排序与来源，不能同步裁切全部候选。只为当前预告／所选候选按完整重复和镜像轨道计算影响；来源采用施工前缀，最终提交影响仍采用完整工序实体。
- 未锁定的 Jump 只留下显式草稿参数，不单独持久化；提交后才将已锁构造快照写入同层全部 facet metadata。JSON／项目保存保留构造，旧备份继续兼容读取，PDF 展示来源与比例或明确失效，ASC 预检说明仅交换显式有效切面而丢失构造意图。

## 参数化工序与最终有效面

- `CUT STACK` 保存完整参数化工序；某个面被后续工序覆盖时不得从文档删除。最终有效面必须从完整保存实体派生，因此删除或撤销覆盖它的后续工序后，早先工序的面会自动恢复。临时隐藏影响视口、Meet / Jump 来源诊断和切割助手序列，不改变文档有效面、切割指令或 ASC；PDF 几何与面表仍按完整文档输出，构造来源诊断可以反映当前隐藏状态。
- 提交策略由 `resolveDraftCommitPolicy` 统一：无效几何或空实体为 block；新 CUT 零有效面/仅接触为 block；已保存但被覆盖层的编辑可显式允许 no-op；任何层（包括 T1、G1）被部分或全部覆盖为 warn，保存一条历史命令。覆盖参数保留，不再出现整层消面确认。
- 面数、切割指令、刻面台账、PDF 与 ASC 只消费最终实体中的有效面；被覆盖面和零有效面的工序不计入、不列出、不导出。JSON 继续完整保存 `CUT STACK`，包括暂时没有有效面的参数化工序。
- 新建冠部与亭部 CUT 的默认深度为 `0.000`，主切面从毛坯支撑位置开始，不应在进入会话时已经切入主体；腰部继续沿用自身结构默认深度。编辑已有层仍恢复其保存深度。

## 全局状态盘点

| 状态 | owner 模块 | 变更入口 | 入文档 | 入撤销历史 |
| --- | --- | --- | --- | --- |
| 初始晶体导入对话框 | `src/App.jsx` 与 `CrystalImportDialog`，`stockGeometry` 负责预检 | 文件、单位、轴向；确认沿项目切换流程创建独立项目 | 仅确认后的 stock 和源尺寸入新文档 | 导入新项目不修改原项目历史 |
| 文档与 `CUT STACK` | `src/WorkbenchEditor.jsx` 命令历史；`src/domain/faceting.js` 与 `src/domain/document.js` 提供领域操作和初始化 | `WorkbenchEditor` 命令编排，所有几何变更是一条命令 | 是（JSON 完整往返） | 是 |
| CUT 会话（含 `draft` / `construction` / `group`） | `src/domain/cutSession.js` 状态机，`src/WorkbenchEditor.jsx` `useReducer` | `dispatchCutSession` 事件 | 否；仅提交后的 Meet metadata 入文档 | 否 |
| 光学物理设置 | 持久化在 `document.metadata.optics`；归一化在 `src/domain/optics.js` | `document/optics` 命令更新；视图实时从文档派生 | 是（metadata） | 是 |
| 光学会话内 UI 态（检查器折叠、参数页签、观察位、VIEW ONLY 参数） | `src/WorkbenchEditor.jsx` 本地 state | 显示模式菜单、仿真命令条与画布视角条 | 否 | 否 |
| 光学视口会话（GPU 后端、表面预览模式、细化与采样进度） | `src/components/OpticsViewport.jsx` 本地 state 与渲染器 | 表面模式切换组；后端初始化失败自动回退；观察输入 | 否 | 否 |
| 视口模式 `viewportMode`（edit / assistant / optics）与切割助手步进位置 | `src/WorkbenchEditor.jsx` 本地 state | 画布左上视口模式切换组、助手命令条；显示模式菜单保留光学入口 | 否 | 否 |
| 图层临时显隐 | `src/WorkbenchEditor.jsx` 的 `hiddenPatternIds` | 图层显隐按钮；文档替换时清空 | 否 | 否 |
| 编辑器 UI chrome（对话框、历史/台账面板、抽屉与 `CUT STACK` 折叠、toast） | `src/WorkbenchEditor.jsx` 与各组件本地 state | 组件自身交互 | 否 | 否 |
| 页面与当前项目身份 | `src/App.jsx` | 主页／编辑／实验室导航、新建与打开项目；切换前处理未保存预览 | 否；项目 id 在项目库中独立保存 | 否 |
| 本地项目库与保存反馈 | `src/domain/projectLibrary.js`、`src/components/useProjects.js`；`src/App.jsx` 编排自动保存 | 当前编辑器单向传出已提交快照，按项目 id 保存 | 保存文档与物理材质／计算参数；不含会话、相机、VIEW ONLY 参数和历史 | 保存不入历史；打开项目建立新的编辑器历史 |
| 预设库 provider | `src/domain/presetLibrary.js`（契约）+ 各 provider 实现 | `list / load / 可选 save`；新建项目弹窗进入；App 载入为独立项目 | 新项目文档 | 不改原项目历史 |
| 旧本地恢复记录 | `src/domain/localRecovery.js` 与 `useLocalRecovery` | 兼容读取、显式删除与恢复；不再自动写入，恢复沿 `DOCUMENT_IMPORT` 收尾 | 载入旧文档与材质，不含草稿、相机、旧历史 | 恢复载入作为一次命令 |
| Sites / 构建产物 | `worker/`、`.openai/`、`scripts/prepare-sites-build.mjs` | `npm run build` / `npm run check` | 否 | 否 |

## 边界说明

- 浮层统一隔离底层 CUT 快捷键：刻面表打开时 Escape 只关闭刻面表，J / Shift+J 不改变草稿；对话框管理焦点并在关闭时返回触发控件。
- 光学物理参数与计算参数从 `document.metadata.optics` 读取，通过文档命令更新；载入、撤销和重做自然恢复材质，不保留第二份可漂移的材质 state。VIEW ONLY 参数仅留在会话 UI 中。旧 ASC 的 `refractiveIndex` 与当前 `material.ior` 在领域边界统一兼容，当前字段优先。
- 文档有效面数不含毛坯面；视口状态分别列出当前有效刻面与残余毛坯面。活动图层显示生成数与实际贡献的有效面数，切割指令只列出有效索引；未形成有效面的草稿以状态文字说明。JSON / ASC / PDF 只导出已提交文档，活动草稿不得被导出动作隐式提交。
- 会话状态永不写入 JSON 或 ASC：保存的是命令作用后的文档，不是编辑过程。唯一例外是提交后附着在显式 facet 上的 Meet 构造快照，它随文档写入 JSON，但不写 ASC，也不构成对来源图层的实时依赖。
- 光学仿真进入/退出只操作会话内 UI 态，不提交、不取消 CUT 会话；退出后按会话对象原样恢复。仿真读取当前可见实体（含新建、脏编辑或群组预览），材质修改仍经文档命令进入历史。
- `viewportMode` 是 WorkbenchEditor 拥有的视图态（edit / assistant / optics），不是 CUT 会话第五态。切割助手套用光学仿真的挂起/恢复边界：序列在进入时从已提交 `CUT STACK` 与 `hiddenPatternIds` 派生（层序、层内索引升序、隐藏层跳过、台面恒 1 步、preform 层照常参与等规则以 `src/domain/cuttingAssistant.js` 为唯一真值），未提交草稿不参与；模式内步进、逐组跳转与进度条只移动观察位置，只读、不写历史、不提交或取消草稿；`Escape` 只退出助手，退出后按会话对象原样恢复编辑现场。
- 助手位置 `p` 表示已完成刀数：实体由 `steps[0..p)` 裁切；`p < total` 的粉色平面来自 `steps[p]`，提示下一刀，`p = total` 不再显示切割平面。每次进入助手从 0 开始；层内按本层连续索引排序，内部 0 在 UI 显示为该层齿数。几何、计数和步进都使用同一回放模块，不从最终有效面数反推刀数。
- UI chrome 状态可以短暂存在，但不得反向影响文档或会话；快捷键处理必须以这些状态做守卫（如对话框打开时屏蔽 `Escape` 取消 CUT）。

## 旧本地恢复记录（兼容范围）

- v0.8.0 以前的恢复记录按页面实例独立保存；当前版本保留读取与显式恢复，不再创建或更新这类备份。列表按原保存时间排列，不自动清理；用户仍可明确删除选中的旧备份。
- 旧记录只包含已提交文档及物理材质／计算参数，不含 CUT 草稿、群组预览、相机、VIEW ONLY 参数或撤销历史。恢复会创建独立项目并由新项目自动保存，保留原项目和来源备份。
- 启动进入项目主页，旧备份按下方迁移约定列为项目，不擅自打开设计。文件菜单常驻恢复入口；手动恢复未保存现场前明确说明草稿将被替换。恢复只使用经过同一 JSON 校验器验证的快照，并创建独立项目，原项目和备份保留。
- 旧记录读取失败、损坏或删除失败必须明确提示，不得悄悄删除损坏记录。当前项目的自动保存与失败处理遵守下节约定。
- localStorage 按当前浏览器与 origin 隔离；清理站点数据、使用其他浏览器或改变本地开发端口后不可承诺继续读取原备份。JSON 是长期归档格式，备份不是文件下载。

## 项目与页面

- 首次访问且没有当前项目、损坏项目或待恢复旧备份时，通过 application 的 `starterProjects` 及既有 preset provider / `projectDesign` 加载 Columbia-Willamette 与 Square Emerald 两份内置琢型，保留原名、来源和完整 CUT。domain `projectLibrary` 写入独立可编辑项目；`facet96:projects-started:v1` 标记完成，删除示例后不补回，已有用户不插入示例。加载期间若用户已新建项目，写入前复查并跳过示例；加载失败显示重试且保留新建入口，不造占位项目。不自动打开示例、不新建 CUT 会话、不改变当前编辑器历史。首页截断、搜索和“全部”仅属展示状态，MCP 仍读取完整项目列表，无新增协议能力。

- 应用页面为主页、切型编辑、实验室，归 `src/App.jsx` 的页面 chrome；启动进入主页。页面导航不属于 CUT 会话，也不改变几何、提交/取消草稿或写入撤销历史。
- 当前编辑器保持挂载；去主页或实验室只暂停绘制、拾取与键盘事件，返回同一项目恢复原 CUT、Meet、相机与历史。切换到另一项目或新建项目才建立独立编辑器；若当前存在未保存预览，先明确保留当前现场或放弃预览后切换。
- 当前文档仍只归 `WorkbenchEditor` 的命令历史；项目列表读取单向传出的已提交快照，不反向修改编辑会话。项目打开后只以初始文档初始化历史，不能把自动保存后的列表更新重新灌入编辑器。
- 本地项目以稳定项目 id 独立存储，保存仅含已提交文档及物理材质／计算参数，300ms 合并写入，页面导航、切换项目、pagehide 与页面隐藏时冲刷待保存快照；持久化失败明确显示并保留内存中的设计、重试与 JSON 导出入口，不显示保存成功，不因失败切换到另一项目。
- 项目记录携带整数 `revision`（记录层字段，不进入文档 JSON；缺失该字段的旧记录读取时按基线 0 升级）。编辑会话在打开项目与每次保存成功后记录读取基线；保存时在 Web Locks（`facet96:project-lock:<id>`，平台不支持时退化为同一同步块）内读取-比较-写入，`expectedRevision` 不一致即抛出 `PROJECT_CONFLICT` 且不改动存储；项目已删除优先报 `PROJECT_DELETED`，旧页不得复活已删记录。
- 冲突后停止自动覆盖：本地待保存设计保留在内存，冲突期间新编辑只更新内存快照、不再自动写库；用户只能经「重新载入最新版本（有本地修改时先确认放弃）／另存为新项目／导出 JSON」解决，不做 CUT、Meet 或几何参数的自动合并。删除类失败在横幅提供「另存为新项目」出口。
- 项目主页提供按项目删除入口，确认框显示准确项目名并说明不可逆；删除活动项目先清理待保存定时器与内存快照再关闭编辑器现场；其他标签页仍打开被删项目时后续保存被 `PROJECT_DELETED` 阻止，只允许另存或导出。保存失败横幅提供重试、导出 JSON 与「管理本地项目」入口。
- 异步文档任务（当前为预设载入）绑定任务身份：请求序号、存活标记与 `AbortSignal` 随弹窗关闭、组件卸载或新请求失效；失效任务的迟到结果不得调用父级提交入口，父级入口在写入前再次校验会话仍有效。读取成功不等于获得修改当前文档的授权。
- 旧恢复记录按稳定来源 id 一次迁入项目；保留原备份，删除项目不重新迁回。新项目不再写入旧恢复记录；文件菜单继续提供旧备份的显式恢复。项目存储与旧恢复均按浏览器 origin 隔离，JSON 继续是长期归档格式。
- 右侧两个正交视图直接读取主视口的 `displaySolid`，包括当前新建、编辑或群组预览及显隐结果；上图冠部/亭部切换仅改变该预览的 top/bottom 观察位，下图固定 side。预览不提供 CUT 拾取或相机交互，不重新计算另一份切割状态。
- 实验室总览与原生容器由 `LabsPage` / `LabWorkspaceHost` 管理；登记归 application/laboratories。开始、恢复或带入前，App 检查 CUT 预览并等待来源项目保存完成，读取确定修订的完整快照；不新增 CUT 状态或自动放弃草稿。宿主仍挂起原编辑现场。
- `domain/labDrafts` 独立保存实验记录、来源快照、模块／契约版本、配方草稿、候选与带回回执。模块仅取得单份实验的 load/save、返回候选和生命周期信号，没有项目库能力。写入经过修订检查与 Web Lock；失败保留内存待存稿和原记录，可下载恢复、另存恢复，不静默覆盖另一窗口。
- `application/labHost` 用 `readLabDocument` 对返回候选重新导入、重算实际几何后保存检查结果。来源项目变更／删除会提示并保留进入快照；带回只创建新项目。持久化候选先固定目标 ID，再创建项目和写回执；重试复用相同目标。返回重复点击合并，失效配方保留实际平面并明确 stale，不自动重放。未支持的关键几何拒绝带回。
- 容器按需导入固定本地模块，未进入不运行图案计算。检查弹窗／后台暂停；退出等待保存，失败保留工作区；卸载和 pagehide 中止信号并释放模块。旧加载／候选回调不能写入新页面。bfcache 恢复重新读取保存实验稿。退出失败可下载完整恢复文件，不承诺浏览器进程被强杀时未落盘内存能恢复。公共语义仍见 [公共契约](../labs/CONTRACT.md)，固定模块由 `src/application/labsModuleLock.json` 锁定，更新与回退只经过交付包校验与宿主联合测试门槛。

### 新建项目的底胚选择

App 持有起点选择弹窗；默认起点、预设琢型、预设底胚和上传 OBJ 共用新建入口；预设琢型打开已有资料浏览层，最终确认后建立独立项目。选择、预览、下载、返回和取消均不创建项目或改动当前 CUT。只有最终确认调用现有 `switchProject`，未保存预览仍经 `pendingSwitch` 确认。默认起点沿用 T1/G1 和空闲会话；四种预设经 `createMeshDocument` 创建独立 mesh 项目，零 CUT、无预切草稿。上传沿用持久预检，可返回选择起点。弹窗期间暂停工作台交互。

## 切割助手播放与观察（1.0）

- `assistantPosition` 仍只计已完成刀数，参数区显示下一刀 `steps[p]`；到末尾显示完成态而不把上一刀伪作下一刀。序列与工序来源规则不变。
- 播放开关、倍速、跟随开关、转场时长归助手 UI，不入文档、历史或 CUT 会话。默认暂停；每次完成一刀后保持原视角 0.5 秒，再转向下一刀，相机实际完成转场后才显示下一刀平面并开始刀前观察计时（1× 为 3 秒）。倍速只改变刀前观察时间；手动上一/下一刀、组跳转与拖动进度均先暂停。末尾停止；从头播放显式回到0。
- 离开助手、离开可见工作台、打开阻断交互的流程或浏览器转入后台均暂停播放；恢复可见不自动重启。手动旋转/缩放暂停播放并退出相机跟随；主动打开跟随后重新对准当前面。
- 助手进入时保存编辑相机，退出时恢复。相机跟随真实当前 CUT 平面方位，水平偏离当前面正向 45°，冠部/腰部俯视 15°、亭部俯视 5°，保持琢型直立与斜侧观察；以最短旋转路径和平滑缓动过渡。减少动态效果偏好使用瞬时定位；相机动画不改切割参数。

### 新外部文件的资源预算（1.0）

文件读取前检查 20 MiB 上限；外部 JSON 在几何构建前检查 4096 CUT 平面、mesh stock 20000 顶点及 20000 面片。OBJ 在解析时限制 4000 源顶点，仍沿用 1000 源多边形及分解后 1000 面片门槛。超限通知不替换当前文档。该预算不改变项目存储恢复与领域 JSON 的兼容规则。异步保存完成只确认它实际写入的快照；期间产生的新待保存快照不能被旧保存清空。

### 琢型试作

`?review=` 打开只读审阅页面；manifest 和参考图片限定同源，JSON 经现有导入校验。视图只从已提交实体生成，切换视图不写项目或历史。下载后在工作台新项目导入是明确的编辑入口；不能通过打开链接暗中替换正在编辑的项目。无 CUT 的 mesh 可审阅其原始晶体。

## 可选本地设计接口（1.0）

- 在线 MCP 只通过已绑定网页的 application 操作入口请求变更；`WorkbenchEditor` 仍是文档和历史的唯一 owner，App 仍管理项目与保存。MCP 不创建平行 CUT 会话。
- 连接会话 id 与项目 id、编辑修订令牌分开。每个写请求必须携带其读取的项目和修订令牌；页面刷新、切换项目、手动编辑或撤销后旧请求失效。读请求可以读取已提交文档，但不能隐式提交草稿。
- 批量方案在隔离计算中逐项预检；完整方案通过后才能作为一次文档命令提交。全部旧层的覆盖允许并返回诊断；空实体、无效几何与零有效新 CUT 阻断。
- 有活动 CUT 会话、隐藏层、模态流程、光学/助手或非编辑页面时，外部文档写入暂停并返回具体原因；设计师结束当前操作后重读状态。MCP 不自动取消手动草稿。
- 网页通过明确的本地连接入口启用桥接，普通静态部署不创建连接、不要求服务端，也不读取 Codex 配置。断开只关闭 AI 请求通路，文档、手动操作、历史与保存保留。

## 界面语言

语言偏好由 `src/i18n/locale.js` 管理，持久化键为 `facet96.language`，不属于设计文档或 CUT 会话。切换语言只通知显示订阅，不重新挂载编辑器，不改变项目 revision、撤销记录、相机、草稿或几何。既有用户命名保持原文。JSON / ASC 参数和序列化格式不依赖语言；PDF 使用显式 locale 快照。`design_read.locale` 反映显示语言，MCP 命令与参数标识保持稳定。

## 光学仿真视图

- GPU 后端（WebGPU 优先，WebGL2 回退）与表面预览模式 `OpticsViewport.surfaceMode`（全抛光／按设计表面）都是视口会话态，不写 document、CUT 会话、历史、JSON 或项目库。退出视口或切换项目后重新进入，回到 WebGPU 优先与全抛光。`?opticsBackend=webgl2` 仅用于诊断，直接使用 WebGL2 后端。
- 异步初始化期间合并最新的实体、材质和相机快照；没有 WebGPU、初始化／绘制失败或 device lost 时，由 React 创建新的 canvas 并切回 WebGL2。相机、观察位、材质和当前实体保留，pointer、wheel、touch 监听重新绑定；WebGL2 使用 context lost/restored 恢复。卸载后到达的异步初始化结果必须释放，不得触发回退或重绘。
- 按设计表面只读取当前文档的逐面 `surfaceFinish`，不派发文档事件；没有有效磨砂面时直接复用全抛光后端与输入。两种模式保留同一相机、材质、灯光和反射次数。
- 观察输入的分辨率细化与采样累积只属于渲染，不写历史或 JSON；退出或资源重建须清理细化定时器。渲染不变量见 [几何契约](geometry-contract.md#光学渲染)。

## 多分度与三组参数

| 状态或数据 | Owner | 持久化与变化 |
| --- | --- | --- |
| 原始底胚 | `document.stock` | 创建时固定；mesh 表示实体底胚，默认 cube 仅为内部设计包络；编辑中禁止替换、缩放 |
| 全部平切工序 | `document.facets` | 每层保存自己的 `indexTeeth` 与连续 index；全部覆切记录保留 |
| 凹切工具 | `document.concaveCuts` | 球形／圆柱／V 形开槽轮／可调尖角三角柱（width、length、tipAngle）、位置、轴向、半径、长度、绕 Z 重复、相位、曲面精度与启用状态 |
| 当前设计分度盘 | `document.indexGear` | 创建时选择，默认 96；换盘进入历史，所有层读数统一换算，实体不变 |
| 凹切图层与刀具 | `ConcavePanel` 调用 application | 右侧常驻平切／凹切入口；可视化添加、选择、启停、删除，深度与整组旋转拖动时预览，释放时一次可撤销提交 |
| 兼容检测范围 | `IndexCompatibilityPanel` | 固定检查完整平切工序；只显示绿／红灯 |
| 布尔结果与兼容报告 | domain 派生 | 仅缓存，不进入 JSON 或历史 |

`canEditParameterGroups` 只在 idle 为 true。导入、撤销/重做以及退出旧层编辑后，空闲会话通过既有 `CHANGE_INDEX_GEAR` 事件同步当前文档齿数，索引偏好保持方位；活动 CUT 使用项目统一分度，活动期间不可换盘。`CHANGE_INDEX_GEAR` 仅允许空闲切换；`START_CREATE` / `CHANGE_REGION` 使用项目当前盘，`SELECT_LAYER` 恢复按项目盘换算后的层参数，不对原层参数取整。新建对话框在选择形状前选择设备盘，默认 96；32、64、72、77、80、84、88、96、99、120、360 为明确展示的检测清单。连续 index 与 1–360 重对称独立于清单。

`PARAMETER_GROUP_TABLE` 描述 stock / planar / concave 三个文件 envelope；`prepareParameterGroupReplacement` 完整验证后返回同一 `document/replace` 命令，网页与 MCP 复用。替换平切不覆盖项目盘、底胚或凹切；底胚替换入口在 application 返回 STOCK_LOCKED，网页无替换或缩放入口。参数导入失败或计算空实体保留原文档。

Meet／Jump 与施工来源诊断始终从原始底胚和平切前缀构造，增删、启停、移动和调整凹切均不得改变其来源身份或有效性。施工回放独立求解平切前缀，再组合凹切显示；它不伪称实际凹切机床刀路。三组在固定机台坐标下的集合结果与编辑先后无关，实际装夹、可达性与加工顺序需另行判断。

撤销／重做作用于本次打开项目的所有已应用参数命令。JSON 保留完整参数工序与凹切工具，但不会保存跨会话命令历史；不能把本次会话撤销承诺为重启后仍可用。重置平切同样进入历史，保留底胚与凹切；立方底胚恢复默认T1/G1平切起点，网格底胚清除平切工序。

凹切不再有模态草稿或手动“预览／应用”步骤。添加预设、修改重复、深度或 phaseDeg 调用 `prepareConcaveTool`，只有实体求值成功才执行文档命令，失败保留已提交设计。临时滑杆不建立 CUT 会话；WorkbenchEditor 持有绑定当前已提交文档的凹切预览，拖动中求值并更新主视图和正交图，期间不写历史或自动保存。释放或键盘调节结束提交一次，Esc／pointercancel 取消；文档替换使旧预览失效。所有网页入口和 MCP 都检查 idle 能力位。兼容灯检查完整平切工序，忽略 stock、concaveCuts 和显示隐藏状态；不要求用户选择检测范围。

### 固定底胚与完整文件导入
新建时未选底胚的工程没有实体底胚，内部 cube 只提供设计包络。`cuttingReference` 属于平切坐标声明；项目创建、保存、冷读、示例初始化及旧备份迁入必须原样保留；新 mesh 工程固定为默认机台坐标，不从底胚形状派生切深。旧文件缺失该声明时沿用原基准以保形，不给旧记录统一补默认参考。已被旧实验版本漏存的字段无法可靠推断，应重新导入完整 JSON 备份。完整 JSON、ASC、琢型预设和恢复记录打开为独立项目，由 App 的 switchProject 处理未保存预览保护，不替换当前项目底胚。参数组能力仅允许替换 planar／concave；stock 仅导出及新建时使用。

### 平切／凹切工作面板

`cuttingMethod`（planar / concave）和 selectedConcaveId 归 WorkbenchEditor，都是视图选择，不入文档或历史。切换不派发 CUT 事件，不建立第五态或复制平切草稿。凹切模式隐藏平切参数、helper、选层及 Meet/Jump/Escape CUT 快捷键，显示已提交平切加凹切实时预览；返回平切恢复原会话、区域及参数。非 idle 的 `canEditParameterGroups` 仍为 false，显示草稿保留提示及返回平切入口；先完成平切再写凹切，保持单一提交会话；凹切不属于 Meet 基底。光学和助手返回后保留所选工作面板。

凹切预览仍以文档引用绑定；切换工作面板或视口模式取消未结束的预览，常规输入失焦先提交。连续角度 `phaseDeg` 绕固定机台 Z 轴整体旋转工具位置和轴向，支持小数并规范化到 [0, 360)，绝不换算成平切齿数。每组凹切独立保存，改一组不改其他组。删除可撤销；没有可误解成关闭面板的叉号，添加入口永久可达。

### 凹切后台预览与光学细化

连续凹切输入由 `concavePreviewScheduler` 调度打包的 worker，复用 application 的 `prepareConcaveTool`，保留完整几何验证。最多一个在途计算和一个最新待算位置，完成结果的实体与刀具共用同一版预览；控件保留最新输入，不能被较早结果倒拨。松手等待或复用准确最终位置，仅提交一次；文档、工作方式或视口切换使旧任务失效，取消与卸载不写历史。正在完成提交时暂时禁用凹切修改并给出短提示。MCP 仍同步调用相同正式能力，不依赖 Worker。

MCP 的只读 Jump 查询由 `application/designJump.js` 编排；草稿解析、单点与双点候选都使用 `getCuttingReference(document)`，与网页和提交入口一致。真实底胚继续提供材料边界，不代替机台坐标。回归见 `projectLibrary.test.js` 与 `designJump.test.js`。

平切面板的“凹切已显示／凹切已隐藏”归 `WorkbenchEditor.showConcaveInPlanar`，只控制编辑视口与正交图。切换不改文档、历史、自动保存、最终面数、报告或导出；进入凹切、切割助手和光学时显示完整组合实体，返回平切保留所选显隐。刀具启用开关仍是可撤销的设计变更，与视图开关区分。

三角柱尺寸输入复用凹切预览调度与单次提交：改变尖角或宽度保持径向切深，长度沿刀具轴向；无效尺寸拒绝写入。网页与 MCP `concave-tool` 共用参数校验和提交。

### 实验室 API 2 升级与保存退出

固定模块 rc.3 使用嵌入布局，宿主独占检查带回入口。保存退出先 pause 取消尚未完成的编辑，再 flush 等待已提交实验稿持久化；失败时恢复工作区，不生成候选或写入来源。rc.1 兼容回退保留原候选式保存边界。跨模块版本的首次成功保存，在同一个实验稿事务的 versionBackups 中保留升级前完整记录；备份失败则不覆盖旧稿。恢复文件包含备份，不能用修改 moduleVersion 的方式把新稿降级。

三维相机仅为视图状态，切割、光学和实验室消费固定 navigation 1.0.0；Gizmo 与对象编辑先处理事件，未消费输入才旋转相机，不修改 CUT 会话、文档或历史。

## 逐面表面处理与切割提醒

`facet.metadata.surfaceFinish` 沿用实验室公共契约；缺省按普通抛光流程处理，不给历史文档批量补字段，不升级格式版本。JSON、项目保存及恢复保留完整记录；表面不改变平面、角度、分度、深度、有效面统计或助手步数。参数编辑对保留的分度方向逐面继承表面，不能把首面属性复制到整组；新增方向缺省抛光，删除成员随原工序撤销可恢复。整体变换保留原面元数据。

助手只从下一刀 `steps[position]` 的来源面派生表面提示，磨砂显示“磨砂切割 · 无需抛光”；混合工序按当前面切换，不把整组误标磨砂，完成态不残留上一刀提醒。提醒只读，不增加 CUT 状态、能力位或历史事件；普通抛光面沿用原布局。光学中的磨砂预览见 [光学仿真视图](#光学仿真视图)。
