---
name: implement-feature
description: >
  Implement a feature from the plan that plan-feature produced under docs/plan/<feature>/, one
  reviewed sub-issue at a time. Use when the user wants to implement or build a feature from a
  docs/plan/<feature>/ plan or a planned GitHub issue.
---

This skill implements a feature that `plan-feature` has already planned. It consumes the
ephemeral plan under `docs/plan/<NNN-slug>/` (README + one file per sub-issue) and turns it into
code: a feature branch, one atomic commit per sub-issue, and a single PR for the whole feature.

**Core rhythm:** read everything first and clear up confusion *before* writing code; implement
one sub-issue at a time; after each, **pause for the user to smoke-test and review** before
committing and moving on. The whole feature lands as one PR.

## Input

Accept either a GitHub issue number/URL or a `docs/plan/<NNN-slug>/` path. Given an issue,
locate the plan folder by its issue-number prefix.

## Steps

### 1. Read everything

Before touching code, read the full context:

- The issue, via `gh`.
- The plan: `README.md` **and every** sub-issue file in the folder.
- The linked ADR, if the README/issue references one.
- The architecture page(s) the README points at (the docs are the source of truth for *why*).

### 2. Resume check

Derive the feature branch name deterministically (see step 4) and check whether it already
exists:

- **Branch exists** — this is a resumed run. Read the README's sub-issue checkmarks and verify
  them against the branch's `git log` to find which sub-issues are already done. If the working
  tree has **uncommitted changes** from a sub-issue that was implemented but not yet
  approved/committed, offer to continue *that* sub-issue rather than restart it.
- **No branch** — fresh start.

### 3. Upfront blocking-questions pass

In one consolidated pass, surface every contradiction, ambiguity, or gap you found across the
issue, plan, ADR, and architecture. **Write no code until the user clears the blockers** — or
state explicitly that there are none and proceed.

### 4. Create the feature branch

If fresh, branch from `main`. Name it `<type>/<NNN-slug>`, where the slug matches the plan
folder name (e.g. plan `docs/plan/344-egress-cli/` → branch `feat/344-egress-cli`) and `<type>`
follows the issue's nature (`feat`, `fix`, …) per the branch convention. Work in the **main
working tree** — not a git worktree — so manual smoke-testing happens in the normal checkout.

### 5. Per sub-issue, in dependency order

Process sub-issues in a topological order consistent with the README's dependency graph. For
each one:

1. **Read** the sub-issue (context, implementation plan, acceptance criteria, smoke test)
   against the shared README context.
2. **Implement** the slice. Apply the `/typescript-engineering` skill for server-side TS and the
   `/react-ui-engineering` skill for UI (`packages/ui`) work — the sub-issue names which.
   **Don't author new tests**, even when the sub-issue's plan lists them — verification leans on
   the manual smoke test plus the existing suite. Write one only when the user asks or the
   behavior is otherwise unverifiable (no manual smoke path, e.g. a pure algorithm with tricky
   edges); if the plan calls for tests, treat it as a divergence (see below) and get the user's
   go-ahead first.
   **Comment sparingly.** Comment only the non-obvious *why* — a constraint, an edge case, a
   deliberate departure; never narrate *what* a line does. Match the file's existing comment density.
3. **Self-validate:** confirm each acceptance criterion is met; run the **scoped tests** for the
   touched package(s) (`mise run <pkg>:test`) to confirm you haven't regressed the **existing**
   suite; run the sub-issue's **smoke test yourself**.
4. **Hand off to the user:** present a brief summary of what changed and the manual smoke-test
   guide from the sub-issue. **Wait** for the user to smoke-test and give review feedback.
5. **Incorporate** the user's feedback, then make **one clean atomic commit** — conventional
   `type(scope): summary`, `git commit -s`, body line `Refs #NNN`. The pre-commit hook runs the
   full `mise run check`; **never** bypass it with `--no-verify`, and never add the attribution
   trailer by hand (the hook does it).
6. **Mark progress:** check the sub-issue off in the README's sub-issue table (the plan folder
   is the resume state).

> **If the plan turns out wrong while coding** (can fire any time during 1–5): *stop and ask*
> when the deviation is structural — it changes scope, breaks a stated acceptance criterion,
> contradicts the README/ADR, or invalidates an assumption a *later* sub-issue depends on; once
> agreed, update the affected README/sub-issue so not-yet-done slices stay consistent. *Adapt and
> note* for purely local, in-intent details.
>
> The commit lands **after** the user's sign-off, never before — so history stays one clean
> commit per reviewed slice, with no amend churn.

### 6. Whole-feature gate

Once every sub-issue is approved and committed:

- Run the **full** `mise run test` to catch cross-slice regressions.
- Run a final review pass on the whole branch diff with **both** `/review-work` (requirements)
  and `/code-review` (correctness). Fix blocking findings by **amending the relevant sub-issue's
  commit** — safe because nothing is pushed yet, so the one-commit-per-sub-issue history stays
  intact.

### 7. Open the PR

Only after the user confirms the final sub-issue is done: push the branch and open the PR via
`gh`. The PR description is **brief and product-level** — what the feature does for the user, no
implementation details, no file paths; it reads like the issue, not the plan. Include `Closes
#NNN` so the issue closes on merge.

### 8. Clean up

Ask the user whether to delete the `docs/plan/<NNN-slug>/` folder now or keep it until the PR
merges. This is the **last** action — so an interrupted run always leaves the plan in place.
