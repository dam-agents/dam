---
name: adr-policy
description: >
  Review-time policy check for pull requests that touch `docs/adrs/`. Surfaces the
  deterministic ADR immutability gate (`mise run //docs:check:adr-immutable`) and adds the
  judgment checks a script cannot own: re-litigation of settled decisions, `supersedes`
  pointer correctness, and summary honesty. Scope is ADR log integrity and decision
  judgment only — the ADR files, their frontmatter, and git history. Docs-match-the-code
  is doc-drift's job, not this skill's. Triggers on phrases like "adr policy", "check
  this ADR", "review the ADR change", "is this ADR re-litigating", "is supersedes
  correct". Also invocable via the `/adr-policy` slash command.
---

# ADR Policy

Reviews changes to the **ADR log** under [`docs/adrs/`](../../../docs/adrs/), an
immutable event log with two projections (architecture docs, generated index). This
skill owns **log integrity and decision judgment** and is read-only: it outputs findings
and never edits ADRs. Fixes go through the [`/adr`](../adr/SKILL.md) flow as separate
work.

## Scope

- **In**: files under `docs/adrs/`, their frontmatter, and the diff's git history
  (base-to-head).
- **Out**: whether architecture docs match the code; that is
  [`doc-drift`](../doc-drift/SKILL.md). Never flag docs-vs-code drift here.
- **Out**: whether code "should have an ADR". Humans file ADRs before work begins.

## Read discipline

Agent reads of ADRs are gated to authoring and recompiling; a review pass counts as an
authoring-adjacent read. Read [`docs/adrs/index.md`](../../../docs/adrs/index.md) first,
then only the ADRs changed in the diff and any `supersedes` target they name. Never read
the log wholesale to understand the current system.

## Checks

### 1. Immutability (deterministic: surfaced, never re-judged)

An accepted ADR body is never rewritten; a standalone script owns that invariant, not an
LLM. Run it and relay the result verbatim as the first line of the ADR section:

```bash
mise run //docs:check:adr-immutable -- --merge-base
```

Never second-guess it, soften a failure, or re-derive the verdict from diffs. This skill
is one surface of the check, not its owner.

### 2. Re-litigation (judgment)

Does a new or changed ADR re-decide something settled or already superseded without
saying so? Scan the index one-liners for records in the same decision space. Reversing or
narrowing a live decision requires `supersedes` pointing at it; merely restating a
settled one is churn. Flag either.

### 3. `supersedes` correctness (judgment)

For `supersedes: NNN`: does `NNN` exist, and is it the record actually being replaced
(not a sibling, not one a third ADR already superseded), i.e. the *live* decision this ADR
overrides? A misaimed link silently corrupts the derived status in the index.

### 4. Summary honesty (judgment)

Does `summary` state what the `Decision` body decided? The index projects it and readers
usually read it *instead of* the record, so a summary that oversells, hedges or describes
a different decision is a defect at the most-read layer.

## Report

One ADR section:

- **Immutability**: the script's verdict verbatim, `✅` or its `❌` lines. `❌` is
  **blocking**; the gate fails the build regardless of this skill.
- **Judgment findings**: each re-litigation / `supersedes` / summary issue with the ADR
  file, the frontmatter field or body claim, and the question the human must answer.
  **Surfaced, not blocking.**

Nothing wrong → the section is just the `✅` line.

**One pass with doc-drift.** On a PR touching `docs/adrs/` or `docs/architecture/`, the
code-review agent runs this skill and [`doc-drift`](../doc-drift/SKILL.md) together and
folds both into one report. This skill covers the log, doc-drift the docs; they stay
separate for single responsibility.
