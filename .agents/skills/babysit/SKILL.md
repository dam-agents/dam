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
  Babysit is its caller: skip its offer of the re-review command and request the next round yourself with the worklist's `rereview.delta_label`, `gh pr edit <n> --add-label <delta_label>`, which reviews only the new commits.
  With no `delta_label`, add `rereview.label`, a full review.
  Wait.
  Repeat.
- Wait by blocking on checks, never `sleep`: `dam:review` is a check that completes when the review round ends, so `gh pr checks <n> --watch --interval 60` returns when both the round and CI are done.
  Right after a push or label the new checks may not exist yet, and `--watch` returns on the old ones; first poll until `gh pr checks <n> --json name,state --jq '.[]|select(.name=="dam:review").state'` prints `QUEUED`, `PENDING` or `IN_PROGRESS`.
  The check also completes when no review posts: its title then starts with `no review posted`.
  After `--watch` returns, confirm a guardian review on HEAD (`gh api --paginate repos/<repo>/pulls/<n>/reviews --jq '.[]|select(.body|startswith("🛡️ **Code Guardian 🛡️**")).commit_id' | tail -1` equals the head SHA); if none exists, go back to the guard.
  The wait can last an hour, longer than a foreground tool call: run `--watch` in the background, or give it a tool timeout above an hour where the harness allows one.
  `gh pr view --json` names the author `dam-code-protector`; `gh api` names it `dam-code-protector[bot]`.
- A bot account cannot be requested as a reviewer, so `--add-reviewer` does not start a review; a label is the only way to ask for another review: `rereview.delta_label` for a delta round on the new commits, `rereview.label` for a full review of the whole PR.
  Never hardcode the label names: the Code Guardian instance's configuration sets them, and they have changed before.
  Outside a `review-remediation` round, read them from the hidden `review-meta` line of the newest guardian review: `gh api --paginate --slurp repos/<repo>/pulls/<n>/reviews | jq -r '[.[][]|select(.body|startswith("🛡️ **Code Guardian 🛡️**"))]|last|.body' | sed -n 's/^<!-- review-meta: \(.*\) -->$/\1/p' | jq .rereview`.
- `gh run rerun` only when the run's `headSha` == HEAD: a push already re-ran everything, and rerunning a superseded run cancels the fresh one.
- Merge conflict → merge the base branch as its own commit (never rebase), wait for green.
  Non-trivial merge → add `rereview.label` for a full guardian review.
- Approved + green + mergeable → notify the user.
  Merge only if told to.
- `main` takes a plain squash merge; there is no merge queue.
  Merge once `verify` is green and Code Guardian approved the current head (its newest review's `commit_id` equals the head SHA, as above): `gh pr merge <n> --squash`, or `gh stack merge <top> --yes --squash` for a stack.
  The ruleset requires `verify` and one approval, but not an approval of the head, so that check is yours.
  Being behind `main` needs no merge.
- Red `verify` → it only aggregates: it fails when any job it needs failed or was cancelled, so read the jobs, not `verify`: `gh run view <run> --json jobs --jq '.jobs[]|select(.conclusion!="success" and .conclusion!="skipped")|"\(.name) \(.conclusion) \(.startedAt) \(.completedAt) \(.databaseId)"'`.
  A `cancelled` job whose run time equals its `timeout-minutes` timed out: `--json jobs` lists its steps with times, and `gh run view <run> --log --job <job-id>` shows the step it hung in.
  Infra or flake when the failed job's log shows one of:
  - a download failing or timing out from a third-party host (S3, `archive.apache.org`, `registry.access.redhat.com`, the npm registry), often ending in `EOF`, `timeout` or a `mise install` that hangs;
  - the job `cancelled` at its `timeout-minutes`;
  - `ERR_NETWORK_CHANGED`;
  - a failure in a spec or area the PR does not touch, which passed on `main`'s last run.
- Infra or flake → `gh run rerun <run> --failed` at once; do not wait or ask.
  At most twice per PR: a third failure → stop and report to the user.
  A real failure, caused by the PR or by what merged before it → fix on the branch, wait for green.
- Merged → the push to `main` runs both e2e lanes with every spec, where a PR's own run takes a reduced set ([`docs/architecture/e2e.md`](../../../docs/architecture/e2e.md)), and builds the agent images for arm64, which a PR's run never does.
  Read the first `main` run that holds the PR's commit: runs that wait behind a running one are cancelled, so one run can cover several merges.
  A failure there in a spec or build the PR's run left out, which the PR caused, is the PR's to fix, in a follow-up PR; when the PR's paths should have taken that spec, the follow-up adds them to `packages/e2e/playwright/pr-scope.json`.
