# OpenGemCutting Companion lifecycle for Codex

Canonical repository: `https://github.com/yuyou-dev/OpenGemCutting`

This runbook covers the Companion only. It does not clone, update, run, or remove the OpenGemCutting app.

## Install

Inspect configured marketplaces:

```bash
codex plugin marketplace list
```

If `opengemcutting` is absent, add the public Git marketplace:

```bash
codex plugin marketplace add yuyou-dev/OpenGemCutting --ref main
```

If it already exists, refresh it:

```bash
codex plugin marketplace upgrade opengemcutting
```

Install the Companion and verify its listing:

```bash
codex plugin add opengemcutting-companion@opengemcutting
codex plugin list
```

## Upgrade

Refresh the marketplace snapshot, reinstall from it, and verify:

```bash
codex plugin marketplace upgrade opengemcutting
codex plugin add opengemcutting-companion@opengemcutting
codex plugin list
```

Do not hand-edit Codex marketplace configuration or cached plugin files.

## Uninstall

First show the current plugin and marketplace state:

```bash
codex plugin list
codex plugin marketplace list
```

After the user confirms removal, uninstall the Companion:

```bash
codex plugin remove opengemcutting-companion@opengemcutting
```

Ask separately before removing the marketplace because it may later contain other OpenGemCutting plugins:

```bash
codex plugin marketplace remove opengemcutting
```

Removing the Companion or marketplace does not delete the OpenGemCutting app, local JSON/ASC/PDF files, browser data, GitHub account, Discussions, Issues, or Pull Requests.

## Activate a changed plugin catalog

After installing, upgrading, or uninstalling:

1. Completely quit and reopen the Codex desktop app.
2. Create a new task.
3. For install or upgrade, open `Sources` → `Use plugins` and select **OpenGemCutting Companion**.
4. Ask: `Open the OpenGemCutting community hub.`

Typing the plugin name in an old task does not reload its skills or MCP tools.
