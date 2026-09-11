---
name: facet-parametric-design
description: 在 Facet 96 工作台从参考图、手绘或文字构建可编辑真实 CUT；先独立解析正交节点与连接，再联合构造共享平面、检查整数96分度和最终实体。无图设计先出参考板。不是任意图片精确还原器或光学评级工具。
metadata:
  version: "0.4.0-local-mcp"
---

# 参数化琢型设计

交付目标是设计师能继续修改的真实 CUT、原图等比例对照及逐项误差。先读仓库 AGENTS.md、state-contract.md，检查脏工作区，保留已有设计。优先级是用户意图、可见节点/棱/面的连接和正交形状；角度、模板和面数只补充未知信息。非零体积、正腰厚、平面性和全局裁切可达性始终必需。

## 0. 连接同源设计接口

使用本项目配置的设计 MCP（Facet 96 或 OpenGemCutting）：先读 `facet://guide` 与 `facet://capabilities`，通过 `workbench_open` 获取本次完整链接，在 Codex 内置浏览器打开，再用 `workbench_sessions` 和 `design_read` 核实网页与项目。只有实际读取成功后才回复“工作台已连接，现在可以直接描述切割需求”。不把普通 dev 页面或 HTTP 检查当作对话已绑定。多个项目不猜目标，不要求设计师填写接口参数。没有工具时按本项目 INSTALL.md 配置；若客户端需刷新或新开任务，明确说明待完成状态。普通网页始终可独立手动运行；脚本流程仅供明确要求的离线工程诊断，不代替对话设计验收。

构造采用 `design_plan → design_view / design_inspect / design_projection → design_commit → project_save / design_export`。能力清单与参数以服务器返回为准，不在本 skill 再维护一份。用 `preset_list` 获取同源预设；用 `design_topology` 的施工前缀获取真实 Meet 来源。新工具/规则进入正式 application/domain 模块和测试，禁止通过增加临时脚本绕过已声明能力。

所有写操作携带最新项目和 revision；手动草稿、版本变化或断线时重新读取，不自动取消现场或重复提交。整体消面确认绑定当前 planId；不得用确认跳过空实体或结构层保护。`design_view` 返回同一实体的真实 PNG，不能以图像生成结果代替。

入门与维护文档见 [本地 MCP](../../../docs/mcp/README.md)。参考构造方法继续遵守下文；MCP 提供稳定操作与反馈，不代替独立读图或设计师判断。

## 1. 获取参考

说明造型目标、当前障碍与预期可观察的变化。有图直接查看所有视图；截图只解析用户原图，历史模型不提供本次节点。尽量找到原始图片并记录来源，找不到则提取参考区域并记录像素局限。

无图原创先读 [参考板](references/reference-board.md)，使用内置 image_gen 生成效果/顶/底/侧参考板，实际查看后再解析。不要先固定生成器拓扑再用图像给它背书。[面组组织](references/design-principles.md) 提供设计词汇，不是配额；原图和连接不能被范本覆盖。

缺视图按 [补全](references/incomplete-reference.md) 明示推断后继续；图像中的高度和拓扑冲突分别记录。手绘可直线化、规整对称，但保留可见分叉。仅靠线宽不能判断的地方标成未确定。照片反射线不是已知切割棱。

## 2. 冻结独立读图记录

在求解前保存原图坐标、观察方向、唯一尺度和带语义名的节点、面环与边清单。分别覆盖台面全周、冠部各扇区、轮廓、亭部全周及底尖/底面。缺失视图单列，不给它计算还原分数。参考坐标与施工坐标分开保存；之后只能补语义面到 CUT ID 的映射。

将旋转/镜像记录成显式节点对应，不能靠最近点猜对称身份。清楚的短棱保留两个点；同一个分叉只定义一次。检查面环的凸性、共享边和层次；水平面边中点若接入另一条非共线棱，需要证明真实三维可达，不能自动把所有投影交叉当节点。

## 3. 共享节点联合构造

读 [联合构造](references/reference-construction.md) 与 [连接检查](references/topology.md)。先选择有证据的自由量，联合解完整连接链，再生成平面；默认高度不可把轮廓拉歪，也不可使不同面共面消失。

先枚举精确整数分度候选，按对称轨道统一选择，对每个候选检查全部参与点及所有保护点。相邻面不能各自取最近分度后冒充联合解。区分「整数分度上的精确可执行实体」和「与输入像素完全一致」；后者还需要独立投影误差证据。

[shared-planes.mjs](scripts/shared-planes.mjs) 提供少量纯领域原语：`indexCandidates`、`planeThroughNodes`、`inspectPlane`、`patternFromPlane`、`findPrefixTarget`。具体领域入口见 [实现](references/construction.md)。复杂链可用线性代数或独立数值求解，但不得把数值收敛当作最终实体成立。

按施工前缀绑定真实顶点/棱比例点 Meet；找不到来源就保留自由参数并明确标记，不编造 fallback。相同用途、同参数且完整可生成的轨道才合组；重组后重新绑定来源。下游不是自动全局联动，修改上游后重新诊断。

## 4. 两种独立验收

工程：完整保存实体的有效 CUT 面、所有指定连接、全局半空间可达性、共面残差、非零体积、整圈腰厚、整数分度、JSON 往返和全部 Meet 来源。原石面、逻辑 CUT 与三角片分开统计。输入新底胚先走 [正式预检](references/custom-preform.md)。运行：

```sh
node .agents/skills/facet-parametric-design/scripts/inspect.mjs design.json reference-topology.json
node --test .agents/skills/facet-parametric-design/scripts/*test.mjs
npm run check
```

投影：使用 [projection-audit.mjs](scripts/projection-audit.mjs) 将独立语义图与同一保存实体比较。只允许平移、旋转、等比例缩放；报告每节点坐标误差、每条连接是否真实存在、缺失面/节点和全部额外可见顶点。补做可见边的双向覆盖检查，不用单一总分掩盖漏线。`inspect.mjs` 或共点清单通过不表示输入完整、像素相似或审美通过。

浏览器：自主启动 127.0.0.1 临时端口服务，在真实工作台新项目导入 JSON，检查真实3D、顶/底/侧视；实测参数组修改、Meet 解除后放弃恢复、保存及重开。修改交互才同步产品帮助和手册；个人试作不混入内置预设或正式手册。

## 5. 交付

使用既有统一试作页，不另建产品样式：

```sh
npm run design:review -- design.json --out output/new-review --reference reference.png --views reference-views.json --notes notes.txt
```

裁切格式、来源与尺度约定见 [参考板](references/reference-board.md) 和 [实现](references/construction.md)。交付可编辑 JSON、同实体真实三视/3D、原图对照或叠加、逐项偏差、可复现入口及未通过项。工程状态与设计师待验收分开；失败继续定位和修订，不删除目标、隐藏棱、压扁实体或回写参考来变绿。确有不可兼容的已知要求时，展示具体位置和经过验证的替代方案。
