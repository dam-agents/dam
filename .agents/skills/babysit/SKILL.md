---
name: babysit
description: >
  Get a PR to mergeable. Opens the PR with the `pr-open` skill, marks it ready
  so `dam-code-guardian` reviews it, then loops: answer each review with one
  `review-remediation` round, re-request review, until guardian approves and
  CI is green. Use when asked to babysit a PR, take it to green, watch it, or
  get it merged or approved. A single round of fixing review findings, with
  the next round left to the caller, is `review-remediation` alone.
---

# Babysit

Run the loop below and start each next review round yourself. Opening the PR
is the `pr-open` skill's; each fix round is the `review-remediation` skill's.

## The loop

- No PR yet → open it with the `pr-open` skill. Large change → **ask** whether
  to stack; never decide alone. Stacks use GitHub's feature
  (`gh extension install github/gh-stack`, `gh stack --help`), never
  hand-rolled base-branch chains.
- `gh pr ready <n>` brings `dam-code-guardian` (usually right).
  `gh pr checks <n> | grep dam:review` shows its run; it takes up to an hour.
- Review posted + CI finished → one round of the `review-remediation` skill.
  Babysit is its caller: skip its offer of the re-review command and run
  `gh pr edit <n> --add-reviewer dam-code-guardian` yourself. Wait. Repeat.
- Re-requesting reviews only the new range; label `code-guardian-review` forces
  a full re-review. Prefer re-requesting.
- `gh run rerun` only when the run's `headSha` == HEAD: a push already re-ran
  everything, and rerunning a superseded run cancels the fresh one.
- Merge conflict → merge the base branch as its own commit (never rebase), wait
  for green. Non-trivial merge → re-request guardian.
- Approved + green + mergeable → notify the user. Merge only if told to.
