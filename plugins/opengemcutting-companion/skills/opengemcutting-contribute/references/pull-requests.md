# Pull Request contribution

1. Inspect the current repository, branch, remotes, and `git status --short --branch`. Preserve unrelated user changes.
2. Read `AGENTS.md`, `design-system.md`, and `state-contract.md` when the change touches product behavior, UI, geometry, or CUT interactions.
3. Summarize the actual diff. Do not claim behavior or test evidence that was not observed.
4. Run `npm run check`. For visible changes, also run the app on its printed loopback URL and verify the relevant flow in a real browser; attach a public-safe screenshot when useful.
5. Present a contribution preview with changed behavior, affected files, verification results, remaining limitations, proposed `codex/` branch, commit message, and PR title/body.
6. Obtain explicit confirmation after the final preview and before any fork, push, or PR creation.
7. Fork with GitHub CLI when needed, preserve the canonical repository as upstream, commit only intended files, push the focused branch, and use `gh pr create`.
8. Return the PR URL and authorship details. Credit the contributor whose work is being submitted.

If no source or documentation change exists, route the idea to a Discussion instead of manufacturing a commit.

Never include credentials, personal filesystem paths, private hosts, confidential gemstone designs, or material the user is not allowed to publish.
