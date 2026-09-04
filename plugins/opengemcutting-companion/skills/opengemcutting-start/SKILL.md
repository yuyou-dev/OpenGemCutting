---
name: opengemcutting-start
description: Install, update, uninstall, verify, run, open, or introduce OpenGemCutting and its Companion, including the visual community hub. Use for project setup and lifecycle work, not for publishing contributions.
---

# OpenGemCutting Start

Bring the user to an observable running OpenGemCutting workbench while preserving existing local work.

## App workflow

1. Use the current clone when suitable; otherwise look for an existing nearby clone before creating one. Never overwrite a non-empty directory.
2. Inspect `git status --short --branch` before updating. Pull only a clean, non-diverged clone with `git pull --ff-only`.
3. Require Node.js 20.19 or newer. Installing the browser app does not require GitHub authentication, an API key, or Codex login.
4. Run `npm ci` and `npm run check`.
5. Start `npm run dev` in a persistent session. Read the printed `127.0.0.1` URL instead of assuming a port.
6. Verify HTTP 200 and open the URL in Codex's built-in browser when available.

Use the repository's root `INSTALL.md`, `UPGRADE.md`, or `UNINSTALL.md` for the corresponding lifecycle request. An uninstall must preview exact scope and obtain confirmation before any removal.

## Community hub

When the user asks to open the OpenGemCutting community hub, call `open_opengemcutting_hub`. Its `ui://opengemcutting/community-hub/v1.html` value is an internal MCP Apps resource identifier, not a browser URL.

If the tool is deferred, use the host's tool-search mechanism to discover its exact registered name. Only after exact-name discovery confirms it is absent should you explain the restart-and-attach boundary or offer the ordinary HTTPS Discussions page as a temporary fallback. Never claim the interactive hub opened unless the tool call completed.

## Companion lifecycle

For Companion install, upgrade, or uninstall requests, follow the plugin root `LIFECYCLE.md`. The app and plugin are independent. After a plugin catalog change, explain the full Codex desktop restart, new-task creation, and `Sources` → `Use plugins` selection.

## Boundaries

- Never pipe remote scripts into a shell or expose credentials.
- Do not publish, push, fork, or create a PR unless the user separately requests a contribution workflow.
- GitHub is optional for installation, local editing, and export.
