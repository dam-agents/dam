---
name: babysit
description: >
  Get a PR to mergeable.
  Opens the PR with the `pr-open` skill, marks it ready
  so Code Guardian reviews it, then loops: answer each review with one
  `review-remediation` round, label the PR for the next review, until guardian
  approves and CI is green.
  Use when asked to babysit a PR, take it to green, watch it, or
  get it merged or approved.
  A single round of fixing review findings, with
  the next round left to the caller, is `review-remediation` alone.
---

# Babysit

Run the loop below and start each next review round yourself.
Opening the PR is the `pr-open` skill's; each fix round is the `review-remediation` skill's.

## The loop

- No PR yet → open it with the `pr-open` skill.
  A change to the web UI carries screenshots or a recording in its body or first comment ([`AGENTS.md`](../../../AGENTS.md) → **Web UI proof**).
  Large change → **ask** whether to stack; never decide alone.
  Stacks use GitHub's feature (`gh extension install github/gh-stack`, `gh stack --help`), never hand-rolled base-branch chains.
- `gh pr ready <n>` brings Code Guardian (usually right).
  `gh pr checks <n> | grep dam:review` shows its run; it takes up to an hour.
  Its reviews come from `dam-application[bot]`: watch for that login, or for a body that starts with `🛡️ **Code Guardian 🛡️**`.
- Review posted + CI finished → one round of the `review-remediation` skill.
  Babysit is its caller: skip its offer of the re-review command and run `gh pr edit <n> --add-label code-guardian-review` yourself.
  Wait.
  Repeat.
- A bot account cannot be requested as a reviewer, so `--add-reviewer` does not start a review; the `code-guardian-review` label is the only way to ask for another review.
- `gh run rerun` only when the run's `headSha` == HEAD: a push already re-ran everything, and rerunning a superseded run cancels the fresh one.
- Merge conflict → merge the base branch as its own commit (never rebase), wait for green.
  Non-trivial merge → label for another guardian review.
- Approved + green + mergeable → notify the user.
  Merge only if told to.
