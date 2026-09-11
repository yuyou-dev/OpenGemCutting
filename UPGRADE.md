# 升级并继续设计

本文件给 Codex 执行。定位用户正在使用的安装目录，不另找旧副本冒充升级。先通过已连接工作台保存并导出重要设计 JSON，告知新地址不会自动搬迁旧端口的浏览器项目。导出未成功时先解决，不停止正在使用的服务。

1. 阅读当前 INSTALL.md 与 setup/README.md，检查 `git status --short --branch` 及当前上游。
2. 干净且有正确发行上游的 Git 安装执行 `sh setup/bootstrap.sh upgrade`，Windows 执行 `powershell -NoProfile -ExecutionPolicy Bypass -File setup/bootstrap.ps1 upgrade`。统一模块只 fast-forward，随后更新依赖、同源 MCP、skill、插件和构建。不要 reset、stash 或丢弃本地修改。
3. 源码 ZIP 安装没有 Git 历史：在新的空目录解压新版，按 INSTALL.md 完整配置；先保留旧目录和导出的设计。若已有同名注册指向旧目录，说明将切换的具体安装路径，由用户选择后通过 Codex CLI 移除该项注册/市场再配置新目录，不覆盖其他服务。代码开发者有本地改动时交由其合并，不生成平行算法或自动覆盖源码。
4. 若客户端仍持有旧工具进程，按客户端要求刷新或新开项目任务。使用更新后的 `workbench_open` 打开内置浏览器，`design_read` 实际核实后再宣布就绪，导入留存 JSON 继续创作。

完成回复：“已升级并连接工作台。现在可以继续告诉我想调整的琢型。”只有配置完成但尚待刷新时，明确报告这一状态。社区插件仅按用户要求更新；单机版继续支持独立源码升级，不要求 AI 依赖。
