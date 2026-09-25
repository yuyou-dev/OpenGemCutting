# 本地对话设计

手动工作台始终可以独立运行。静态部署只需根目录 `npm ci && npm run build`，发布 `dist/client`；不需要安装 MCP、Codex、模型 SDK 或设置 API Key。

## 启用对话创作

设计师从 [一句话安装](../../INSTALL.md) 开始；升级见 [升级入口](../../UPGRADE.md)。统一安装模块为 `setup/`，以下命令仅供开发者了解底层依赖。

在同一版本的仓库中运行：

```sh
npm ci
npm run build
npm ci --prefix mcp
node mcp/server.mjs
```

最后一项是 **stdio MCP 服务端**，由支持 MCP 的客户端启动，不是终端聊天程序。客户端配置的 command 为 `node`，args 为本仓库 `mcp/server.mjs` 的绝对路径。服务端按脚本位置定位同源仓库，不依赖客户端的工作目录。没有 Codex 的用户可以使用其他支持 stdio MCP 的客户端。

Codex 使用 `node setup/cli.mjs install` 完整配置；`mcp/register-codex.mjs` 仅保留同一安装入口的兼容跳转。安装器保留其他 MCP 配置，服务名来自 `setup/product.json`，公开与私有安装可以共存。注册后按客户端要求刷新工具或重新打开任务。仓库本身不包含个人配置。

## 一次完整创作

以下是新建并留档的完整示例，不是每次操作的必经步骤。已有连接可复用；查看和导出只执行相应工具，参数修改只规划、核实受影响结果并提交保存。参考还原的详细方法按需读取 `facet://reference/reference-workflow`。

1. 调用 `workbench_open`，在 Codex 内置浏览器打开返回的完整链接。此链接只连接本机，并携带临时连接凭据，勿对外分享。通过 `design_read` 读到对应网页后再宣布“已连接，可以直接提出设计需求”；普通 dev 页面或仅 HTTP 成功不能替代连接验收。
2. 调用 `workbench_sessions`，选择明确的网页会话；多个页面时根据 `design_read` 的项目识别，不猜测当前标签页。
3. `design_read` 返回项目、revision、可写状态、图层和保存反馈。主页返回 `projectId: none / revision: home`；使用此作用域调用 `project_create`。
4. `preset_list` 搜索网页同一预设库，或使用默认立方体、晶体模板、JSON、OBJ 创建独立项目。
5. `design_plan` 传入有稳定名称的 CUT 组与参数，或 `replace-parameters` 独立替换平面切割或凹面加工参数组（底胚创建后固定）。预检返回 planId、真实变化、完整几何及覆盖面提示，不改当前项目。
6. 用 `design_view` 查看 planId 的顶、底、侧和立体真实投影；用 `design_topology`、`design_inspect` 检查指定连接和施工来源。
7. 在 `design_commit` 中提交同一 planId 和作用域。被覆盖的层继续保留参数，整层覆盖可直接提交；空实体和非法几何仍阻断。提交是一条历史，可从网页或 `design_history` 撤销，撤销后续覆盖工序可恢复早先切面。
8. `project_save` 等待实际浏览器保存。`design_export` 导出完整 JSON 留档；同一接口也可返回矢量 PDF、GemCad ASC 或 Gem Cut Studio GCS。ASC 与 GCS 沿用格式中心的信息损失说明和 mesh／凹切阻断，GCS 另返回保留／简化／丢失报告与读回核对结果（见[格式中心](../architecture/format-center.md)）；网页从文件菜单进入格式中心。

修改后网页立即显示实际 CUT，可用原有参数区继续编辑。网页有手动 CUT 会话、隐藏层、模态流程或光学/助手模式时，对话写入返回原因；先在网页结束该操作，重新读取再规划。对话不会擅自放弃手动草稿。

## 参考构造与结果判断

参考图还原时，先独立记录图像节点和连接，再构造共享平面。`construction_plane` 提供精确整数分度候选和双点平面检查；`design_topology` 的 beforePatternId 返回该组之前的真实顶点与棱，作为 Meet 来源。修改已有带 Meet 的 CUT 时默认保留并重新求解构造；`meet: {clear: true}` 明确解除，不能伪造来源或用最近坐标替代。

`design_inspect` 的有效面数是最终逻辑 CUT 平面数；原石和凹切工具产生的面片不计为平面 CUT。`parameterGroups` 分列三组参数量，`indexCompatibility` 分别报告全部工序与最终有效面的分度兼容性。每组 CUT 的 `indexTeeth` 决定其索引单位，允许小数索引及 1–360 次对称；不因切换分度盘而取整或旋转设计。没有独立参考记录时造型状态为未评估。图片渲染来自真实实体，但不代表实际光学收益、切磨保证或审美通过。

