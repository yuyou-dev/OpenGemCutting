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

## Design files and local projects

v0.8.0 starts on the project home page. Committed documents and optical materials are saved to the active browser-local project, which can be reopened from the home page after a refresh. Existing JSON documents remain importable.

When upgrading on the same browser and site origin, valid legacy OpenGemCutting recovery records are migrated once into the project list. Original backups remain available through the file menu; migration does not erase them or repeatedly recreate projects. Unsaved CUT drafts, camera/view settings and previous undo history are not restored after a refresh. Finish or cancel the current preview before exporting an archival JSON file.

Projects and backups belong to the current browser and site origin. Clearing site data, changing browsers, domains or local ports does not automatically carry projects across. Before restarting on a different address, export each important project as JSON; import those files into projects at the new address. JSON remains the portable long-term archive.

The optical laboratory in v0.8.0 is an empty workspace with project context and return navigation. Existing optical simulation remains available from the editor's display menu.

## Upgrade the Companion when requested

Follow the **Upgrade** section in [`plugins/opengemcutting-companion/LIFECYCLE.md`](plugins/opengemcutting-companion/LIFECYCLE.md). The updated plugin is available only after a full Codex desktop restart, a new task, and explicit selection through `Sources` → `Use plugins`.

## Completion report

Report the resulting commit, verification result, running URL, and whether the Companion was also upgraded. A dirty tree, diverged branch, failed check, or failed plugin refresh is not success.
