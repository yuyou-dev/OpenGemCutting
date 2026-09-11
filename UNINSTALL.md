# 卸载 OpenGemCutting

本文件给 Codex 执行。先区分用户要移除的是工作台、对话设计组件、社区 Companion，还是全部；各组件可以独立移除。

## 保留设计并定位安装

查看实际安装目录、Git 状态和本机注册。先保存并导出重要设计；源码、导出的 JSON/ASC/PDF、截图和浏览器项目不是可随意删除的缓存。说明具体移除范围，再按用户明确选择执行。

## 移除对话设计入口

1. 读取 setup/product.json，确认 MCP 与设计插件名称，核对注册确实属于本安装目录。
2. 使用当前 Codex CLI 的 `mcp remove` 与 `plugin remove` 命令移除选定组件；语法以本机 `--help` 为准。保留其他项目服务。
3. Marketplace 可能还提供 Companion；仍在使用时保留。插件移除不删除工作台或设计文件。

## 移除工作台

停止该目录所属的服务，把明确选定的安装目录移到系统废纸篓。目录通常包含源码、node_modules 和可选的 .runtime；不要清理其他安装或全局 Node/Codex。

浏览器项目不会随目录自动删除。只有用户明确要求重置浏览器数据时才另行处理；确认重要设计已经导出。

## 移除社区 Companion

仅在用户要求时按 [Companion 生命周期](plugins/opengemcutting-companion/LIFECYCLE.md) 操作。移除 Companion 不影响设计插件、工作台或 GitHub 账号数据。

完成时说明移除了什么、保留了什么，以及安装目录是否可从废纸篓恢复。
