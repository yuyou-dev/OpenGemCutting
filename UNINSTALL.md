# UNINSTALL.md — OpenGemCutting uninstall runbook for Codex

Uninstallation is always previewed before files or plugin registrations are removed.

## Guardrails

- Determine whether the user means the app, the Companion, or both.
- Resolve the exact app directory and inspect `git status --short --branch`.
- Show the exact removal scope and obtain explicit confirmation before deleting or moving files.
- Preserve uncommitted work, exported JSON/ASC/PDF files, screenshots, and user-added material unless explicitly included.
- Prefer moving the confirmed app directory to the operating system Trash over permanent deletion.
- Stop only the OpenGemCutting server associated with the confirmed directory.
- Removing a clone does not automatically clear browser storage; explain that separately if a complete data reset is requested.

## Uninstall the app

1. Locate and display the exact OpenGemCutting clone.
2. Inspect its Git status and identify uncommitted or untracked work.
3. Stop only the development server launched from that clone.
4. Preview the files and local work that would be affected.
5. After explicit confirmation, move only that confirmed directory to Trash.
6. Report whether the operation is recoverable and what browser-local data remains.

The normal installation is just the cloned repository and its local `node_modules`; it does not install a system-wide OpenGemCutting package.

## Uninstall the Companion when requested

Follow the **Uninstall** section in [`plugins/opengemcutting-companion/LIFECYCLE.md`](plugins/opengemcutting-companion/LIFECYCLE.md). Removing the Companion does not remove the app, local documents, or GitHub account data.

## Completion report

Report exactly which component was removed, which files or browser data were preserved, and whether the app directory can be recovered from Trash.

## Design plugin

The Design plugin is `opengemcutting-design@opengemcutting`. Manage it independently of the optional Companion using the current `codex plugin --help` commands. Updating the app also updates the repository skill; keep the plugin and workbench on the same release. Uninstalling a plugin does not delete projects or exported JSON.

## 本地设计 MCP 与运行时

完整移除对话入口时，通过 Codex CLI 移除本项目 setup/product.json 指定的 MCP 注册与设计插件；先查看真实配置，保留其他项目的服务。项目内 .runtime 仅为自动补齐的运行时，确认不再使用该安装后可随安装目录移除。导出的设计和浏览器项目不是运行时，不要一并清除。
