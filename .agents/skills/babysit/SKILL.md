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
- `main` merges through GitHub's merge queue; its one required check is `verify`.
  A branch from before the queue reports no `verify`: merge the base branch.
  Merging is enqueueing: `gh pr merge <n> --squash --auto`, or `gh stack merge <top> --yes --squash` for a stack, which enqueues the whole stack.
  "The merge strategy for main is set by the merge queue" is a notice, not a failure: the PR is enqueued.
  Being behind `main` needs no merge; the queue tests the PR on top of `main` and the PRs ahead of it.
- Enqueued → wait until `gh pr view <n> --json state` is `MERGED`.
  The queue's run is a `merge_group` run on a `gh-readonly-queue/main/pr-<n>-<base-sha>` branch; `gh pr checks <n>` never shows it.
- Kicked out → the PR is `OPEN` again with no `autoMergeRequest`, and nothing on the PR page names the failed check.
  The timeline does: `gh api graphql -f query='{repository(owner:"<owner>",name:"<repo>"){pullRequest(number:<n>){timelineItems(last:10,itemTypes:[REMOVED_FROM_MERGE_QUEUE_EVENT]){nodes{... on RemovedFromMergeQueueEvent{createdAt reason beforeCommit{oid}}}}}}}'`; `reason` is `failed_checks`, a conflict, or a manual removal.
  Find the run: `gh run list --event merge_group --limit 100 --json databaseId,headBranch,conclusion,createdAt --jq '.[]|select(.headBranch|contains("pr-<n>-"))'`; it may show `cancelled`, not `failure`.
  `verify` only aggregates: it fails when any job it needs failed or was cancelled, so read the jobs, not `verify`: `gh run view <run> --json jobs --jq '.jobs[]|select(.conclusion!="success" and .conclusion!="skipped")|"\(.name) \(.conclusion) \(.startedAt) \(.completedAt) \(.databaseId)"'`.
  A `cancelled` job whose run time equals its `timeout-minutes` timed out: `--json jobs` lists its steps with times, and `gh run view <run> --log --job <job-id>` shows the step it hung in.
  The queue builds the arm64 images, which a PR run never does, so an arm64-only job can fail there first.
  A flake or an infra failure (a download stall, a runner timeout) → enqueue again; a real failure against what merged ahead → fix on the branch, wait for green, enqueue again.
