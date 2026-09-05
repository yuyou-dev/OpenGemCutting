# UPGRADE.md — OpenGemCutting upgrade runbook for Codex

Use this runbook to update an existing OpenGemCutting installation while preserving local work.

## Expected result

- The existing clone is fast-forwarded to the latest `origin/main`.
- Dependencies match the current lockfile and `npm run check` passes.
- The workbench is restarted at its actual loopback URL and opened in the built-in browser when available.
- The Companion is upgraded only when requested.

## Guardrails

- Locate the existing clone; do not create a second copy and call it an upgrade.
- Inspect `git status --short --branch` before pulling.
- Never discard, stash, commit, publish, or overwrite local changes without permission.
- Use `git pull --ff-only`; stop and report a dirty or diverged branch.
- Do not kill unrelated servers or assume a port.

## Upgrade the app

From the existing clone:

```bash
git status --short --branch
git pull --ff-only
npm ci
npm run check
```

Restart the project with `npm run dev` in a persistent session. Read the printed `127.0.0.1` URL, verify HTTP 200, and open it in Codex's built-in browser when available.

## Design files and local recovery

v0.7.1 adds local recovery of committed documents and optical materials. Existing JSON documents remain importable. On startup, select a backup explicitly; unsaved CUT drafts, camera/view settings, and previous undo history are not restored. Export JSON before stopping an editing session. Browser backups belong to the current browser and site origin, so restarting on a different local port does not carry them across; import the saved JSON at the new address.

## Upgrade the Companion when requested

Follow the **Upgrade** section in [`plugins/opengemcutting-companion/LIFECYCLE.md`](plugins/opengemcutting-companion/LIFECYCLE.md). The updated plugin is available only after a full Codex desktop restart, a new task, and explicit selection through `Sources` → `Use plugins`.

## Completion report

Report the resulting commit, verification result, running URL, and whether the Companion was also upgraded. A dirty tree, diverged branch, failed check, or failed plugin refresh is not success.
