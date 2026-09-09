# INSTALL.md — OpenGemCutting install runbook for Codex

This runbook gives Codex a safe, observable way to install the browser app and,
the OpenGemCutting Design plugin with facet-parametric-design. The Companion remains optional.

## Expected result

- The public repository is cloned without overwriting an existing directory.
- Dependencies match `package-lock.json` and `npm run check` passes.
- The development server remains running on its printed `127.0.0.1` port.
- The workbench is verified with HTTP 200 and opened in Codex's built-in browser when available.
- `opengemcutting-design` is installed and listed; its version-matched full skill is also available in the workspace. Companion is optional.

An already-correct installation counts as success. Reuse a suitable existing clone rather than creating duplicates.

## Guardrails

- Never read or print credential files, tokens, passwords, verification codes, or recovery codes.
- Never pipe remote content into a shell.
- Ask before installing system-level software.
- Inspect `git status --short` before updating an existing clone. Do not discard, stash, commit, or overwrite local work without permission.
- Do not kill unrelated development servers. Read the actual URL printed by the project.
- Installing and running the workbench does not require GitHub, Codex login, an API key, or the Companion.

## Install the app

1. Confirm Node.js 20.19+ on 20.x, or 22.12+ and npm are available:

   ```bash
   node --version
   npm --version
   ```

2. If a suitable OpenGemCutting clone already exists, inspect it first. Pull only when the working tree is clean and a fast-forward is possible:

   ```bash
   git status --short --branch
   git pull --ff-only
   ```

   Otherwise clone into a new empty location:

   ```bash
   git clone https://github.com/yuyou-dev/OpenGemCutting.git
   cd OpenGemCutting
   ```

3. Install and verify:

   ```bash
   npm ci
   npm run check
   ```

4. Start `npm run dev` in a persistent terminal or background session. Read its printed loopback URL; do not assume a port.

5. Request that URL and confirm HTTP 200. Open it in Codex's built-in browser when available; otherwise return a clickable URL. Keep the server running for the user.

## Install the Design plugin

The complete-install request authorizes installation of the Design plugin. For an explicit app-only request, skip this section; the repository skill still works in a project task.

```bash
codex plugin marketplace list
codex plugin marketplace add yuyou-dev/OpenGemCutting --ref main
codex plugin add opengemcutting-design@opengemcutting
codex plugin list
```

If this marketplace already exists, upgrade it instead of adding a duplicate. For a local, unpublished RC, register the verified **local repository path** as the marketplace source instead of fetching main; do not claim the remote contains unpushed code. Do not replace an existing marketplace source without checking its purpose.

Verify the installed plugin and that the workspace contains `.agents/skills/facet-parametric-design/SKILL.md`. A plugin catalog update may require a new Codex task or app reload; follow the app's current prompt and select OpenGemCutting Design in plugin sources when needed. Do not claim it is loaded in the current task merely because installation succeeded. If the CLI lacks plugin support, finish launching the app and explain that the workspace skill can be used directly in a project task.

## Optional community Companion

Only install when requested. Follow [Companion lifecycle](plugins/opengemcutting-companion/LIFECYCLE.md). It handles community feedback and contributions, separately from local gemstone design.

## Hand-off

Report the installed commit, checks, actual local URL, Design plugin installation state and reload requirements. Start a design task with `facet-parametric-design` and the user's reference image. Never claim an installation command or a browser you did not run was verified.
