# INSTALL.md — OpenGemCutting install runbook for Codex

This runbook gives Codex a safe, observable way to install the browser app and,
when requested, the optional OpenGemCutting Companion.

## Expected result

- The public repository is cloned without overwriting an existing directory.
- Dependencies match `package-lock.json` and `npm run check` passes.
- The development server remains running on its printed `127.0.0.1` port.
- The workbench is verified with HTTP 200 and opened in Codex's built-in browser when available.
- When requested, `opengemcutting-companion` is installed and verified separately.

An already-correct installation counts as success. Reuse a suitable existing clone rather than creating duplicates.

## Guardrails

- Never read or print credential files, tokens, passwords, verification codes, or recovery codes.
- Never pipe remote content into a shell.
- Ask before installing system-level software.
- Inspect `git status --short` before updating an existing clone. Do not discard, stash, commit, or overwrite local work without permission.
- Do not kill unrelated development servers. Read the actual URL printed by the project.
- Installing and running the workbench does not require GitHub, Codex login, an API key, or the Companion.

## Install the app

1. Confirm Node.js 20.19 or newer and npm are available:

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

## Install the Companion when requested

Skip this section when the user asks for the app only. For a Companion-only request, follow [`plugins/opengemcutting-companion/LIFECYCLE.md`](plugins/opengemcutting-companion/LIFECYCLE.md).

```bash
codex plugin marketplace list
codex plugin marketplace add yuyou-dev/OpenGemCutting --ref main
codex plugin add opengemcutting-companion@opengemcutting
codex plugin list
```

If the `opengemcutting` marketplace already exists, run `codex plugin marketplace upgrade opengemcutting` instead of adding it again.

Plugin skills and MCP tools become available after fully restarting Codex desktop, creating a new task, and selecting **OpenGemCutting Companion** from `Sources` → `Use plugins`. The app and Companion are independent; finish starting the app before explaining this reload boundary.

## Hand-off

Report the installed commit, verification result, actual local URL, and whether the Companion was installed. Do not claim the Companion is active in the current task after a catalog change.
