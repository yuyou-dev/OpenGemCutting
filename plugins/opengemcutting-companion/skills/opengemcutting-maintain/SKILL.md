---
name: opengemcutting-maintain
description: Triage and maintain OpenGemCutting Discussions, Issues, and Pull Requests. Use for community inbox summaries, unanswered threads, requirement analysis, review preparation, contributor follow-up, or release-facing maintenance.
---

# OpenGemCutting Maintain

Treat Discussions, Issues, and Pull Requests as one community inbox while respecting their different lifecycles.

## Read and analyze

Use `open_opengemcutting_hub` for the visual Discussion view. Use read-only GitHub CLI or GraphQL calls for full bodies, comments, Issues, and PR diffs.

The hub must be opened through that MCP tool. Its `ui://opengemcutting/community-hub/v1.html` resource is not a browser URL. If the tool is deferred, discover its exact registered name before considering a normal HTTPS fallback.

For an inbox report, separate:

- questions needing an answer;
- ideas needing product discussion;
- reproducible bugs needing triage;
- cut-design showcases needing acknowledgement;
- PRs needing review or verification;
- repeated signals that may share one underlying need.

Distinguish evidence from inference and link each summarized need to its public source.

## Act safely

Draft public responses and show them before publishing. Obtain explicit confirmation immediately before each comment, close, review, merge, push, or other external mutation. A request to review the inbox authorizes inspection, not publication.

Verify PRs in an isolated worktree and run checks appropriate to the touched code. For geometry or exchange fixes, reproduce the problem with public-safe input when practical. Preserve contributor attribution when merging.

Read [triage rules](references/triage.md) when classifying or closing community items.

## Public boundary

Do not disclose credentials, personal paths, private hosts, confidential designs, customer information, or unapproved source files. Public-facing examples should be intentionally shareable JSON/ASC fixtures or minimal synthetic cases.