## 断开和保存

网页顶部“断开 AI 连接”只关闭对话入口，手动设计、历史和保存继续可用。服务停止后已打开网页仍能操作。刷新需要静态资源服务可达。

保存位置仍按浏览器 origin 隔离。服务每次使用临时端口，因此跨服务重启请导出 JSON 并重新导入，不能把临时端口的本地项目库当长期跨环境存储。服务不会收集或迁移其他 origin 的设计。

## 排查

| 代码 | 处理 |
| --- | --- |
| RESTART_REQUIRED | 当前版本已更新，先导出设计，再刷新工具或新开项目任务重新连接 |
| NO_SESSION / DISCONNECTED | 打开链接或重新连接，重新列出会话并读状态；不要盲目重放上一次写操作 |
| STALE_REVISION / PLAN_EXPIRED | 网页或设计已变化，重新读取和规划 |
| WORKSPACE_BUSY | 按网页状态结束当前操作，不自动取消草稿 |
| CUT_BLOCKED / EMPTY_SOLID | 根据具体步骤检查新增空切、空实体或非法几何；已保存的覆盖层可以继续修改参数 |
| MEET_UNREACHABLE / TARGET_NOT_FOUND | 读取正确施工前缀并修复自由参数或明确解除构造 |
| SAVE_FAILED | 在网页解决存储错误或冲突，必要时导出 JSON |

参数完整定义由 `src/application/designContract.js` 生成到 `capabilities.json`，也可通过 MCP 的 `facet://capabilities` 读取。开发规则见 [architecture.md](architecture.md)，案例见 [examples.md](examples.md)。

Codex 注册语法以 [官方 MCP 文档](https://developers.openai.com/codex/mcp) 和本机 `codex mcp add --help` 为准。

PDF 返回本机临时下载链接，避免大型字体嵌入对话消息。服务最多保留最近八份报告，停止服务后删除；需要长期保留时及时下载。

## 中英双语

顶栏语言选项控制界面、帮助及默认 PDF 报告语言；`design_read.locale` 返回当前界面语言。`design_export` 的 PDF 可指定 `locale: "en"` 或 `"zh-CN"`，省略则跟随界面。JSON、ASC、GCS、工具名、ID 和参数保持语言无关。对话可用中文或英文提出设计需求；语言切换不清空手动草稿，也不修改设计 revision。术语审核见 [双语维护说明](../i18n/README.md)。

## 设备与快捷凹切

`project_create.indexTeeth` 在新建时指定设备盘（默认 96），默认腰棱按该盘整齿生成。所有平面切割统一使用项目盘；旧文件换盘保留造型与面 ID，仅重算读数，不吸附小数。`cut.draft.indexTeeth` 不得另指定不同设备。

`design_plan` 的 `concave-tool` 操作与网页快捷刀具同源：`{ "kind": "concave-tool", "toolId": "flute-1", "preset": "flute", "repeat": 5, "toolDepth": 0.34 }`。`preset` 可选 `bowl`、`flute`、`v-groove`（90° V 形轮）、`triangle-groove`（可调三角柱）、`fine-flute`；已有 `toolId` 可只传 `repeat`、`toolDepth` 或连续角度 `phaseDeg`，未指定字段保持原值；phaseDeg 独立于平切分度盘。三角柱可另外传 `width > 0`、`length > 0` 与 `0 < tipAngle < 180`；尺寸变化保留现有切深，显式 `toolDepth` 可覆盖。比如 `{ "kind": "concave-tool", "toolId": "triangle-1", "preset": "triangle-groove", "width": 0.8, "length": 1.6, "tipAngle": 60, "toolDepth": 0.65 }` 在预设 Columbia-Willamette 上生成五重直线尖槽。预览／提交沿用正式 plan/commit 生命周期。网页一键添加在共享 application 完整求值后写入一次可撤销命令。高级工具参数仍可通过已有参数组导入和计划操作精确保留。

底胚只在 project_create 时确定，replace-parameters 的 stock 写入返回 STOCK_LOCKED。planar 与 concave 仍独立替换；导出 planar 参数携带 indexGear、cuttingReference 与 machining，参考坐标不一致时禁止静默重解释。concave-tool 的深度基于固定机台参考，与当前平切外形无关。

平切 Meet / Jump、有效提交与影响检查以原始底胚和平切工序为来源；凹切仅在最终实体上做布尔叠加。网页临时隐藏凹切不改变项目参数，MCP 快照和导出仍得到已保存的组合设计。

表面记录沿用 `facet.metadata.surfaceFinish`，参数编辑的继承规则见 [逐面表面处理](../architecture/state-contract.md#逐面表面处理与切割提醒)。MCP 未新增表面编辑工具或参数。
