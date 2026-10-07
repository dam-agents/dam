---
name: implement-feature
description: >
  Implement a feature from the plan that plan-feature produced under docs/plan/<feature>/, one
  reviewed sub-issue at a time. Use when the user wants to implement or build a feature from a
  docs/plan/<feature>/ plan or a planned GitHub issue.
---

Implements a feature `plan-feature` already planned under `docs/plan/<NNN-slug>/` (README + one
file per sub-issue): one atomic commit per sub-issue on the branch `plan-feature` created, a
cleanup commit deleting the plan, and the draft PR flipped to ready. The whole feature lands as
one PR.

**Input:** a GitHub issue number/URL (find the plan folder by its issue-number prefix) or a
`docs/plan/<NNN-slug>/` path.

## 1. Read everything

The issue (via `gh`); the plan's `README.md` **and every** sub-issue file; the linked ADR, if
the README or issue references one; the architecture pages the README points at (the source of
truth for *why*).

## 2. Resume check

On the feature branch (step 4):

- **Commits beyond the plan commit** → resumed run. Verify the README's sub-issue checkmarks
  against `git log` to find what's done. **Uncommitted changes** from an implemented but
  unapproved sub-issue → offer to continue *that* sub-issue rather than restart it.
- **Only the plan commit** → fresh start.

## 3. Blocking questions

In one consolidated pass, surface every contradiction, ambiguity or gap across issue, plan, ADR
and architecture. **Write no code until the user clears them**, or state that there are none and
proceed.

## 4. Check out the feature branch

`plan-feature` created it (plan as first commit, draft PR open) as `<type>/<NNN-slug>`: slug =
plan folder name, type per the issue's nature and the branch convention (plan
`docs/plan/344-egress-cli/` → `feat/344-egress-cli`). Check it out in the **main working tree**,
not a git worktree, so smoke-testing happens in the normal checkout.

## 5. Per sub-issue, in dependency order

Topological order per the README's dependency graph. For each:

1. **Read** the sub-issue (context, plan, acceptance criteria, smoke test) against the README.
2. **Implement** it with the `/typescript-engineering` skill for server-side TS or
   `/react-ui-engineering` for UI (`packages/ui`); the sub-issue says which. **Don't author new
   tests**, even when the plan lists them: verification is the manual smoke test plus the
   existing suite. Write one only when the user asks or the behavior has no manual smoke path
   (e.g. a pure algorithm with tricky edges); a plan that calls for tests is a divergence (below)
   needing the user's go-ahead.
3. **Self-validate:** each acceptance criterion met; scoped tests for touched packages
   (`mise run //packages/<pkg>:test`) to confirm the **existing** suite didn't regress; run the
   sub-issue's smoke test yourself.
4. **Hand off:** brief summary of changes plus the sub-issue's manual smoke-test guide. **Wait**
   for the user's smoke test and review.
5. **Incorporate** feedback, then **one clean atomic commit**: `type(scope): summary`,
   `git commit -s`, body line `Refs #NNN`. The pre-commit hook (`mise generate git-pre-commit
   --write --task=check`) runs the full `mise run check`; **never** bypass it with `--no-verify`,
   and never add the attribution trailer by hand (the `attribution` setting in
   `.claude/settings.json` does it).
6. **Mark progress:** check the sub-issue off in the README's table (the plan folder is the
   resume state).

> **If the plan proves wrong while coding** (any time in 1–5): *stop and ask* when the deviation
> is structural (changes scope, breaks an acceptance criterion, contradicts README/ADR, or
> invalidates an assumption a *later* sub-issue depends on); once agreed, update the affected
> README/sub-issues so remaining slices stay consistent. *Adapt and note* purely local, in-intent
> details.

## 6. Whole-feature gate

Once every sub-issue is committed: run the **full** `mise run test` for cross-slice regressions,
then `/code-review` on the whole branch diff. Fix blocking findings by **amending the relevant
sub-issue's commit** (safe: those commits aren't pushed yet).

## 7. Delete the plan

After the user confirms the last sub-issue is done, delete `docs/plan/<NNN-slug>/` in one
final commit (`chore(plan): drop <NNN-slug> plan`). Mandatory: the `Plan check` CI job keeps the
PR unmergeable while the folder exists.

## 8. Mark the PR ready

Push and `gh pr ready` the draft PR. Check the body still reads **brief and product-level**
(like the issue, not the plan), tick every sub-issue checkbox, and confirm `Closes #NNN` is
present.
