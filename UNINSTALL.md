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
