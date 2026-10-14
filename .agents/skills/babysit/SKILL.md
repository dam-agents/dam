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
  Its reviews come from `dam-code-protector[bot]` (earlier `dam-application[bot]`); the login has changed before, so match the body, which starts with `🛡️ **Code Guardian 🛡️**`.
- Review posted + CI finished → one round of the `review-remediation` skill.
  Babysit is its caller: skip its offer of the re-review command and run `gh pr edit <n> --add-label code-guardian-review` yourself.
  Wait.
  Repeat.
- Wait by blocking on checks, never `sleep`: `dam:review` is a check that completes when the review round ends, so `gh pr checks <n> --watch --interval 60` returns when both the round and CI are done.
  Right after a push or label the new checks may not exist yet, and `--watch` returns on the old ones; first poll until `gh pr checks <n> --json name,state --jq '.[]|select(.name=="dam:review").state'` prints `QUEUED`, `PENDING` or `IN_PROGRESS`.
  The check also completes when no review posts: its title then starts with `no review posted`.
  After `--watch` returns, confirm a guardian review on HEAD (`gh api --paginate repos/<repo>/pulls/<n>/reviews --jq '.[]|select(.body|startswith("🛡️ **Code Guardian 🛡️**")).commit_id' | tail -1` equals the head SHA); if none exists, go back to the guard.
  The wait can last an hour, longer than a foreground tool call: run `--watch` in the background, or give it a tool timeout above an hour where the harness allows one.
  `gh pr view --json` names the author `dam-code-protector`; `gh api` names it `dam-code-protector[bot]`.
- A bot account cannot be requested as a reviewer, so `--add-reviewer` does not start a review; the `code-guardian-review` label is the only way to ask for another review.
- `gh run rerun` only when the run's `headSha` == HEAD: a push already re-ran everything, and rerunning a superseded run cancels the fresh one.
- Merge conflict → merge the base branch as its own commit (never rebase), wait for green.
  Non-trivial merge → label for another guardian review.
- Approved + green + mergeable → notify the user.
  Merge only if told to.
