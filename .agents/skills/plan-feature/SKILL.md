---
name: plan-feature
description: >
  Turn a GitHub issue into an implementation plan under docs/plan/<feature>/: a feature spec
  decomposed into self-contained, independently-shippable sub-issues. Use when the user wants to
  plan a feature, decompose a GitHub issue into sub-issues, or produce an implementation plan from
  an issue.
---

This skill turns a GitHub issue into a feature spec and implementation plan: a `README.md`
plus one Markdown file per sub-issue, written under `docs/plan/<feature-slug>/`.

**The plan files are temporary.** They are working artifacts for the implementation phase, not
permanent docs. Write them to disk, but **never `git add` or commit them, and never add them to
`.gitignore`.** They will show as untracked — that is intended. A separate skill,
`implement-feature`, consumes them and cleans them up at the end.

A sub-issue is "self-contained" in the sense that **README + that sub-issue together** give a
fresh agent (plus the linked issue/ADR) everything needed to implement the slice cold. Shared
context lives once in the README; each sub-issue carries only what is specific to it.

## Steps

### 1. Gather context

- Fetch the issue with `gh` (accept a URL or a number). Read the title, body, and discussion.
- If the issue links an ADR, read it. Don't write ADRs here — if the work hinges on an
  undocumented, hard-to-reverse decision, the grill step (below) is where it surfaces and an ADR
  gets filed.
- Read the relevant architecture page(s) under [`docs/architecture/`](../../../docs/architecture/),
  starting from [`docs/architecture.md`](../../../docs/architecture.md). The docs are the source
  of truth for *why* the system is shaped the way it is.
- Explore the codebase to ground the plan in real files, modules, and seams. Use the `Explore`
  agent for breadth.

### 2. Grill — mandatory gate

**This is a hard gate. You MUST run a grilling session and get the user's explicit sign-off
before step 3. Create nothing under `docs/plan/` until then — no decomposition outline, no
files.** This holds even when the plan feels obvious: a short session confirming shared
understanding is the floor, never a step to skip.

Invoke `/grill-with-adr` to run it — that skill is the canonical procedure. But the gate does
**not** depend on the nested call landing: if it doesn't fire, run the session yourself, one
question at a time, recommending an answer to each. Either way the session must:

- Resolve scope, boundaries, edge cases, where things live, and naming — walking each branch of
  the decision tree. Prefer exploring the codebase over asking whenever a question is answerable
  there.
- Challenge the plan's vocabulary against [`docs/ubiquitous-language.md`](../../../docs/ubiquitous-language.md),
  sharpen fuzzy terms to canonical ones, and cross-reference claims against the code.
- File or amend an ADR (via `/adr`) — sparingly, only when a decision is hard to reverse,
  surprising without context, and the result of a real trade-off.

**Exit condition:** every branch of the decision tree is resolved and the user confirms they're
satisfied. Only then proceed to step 3.

### 3. Decompose and get sign-off

Decide how the feature splits into sub-issues:

- **Split only along independently-shippable seams** — e.g. one slice for tRPC methods, one for
  API endpoints, one for UI. (Illustrative, not a fixed taxonomy.)
- **Do not split artificially.** If the feature is small, a single sub-issue is correct. Each
  sub-issue should be sized to roughly one atomic commit's worth of work — big enough to be
  meaningful, small enough for an agent to implement comfortably.

Present the **decomposition outline** to the user and wait for explicit approval before writing
the detailed files:

- Feature summary (1–2 sentences).
- The sub-issue list: number, title, one-line scope, and dependency order.

### 4. Write the files

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

### 5. Report

Print where the plan lives and a one-paragraph summary of the sub-issues and their order. Remind
the user the files are uncommitted working artifacts, and that `/implement-feature` is the next
step.

## README.md template

```markdown
# <Feature title>

> Working plan — uncommitted, temporary. Delete once the feature ships.

**Issue:** <link>
**ADR:** <link, or "none">

## Goal

<What we're building and why, from the issue + grill. User-visible outcome.>

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
