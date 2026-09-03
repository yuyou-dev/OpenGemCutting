# 全局状态与 CUT 交互契约

本文件是 Facet 96 编辑器全局状态的单一约定：哪些状态存在、归谁所有、是否进入文档与撤销历史，以及 CUT 交互必须遵守的状态机契约。新增交互或状态前必须先读本文件；长期决策在此登记，`AGENTS.md` 与 `design-system.md` 只引用不重复。

## 开发契约

以下条款是规范性约束，违反的实现不予合入：

- CUT 交互一律经由 `src/domain/cutSession.js` 的事件驱动状态机：组件只调用 `dispatchCutSession` 发送 `CUT_SESSION_EVENT`，不得自行 setState 切换会话身份。
- UI 组件不得自行判断 `mode` 分支渲染逻辑；只消费 `resolveCutSession(session)` 返回的能力位（`controlsEnabled`、`showGizmo`、`showCutPlane`、`showNewButton`、`highlightActiveLayer`、`canCancel`、`canPickLayer`、`canChangeRegion`、`canMutateStack`、`canStartGroup`）与派生态（`active`、`previewEnabled`、`canCommit`、`activePatternId`、`groupRegion`）。
- 按钮与控件的 `disabled` 必须由能力位或派生态驱动，不得在组件内另写与 `CUT_SESSION_TABLE` 平行的条件。
- 新增 CUT 交互的标准流程：新增事件类型 → 在 `CUT_SESSION_TABLE` 评审并声明能力位 → 更新 reducer 转换 → 更新对应契约测试。四步缺一不可。
- 草稿参数（`industryAngle / depth / baseIndex / repeat / mirrorOffset / patternMode / customIndices`）与群组参数（`deltaZ / scale / rotationTeeth`）只存在于会话对象的 `draft` / `group` 字段，经 `CHANGE_DRAFT` / `CHANGE_GROUP` 携带 patch 合并并置 `dirty`。禁止在组件层另建平行的参数 state；区域默认值只从 `DEFAULT_DRAFT_ANGLES` / `DEFAULT_DRAFT_DEPTHS` / `defaultDraftForRegion` 取得。
- 领域锁定在状态机层强制，而不是只靠 UI 禁用：腰部 `industryAngle` 锁定 `90°` 由 `CHANGE_DRAFT` 直接压回，固定台面 `0°` 同理不依赖控件 disabled。UI 禁用只是配套提示。
- 提交与取消都必须经状态机事件（`COMMIT_SUCCESS` / `CANCEL` / `DOCUMENT_*` / `ACTIVE_LAYER_REMOVED`）收尾，保证会话身份、`dirty`、草稿与 Gizmo 现场同步释放。

## 全局状态盘点

| 状态 | owner 模块 | 变更入口 | 入文档 | 入撤销历史 |
| --- | --- | --- | --- | --- |
| 文档与 `CUT STACK` | `src/domain/faceting.js` + `src/domain/document.js`（初始化） | `src/App.jsx` 命令模式编排，所有几何变更是一条命令 | 是（JSON 完整往返） | 是 |
| CUT 会话（含 `draft` / `group`） | `src/domain/cutSession.js` 状态机，`src/App.jsx` `useReducer` | `dispatchCutSession` 事件 | 否 | 否 |
| 光学物理设置 | 持久化在 `document.metadata.optics`；归一化在 `src/domain/optics.js` | `src/App.jsx` 的 `opticsSettings`，导出/保存时写回 metadata | 是（metadata） | 随文档命令 |
| 光学会话内 UI 态（激活、检查器折叠、观察位、VIEW ONLY 参数） | `src/App.jsx` 本地 state | 显示模式菜单与仿真命令条 | 否 | 否 |
| UI chrome（对话框、预设层、历史/台账面板、抽屉与 `CUT STACK` 折叠、toast） | `src/App.jsx` 与各组件本地 state | 组件自身交互 | 否 | 否 |
| 预设库 provider | `src/domain/presetLibrary.js`（契约）+ 各 provider 实现 | `list / load / 可选 save`；载入经统一文档命令 | 载入结果入文档 | 载入入历史，浏览不入 |
| Sites / 构建产物 | `worker/`、`.openai/`、`scripts/prepare-sites-build.mjs` | `npm run build` / `npm run check` | 否 | 否 |

## 边界说明

- 会话状态永不写入 JSON 或 ASC：保存的是命令作用后的文档，不是编辑过程。
- 光学仿真进入/退出只操作会话内 UI 态，不提交、不取消 CUT 会话；退出后按会话对象原样恢复。
- UI chrome 状态可以短暂存在，但不得反向影响文档或会话；快捷键处理必须以这些状态做守卫（如对话框打开时屏蔽 `Escape` 取消 CUT）。
- 新状态若无法归入上表任何一类，先在本文件登记新行并说明 owner 与持久化边界，再写实现。
