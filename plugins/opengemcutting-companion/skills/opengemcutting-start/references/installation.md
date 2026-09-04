# Installation details

Canonical repository: `https://github.com/yuyou-dev/OpenGemCutting.git`

For app installation, upgrade, or uninstall, follow the repository root `INSTALL.md`, `UPGRADE.md`, or `UNINSTALL.md`. They define dirty-tree handling, verification, persistent server startup, and the browser hand-off.

For Companion-only lifecycle work, follow `../../../LIFECYCLE.md`.

```bash
codex plugin marketplace add yuyou-dev/OpenGemCutting --ref main
codex plugin add opengemcutting-companion@opengemcutting
```

When the marketplace already exists, use `codex plugin marketplace upgrade opengemcutting` before reinstalling or updating. After a catalog change, completely restart Codex desktop, create a new task, select **OpenGemCutting Companion** through `Sources` → `Use plugins`, then ask to open the OpenGemCutting community hub.

The app itself uses:

```bash
git clone https://github.com/yuyou-dev/OpenGemCutting.git
cd OpenGemCutting
npm ci
npm run check
npm run dev
```

Read the actual loopback URL printed by the server and verify it before opening it.
