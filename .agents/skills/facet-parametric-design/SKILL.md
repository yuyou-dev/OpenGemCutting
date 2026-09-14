---
name: facet-parametric-design
description: 在当前宝石工作台创建、修改或导出真实 CUT；参考图还原按需加载专门流程。
metadata:
  version: "0.5.0-local-mcp"
---

# 参数化琢型设计

用于当前项目配置的 Facet 96 / OpenGemCutting 对话设计。源码开发、规则审查与一般知识问答不使用本流程。同类入口只加载一个；复用同版本资源和已验证连接。

## 任务路由

- 打开／查看／导出：执行对应工具并核实结果；导出已提交设计，无需重新构造。
- 明确参数修改、预设派生或参数化新建：读取当前设计，使用 `design_plan → design_view / design_inspect → design_commit → project_save` 检查真实变化并完成保存。保留未要求改变的内容；Meet 来源使用 `design_topology` 的真实施工前缀。
- 参考图／手绘还原：读取 [参考还原流程](references/reference-workflow.md)，独立记录参考节点与连接，交付真实实体及逐项偏差。
- 无图且需探索造型或用户要求参考板：按 [参考板](references/reference-board.md) 生成并查看，再进入参考还原流程；明确参数和局部修改不要求出图。
- 新底胚：按需读取 [正式预检](references/custom-preform.md)。明确要求离线工程诊断时读取 [领域入口](references/construction.md)，不以离线脚本绕过对话提交。

## 连接与边界

首次连接读取 `facet://guide`，工具参数按需读取 `facet://capabilities`。用 `workbench_open` 返回的完整链接在内置浏览器打开，经 `workbench_sessions` 和 `design_read` 核实实际项目后才报告连接成功。项目切换、断线或版本变化时重新核实；多个目标仍有歧义才询问。工具缺失先诊断安装、加载或连接状态；安装配置需在任务授权范围内。

写入使用最新项目与 revision，整体消面确认绑定当前 planId；不自动取消手动草稿或重复提交，空实体与结构层失效不能用确认放行。已授权的普通有效修改检查后直接提交，不追加审批；需要改变明确要求或触发保护条件时说明具体影响再询问。比例冲突的取舍参见 [异常确认](references/proportions.md)。

## 完成条件

修改任务核实实际视图、指定变化与保存反馈后交付结果和可复现入口；查看任务回答所查内容，导出任务提供可用文件即可完成。不把预览当已提交、HTTP 成功当已连接，或真实渲染当作光学与审美保证。工具未覆盖的检查列为待验证；失败继续修复任务范围内的问题，直到完成或遇到需要用户处理的具体阻碍。

按对话语言回复，英文 PDF 使用 `design_export` 的 `locale: "en"`；工具参数和用户设计名称不翻译。普通设计不读取开发契约或运行仓库测试；代码变更遵循仓库 AGENTS.md。
