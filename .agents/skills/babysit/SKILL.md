---
name: babysit
description: Get a PR to mergeable — open, mark ready so `dam-code-guardian` reviews it, loop on review findings and CI until guardian approves and CI is green. Triggers on "babysit this PR", "take this PR to green", "watch the PR", "get this merged".
---

No PR yet → create one. Large change → **ask first** whether to stack; never decide alone.

Stack = GitHub's first-class feature, via `gh extension install github/gh-stack` (subcommands: `gh stack --help`). Never hand-roll base-branch chains.

`gh pr ready <n>` lures `dam-code-guardian` bot, who is often correct. `gh pr checks <n> | grep dam:review` to check its run, takes up to 1hr.

Guardian review posted + CI finished: Fix all. Rebase. Push. `gh pr edit <n> --add-reviewer dam-code-guardian`. Wait. Repeat.

`gh run rerun` only if the run's `headSha` == HEAD — a push already re-ran everything, and re-running a superseded run cancels the fresh one.

Label `code-guardian-review` = full re-review. Prefer re-requesting (new diff only).

Approved + green + mergeable → notify user. Merge autonomously only if instructed by user.

Conflict → rebase, wait for green again. Non-trivial rebase → re-request guardian.
