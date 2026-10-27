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
- `main` merges through the Mergify merge queue (`.mergify.yml`); the ruleset's one required check is `verify`.
  Merging is queueing: add the `queue` label, `gh api -X POST repos/<repo>/issues/<n>/labels -f 'labels[]=queue'`.
  Mergify queues the PR once Code Guardian has approved it and its `verify` passed, so the label may go on before that.
  Never `gh pr merge`: a direct merge skips the queue's full e2e and restarts every batch in flight.
  A stack: queue the bottom PR; once it merges, merge `main` into the next one, wait for green, and queue it.
  Being behind `main` needs no merge; the queue tests the PR on top of `main` and the PRs ahead of it.
- Queued → wait until `gh pr view <n> --json state` is `MERGED`.
  While a freeze is on, nothing merges; the queue still tests.
  Mergify tests a batch as a draft PR from a `mergify/merge-queue/*` branch; its status comment on the PR links it.
  The batch PR's CI/CD run is a `pull_request` run that takes both e2e lanes in full and reports `verify-queue`; `gh pr checks <n>` on your PR never shows it.
  A failed batch is retried once, then split; a PR whose batch failed still merges when a later batch that holds it passes, so a red batch run alone is no ejection.
- Kicked out → the PR is `OPEN` and out of the queue; Mergify's status comment names the reason and the batch PR.
  Find its runs: `gh run list --workflow cd.yml --branch <batch-branch> --json databaseId,conclusion,headSha`.
  `verify-queue` only aggregates: it fails when any job it needs failed or was cancelled, so read the jobs, not `verify-queue`: `gh run view <run> --json jobs --jq '.jobs[]|select(.conclusion!="success" and .conclusion!="skipped")|"\(.name) \(.conclusion) \(.startedAt) \(.completedAt) \(.databaseId)"'`.
  A `cancelled` job whose run time equals its `timeout-minutes` timed out: `--json jobs` lists its steps with times, and `gh run view <run> --log --job <job-id>` shows the step it hung in.
  Infra or flake when the failed job's log shows one of:
  - a download failing or timing out from a third-party host (S3, `archive.apache.org`, `registry.access.redhat.com`, the npm registry), often ending in `EOF`, `timeout` or a `mise install` that hangs;
  - the job `cancelled` at its `timeout-minutes`;
  - `ERR_NETWORK_CHANGED`;
  - a failure in a spec or area the PR does not touch, in a job that passed on the PR's own run.
- Infra or flake → queue again at once with a `@mergifyio queue` comment; do not wait or ask.
  At most twice per PR: a third ejection → stop and report to the user.
  A real failure, caused by the PR or by what merged ahead → fix on the branch, wait for green, queue again.
