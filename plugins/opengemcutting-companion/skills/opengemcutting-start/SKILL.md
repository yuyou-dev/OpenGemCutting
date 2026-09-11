---
name: opengemcutting-start
description: Install, update, uninstall, verify, run, open, or introduce OpenGemCutting and its Companion, including the visual community hub. Use for project setup and lifecycle work, not for publishing contributions.
---

# OpenGemCutting Start

Bring the user to an observable running OpenGemCutting workbench while preserving existing local work.

## App workflow

Use the repository INSTALL.md, UPGRADE.md or UNINSTALL.md as the single lifecycle workflow. Full setup includes the same-source design MCP and Design plugin; Companion remains optional. Do not maintain separate npm or startup commands here. For conversational design, open the URL returned by workbench_open in the built-in browser and verify workbench_sessions plus design_read before announcing readiness. A plain development page is not an AI connection. Tell the user they can now describe the desired gemstone directly.

## Community hub

When the user asks to open the OpenGemCutting community hub, call `open_opengemcutting_hub`. Its `ui://opengemcutting/community-hub/v1.html` value is an internal MCP Apps resource identifier, not a browser URL.

If the tool is deferred, use the host's tool-search mechanism to discover its exact registered name. Only after exact-name discovery confirms it is absent should you explain the restart-and-attach boundary or offer the ordinary HTTPS Discussions page as a temporary fallback. Never claim the interactive hub opened unless the tool call completed.

## Companion lifecycle

For Companion install, upgrade, or uninstall requests, follow the plugin root `LIFECYCLE.md`. The app and plugin are independent. After a plugin catalog change, explain the full Codex desktop restart, new-task creation, and `Sources` → `Use plugins` selection.

## Boundaries

- Never pipe remote scripts into a shell or expose credentials.
- Do not publish, push, fork, or create a PR unless the user separately requests a contribution workflow.
- GitHub is optional for installation, local editing, and export.
