---
name: opengemcutting-contribute
description: Help non-coders and developers contribute to OpenGemCutting through GitHub Discussions, Issues, or Pull Requests. Use for questions, ideas, faceting examples, bug reports, documentation, code changes, or participation without Git commands.
---

# OpenGemCutting Contribute

Turn a user's intent or local changes into a clear, correctly routed contribution while preserving authorship and control.

## Choose the route

- Question or open-ended faceting conversation → GitHub Discussion category `Q&A`.
- Product or workflow idea → GitHub Discussion category `Ideas`.
- Public cut-design showcase → GitHub Discussion category `Show and tell`.
- Reproducible defect → GitHub Issue, using the bug template when practical.
- Completed source or documentation change → Fork, focused branch, and Pull Request.

Open `open_opengemcutting_hub` when the visual community browser, newcomer onboarding, or draft form is useful. The Apps UI sends drafts back to Codex; it never publishes directly. The `ui://opengemcutting/community-hub/v1.html` resource is not a browser URL.

If the tool is deferred, discover its exact registered name through the host's tool-search mechanism. Only a confirmed absence justifies restart-and-attach guidance or an explicitly labeled HTTPS Discussions fallback.

## GitHub onboarding

Call `check_opengemcutting_github` before a write workflow. Installation, local design work, export, and drafting remain available without a GitHub account.

For a new account, use the hub's neutral guide. The user must personally enter passwords and complete CAPTCHA, email verification, and two-factor authentication. Connect an existing account with `gh auth login --web`, then verify with `gh auth status`. Never request or inspect passwords, codes, recovery codes, or tokens.

## Discussion, reply, and Issue drafts

1. Inspect relevant public items to avoid obvious duplicates.
2. Preserve the user's meaning and distinguish observed evidence from assumptions. Do not expose a private cut, confidential client data, or an unapproved JSON/ASC file.
3. Call `stage_opengemcutting_community_draft` with the exact destination and final content. Staging performs no external write.
4. Show the returned preview and approval ID exactly.
5. Obtain explicit confirmation after that preview.
6. Call `publish_opengemcutting_community_draft` with only the single-use approval ID and report the resulting URL.

When Discussions are disabled, the hub and publisher return a clear warning. Keep the staged draft available, or restage it as an Issue after showing the changed destination and obtaining a new confirmation; never silently reroute it.

For a Pull Request, read [Pull Request contribution](references/pull-requests.md).

## Boundaries

- Earlier approval does not authorize a later, changed preview.
- Do not invent reproduction results, screenshots, test results, or ownership rights.
- Never navigate a browser to a `ui://` URI or claim the hub opened without a completed tool call.
- Keep public writing concise and use the user's requested language; default to clear English when no preference is given.
