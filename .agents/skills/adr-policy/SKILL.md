---
name: adr-policy
description: >
  Review-time policy check for pull requests that touch `docs/adrs/`. Surfaces the
  deterministic ADR immutability gate (`scripts/adr-immutable.mjs`) and adds the
  judgment checks a script cannot own: re-litigation of settled decisions, `supersedes`
  pointer correctness, and summary honesty. Scope is ADR log integrity and decision
  judgment only — the ADR files, their frontmatter, and git history. Docs-match-the-code
  is doc-drift's job, not this skill's. Triggers on phrases like "adr policy", "check
  this ADR", "review the ADR change", "is this ADR re-litigating", "is supersedes
  correct". Also invocable via the `/adr-policy` slash command.
---

# ADR Policy

Reviews changes to the **ADR log** under [`docs/adrs/`](../../../docs/adrs/) at review
time. The ADR model is an immutable event log with two projections (architecture docs,
generated index); see the split in
[`docs/design/adr-governance.md`](../../../docs/design/adr-governance.md).

Enforcement is split by what needs judgment. This skill owns **log integrity and
decision judgment**. It does **not** rewrite ADRs — it surfaces findings, the user
decides.

## Scope: the ADR log only

- **In scope**: files under `docs/adrs/`, their frontmatter, and the git history of the
  diff (base-to-head).
- **Out of scope**: whether the architecture docs match the code — that is
  [`doc-drift`](../doc-drift/SKILL.md). Never flag docs-vs-code drift here.
- **Out of scope**: whether some code "should have an ADR." ADRs are filed by humans
  before work begins; coverage is never this skill's call.

## Read discipline

ADRs are human-first; agent reads are gated to authoring and recompiling. A review pass
is an authoring-adjacent read: read [`docs/adrs/index.md`](../../../docs/adrs/index.md)
first, then open only the ADR files changed in the diff and any record a changed ADR
points at (its `supersedes` target). Never read the log wholesale to understand the
current system.

## What this skill checks

### 1. Immutability (deterministic — surfaced, never re-judged)

The one invariant the read model rests on — an accepted ADR body is never rewritten — is
owned by a standalone deterministic script, never by an LLM. Run it and surface its
result verbatim:

```bash
node scripts/adr-immutable.mjs --merge-base
```

Report its pass/fail as the first line of the ADR section so everything lands in one
place. Do **not** second-guess it, soften a failure, or re-derive the verdict by reading
diffs yourself. One check, multiple surfaces: this skill is a surface, not the owner.

### 2. Re-litigation (judgment)

Does a new or changed ADR re-decide something already settled — or already superseded —
without acknowledging it? Scan the index one-liners for records covering the same
decision space. If the new ADR reverses or narrows a live decision, it must point at it
with `supersedes`; if it merely restates a settled one, that is churn. Flag either.

### 3. `supersedes` correctness (judgment)

When a changed ADR carries `supersedes: NNN`:
- Does id `NNN` exist, and is it the record actually being replaced (not a sibling or a
  record already superseded by a third ADR)?
- Is the superseded decision genuinely the *live* one this ADR overrides? A forward link
  aimed at the wrong record silently corrupts the derived status the index shows.

### 4. Summary honesty (judgment)

Does the one-line `summary` frontmatter state what the `Decision` body actually decided?
The summary is projected into the index and read *instead of* the record most of the
time, so a summary that oversells, hedges, or describes a different decision than the
body is a defect — it steers readers wrong at the cheapest, most-read layer.

## Report

Produce one ADR section:

- **Immutability** — the script's verdict, verbatim. `✅` or the `❌` lines it printed.
  A `❌` here is **blocking**; the deterministic gate fails the build regardless of this
  skill.
- **Judgment findings** — every re-litigation / `supersedes` / summary issue, with the
  ADR file and the specific frontmatter field or body claim it concerns, and the
  question the human must answer. These are **surfaced, not blocking**.

If nothing is wrong, the section is just the immutability `✅` line.

## Guidelines

- **Read-only.** Never edit ADRs; propose, the user decides. Fixing a re-litigation or
  summary problem means authoring or amending an ADR through the [`/adr`](../adr/SKILL.md)
  flow, not editing here.
- **Never own immutability.** The script is authoritative. This skill only relays it.
- **One pass with doc-drift.** On a PR touching `docs/adrs/` or `docs/architecture/`, the
  code-review agent runs this skill and [`doc-drift`](../doc-drift/SKILL.md) together and
  folds both into one report. This skill covers the log; doc-drift covers the docs. They
  stay separate to keep single responsibility.
