---
name: plan-feature
description: >
  Turn a GitHub issue into an implementation plan under docs/plan/<feature>/: a feature spec
  decomposed into context-window-sized sub-issues, committed as the first commit of the feature
  branch with a draft PR. Use when the user wants to plan a feature, decompose a GitHub issue
  into sub-issues, or produce an implementation plan from an issue.
---

<what-to-do>

This skill turns a GitHub issue into a feature spec and implementation plan: a `README.md`
plus one Markdown file per sub-issue, written under `docs/plan/<feature-slug>/`.

**The plan is committed and starts the feature branch.** The plan files are working artifacts
for the implementation phase, not permanent docs — but they live in git: planning ends by
creating the feature branch, committing the plan as its **first commit**, and opening a **draft
PR** (step 4). The plan never merges: the `Plan check` CI job fails while `docs/plan/` exists,
so the PR stays blocked until the cleanup commit deletes the folder.

The implementation phase completes this flow. `/implement-feature` picks up the branch this
skill created and ends by landing a commit that deletes `docs/plan/<feature-slug>/` before the
PR is marked ready — the `Plan check` gate keeps the PR unmergeable until the folder is gone.

A sub-issue is "self-contained" in the sense that **README + that sub-issue together** give a
fresh agent (plus the linked issue) everything needed to implement the slice cold. Shared
context lives once in the README; each sub-issue carries only what is specific to it.

## Steps

### 1. Assess context, fill the gaps

**Prerequisite:** know the problem being solved. If the issue isn't in context yet, fetch it
with `gh` (accept a URL or a number) and read the title, body, and discussion.

This skill usually runs on top of a conversation where the feature has already been discussed.
With the issue in hand, assess whether the context is enough to decompose — don't redo work
the conversation already did.

Enough means: no open question (scope, boundaries, edge cases, where things live, naming)
could change the decomposition, and the plan is grounded in the relevant architecture page(s)
under [`docs/architecture/`](../../../docs/architecture/) and real files, modules, and seams
in the codebase.

**If the context falls short, stop.** Don't gather it yourself — tell the user you don't have
enough context to decompose, list what's missing or undecided, and let them supply it or
discuss it first. Offer `/grill-me` as one way to close the gaps — a grilling session working
through the open questions — but leave the choice to the user. Proceed to step 2 only when the
context is sufficient.

### 2. Decompose and get sign-off

Decide how the feature splits into sub-issues:

- **Size for one context window.** Each sub-issue is roughly one atomic commit's worth of work
  that a fresh agent can implement comfortably in a single context window. Slices don't need to
  be independently shippable — the feature lands as one PR — but each must leave the branch
  green and be concretely verifiable on its own.
- **Prefer vertical slices when the feature splits into separate behaviors** — each behavior
  (e.g. list view, delete action) is one slice cutting through all the layers it needs.
- **Split horizontally when a single behavior is too deep for one window.** Cut along the tRPC
  contract, pin the contract in the README so both sides implement against it, and order the
  backend slice before the UI slice. A backend-only slice is still verifiable (a tRPC/CLI call
  with expected output); end-to-end verification moves to the whole-feature smoke test.
- **Do not split artificially.** If the feature is small, a single sub-issue is correct.

Present the **decomposition outline** to the user and wait for explicit approval before writing
the detailed files:

- Feature summary (1–2 sentences).
- The sub-issue list: number, title, one-line scope, and dependency order.

### 3. Write the files

Create `docs/plan/<feature-slug>/`. Derive the slug from the issue title, prefixed with the
issue number for traceability (e.g. `docs/plan/344-egress-cli/`). Write `README.md` and one
`NN-slug.md` per sub-issue (`01-`, `02-`, … to encode order), using the templates below.

While drafting, keep the plan architecturally sound and consistent with existing code:

- Apply `/typescript-engineering` (server-side TS) and `/react-ui-engineering` (UI,
  `packages/ui`), and name the relevant skill inside each sub-issue so the implementing agent
  applies it too.
- **Don't prescribe new tests.** The implementing agent doesn't author tests by default;
  verification leans on the **existing** suite (`mise run test` / `mise run check`) plus a
  **manual** smoke test. Call for a new test only when behavior is otherwise unverifiable (e.g. a
  pure algorithm with tricky edges and no manual smoke path) — and flag it as the exception.

### 4. Branch, commit, open a draft PR

Create the feature branch from `main`, named `<type>/<NNN-slug>` where the slug matches the plan
folder (e.g. plan `docs/plan/344-egress-cli/` → branch `feat/344-egress-cli`) and `<type>`
follows the issue's nature per the branch convention. This is the same derivation
`implement-feature` uses, so it finds the branch by name.

Commit the plan files as the branch's first commit: `docs(plan): 344-egress-cli`, with
`git commit -s` and a body line `Refs #NNN`.

Push the branch and open a **draft** PR with `gh pr create --draft`. The title is the feature
title; the body follows the template below — a product-level overview plus one checkbox per
sub-issue, so reviewers see the feature's shape at a glance.

If the user asks for plan changes after reading the files, amend the commit and force-push —
safe while the branch carries only the plan commit.

### 5. Report

Print the branch name, the draft PR link, where the plan lives, and a one-paragraph summary of
the sub-issues and their order. Remind the user the plan is the branch's first commit and will
be removed before the feature ships, and that `/implement-feature` is the next step.

## PR body template

```markdown
<Overview: what's being built and why, product-level, from the README's Goal. No file paths,
no implementation detail.>

Closes #NNN

## Sub-issues

- [ ] 01 — <title>
- [ ] 02 — <title>
```

</what-to-do>

<supporting-info>

## README.md template

```markdown
# <Feature title>

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** <link>

## Goal

<What we're building and why, from the issue and conversation. User-visible outcome.>

## Approach

<Overall architecture and how the feature fits the system. Reference the architecture
page(s) it touches. The shared context every sub-issue assumes.>

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 | …     | …     | —          |
| 02 | …     | …     | 01         |

<If the order isn't linear, add a Mermaid dependency graph. Omit this whole section if the
feature is a single sub-issue.>

## Conventions & glossary

<Shared terms and definitions, conventions, and the engineering skills the implementing agent
must apply: /typescript-engineering, /react-ui-engineering.>

## Whole-feature smoke test

<End-to-end check that the assembled feature works, once all sub-issues are done.>

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for <issue link>.
```

## Sub-issue template (`NN-slug.md`)

```markdown
# NN — <title>

**Depends on:** <NN-slug, or omit this line if standalone>
**Part of:** <feature> — see [README](./README.md)

## Context

<One paragraph: what this slice is and why. Everything beyond this lives in the README.>

## Implementation plan

<Detailed, ordered steps with real file paths. Concrete enough that a fresh agent can follow
them without rediscovering the design. Apply the /typescript-engineering skill (server-side TS)
and/or /react-ui-engineering skill (UI) while implementing.>

## Acceptance criteria

<Checks the implementing agent validates before declaring the slice done. Phrase each as
something verifiable, not aspirational.>

- [ ] …
- [ ] …

## Smoke test

<A concrete, runnable check that proves *this slice* works using what already exists — a
`mise run test`/`check` invocation against the **current** suite, a CLI/tRPC call with expected
output, or a manual `mise run cluster:*` step. Never "verify it works," and never "add a test
that …" — the smoke test exercises existing checks and manual steps, it does not author new
tests.>

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
user can confirm it by hand.
```

</supporting-info>