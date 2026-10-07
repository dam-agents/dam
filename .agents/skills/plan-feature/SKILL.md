---
name: plan-feature
description: >
  Turn a GitHub issue into an implementation plan under docs/plan/<feature>/: a feature spec
  decomposed into context-window-sized sub-issues, committed as the first commit of the feature
  branch with a draft PR. Use when the user wants to plan a feature, decompose a GitHub issue
  into sub-issues, or produce an implementation plan from an issue.
---

<what-to-do>

Turns a GitHub issue into a feature spec and implementation plan: `README.md` plus one Markdown
file per sub-issue under `docs/plan/<feature-slug>/`. The plan is a working artifact, not a
permanent doc, but it lives in git: planning ends by creating the feature branch with the plan as
its **first commit** and opening a **draft PR** (step 4). `/implement-feature` picks up that
branch and ends with a commit deleting `docs/plan/<feature-slug>/` before marking the PR ready;
the `Plan check` CI job fails while `docs/plan/` exists, so the plan never merges.

A sub-issue is self-contained: **README + that sub-issue** (plus the linked issue) give a fresh
agent everything to implement the slice cold. Shared context lives once in the README; each
sub-issue carries only what is specific to it.

## Steps

### 1. Assess context, fill the gaps

**Prerequisite:** know the problem. If the issue isn't in context, fetch it with `gh` (URL or
number) and read title, body and discussion. This skill usually follows a conversation that
already discussed the feature; don't redo that work.

Context is enough when no open question (scope, boundaries, edge cases, where things live,
naming) could change the decomposition, and the plan is grounded in the relevant pages under
[`docs/architecture/`](../../../docs/architecture/) and in real files, modules and seams.

**If it falls short, stop.** Don't gather it yourself: tell the user what's missing or
undecided and let them supply or discuss it. Offer `/grill-me` as one way to close the gaps, but
leave the choice to them. Proceed only when context suffices.

### 2. Decompose and get sign-off

- **Size for one context window**: roughly one atomic commit a fresh agent implements comfortably
  in one window. Slices needn't ship independently (the feature lands as one PR), but each leaves
  the branch green and is concretely verifiable on its own.
- **Separate behaviors → vertical slices**: each behavior (e.g. list view, delete action) is one
  slice through every layer it needs.
- **One behavior too deep for a window → split horizontally** along the tRPC contract: pin the
  contract in the README so both sides implement against it, and order backend before UI. A
  backend-only slice is still verifiable (tRPC/CLI call with expected output); end-to-end
  verification moves to the whole-feature smoke test.
- **Don't split artificially**: a small feature is one sub-issue.

Present the **decomposition outline** (feature summary in 1–2 sentences; sub-issues with
number, title, one-line scope, dependency order) and wait for explicit approval before writing
the files.

### 3. Write the files

Create `docs/plan/<feature-slug>/`, slug from the issue title prefixed with the issue number
(e.g. `docs/plan/344-egress-cli/`). Write `README.md` and one `NN-slug.md` per sub-issue
(`01-`, `02-`, … encode order) from the templates below. While drafting:

- Apply `/typescript-engineering` (server-side TS) and `/react-ui-engineering` (UI,
  `packages/ui`), and name the relevant skill in each sub-issue so the implementer applies it.
- **Don't prescribe new tests.** The implementer doesn't author tests by default; verification
  is the **existing** suite (`mise run test` / `mise run check`) plus a **manual** smoke test.
  Call for a new test only when behavior is otherwise unverifiable (e.g. a pure algorithm with
  tricky edges and no manual smoke path), flagged as the exception.

### 4. Branch, commit, open a draft PR

Branch from `main` as `<type>/<NNN-slug>`: slug = plan folder, type per the issue's nature and
the branch convention (plan `docs/plan/344-egress-cli/` → `feat/344-egress-cli`).
`implement-feature` derives the same name to find it.

First commit: the plan files, `docs(plan): 344-egress-cli`, `git commit -s`, body line
`Refs #NNN`. Push and open a **draft** PR with the `pr-open` skill (add `-F draft=true` to its
POST), titled with the feature title, body per the template below (product-level overview plus one checkbox per sub-issue). Its
`author-decisions` block records what the user decided while the plan was discussed.

Plan changes requested after the user reads the files → amend and force-push (safe while the
branch carries only the plan commit).

### 5. Report

Branch name, draft PR link, plan location, and one paragraph on the sub-issues and their order.
Remind the user the plan is the branch's first commit, removed before the feature ships, and that
`/implement-feature` is next.

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