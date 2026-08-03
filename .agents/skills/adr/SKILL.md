---
name: adr
description: >
  Tracks Architecture Decision Records (ADRs) in docs/adrs/.
  Creates and updates ADRs following project conventions.
  TRIGGER when: user wants to record or update an architectural decision.
argument-hint: "[what you'd like to do]"
---

# ADR Tracking

Manage Architecture Decision Records in `docs/adrs/`. Interpret `$ARGUMENTS` as natural language.

ADRs are human-first: for ordinary work the agent-facing source of truth is the architecture docs, not the log. Reading `docs/adrs/` is allowed only for the job this skill does — authoring or updating an ADR. When you do, read `docs/adrs/index.md` first, then open only the records it points you to. Never read the log to understand the current system.

## What an ADR is, and what it isn't

An ADR is a **decision**, not a design document. It captures *what was decided* and *why*, so a future reader can recover the reasoning without rereading the surrounding code. It is not the place to explain how the decision is implemented.

A good ADR is short. Aim for under ~100 lines of body content. If a record is growing past one screen of prose, you're writing a design doc — the parts you'd cut to fit the shorter shape aren't worth keeping.

## Writing rules

- **Lead with the thesis.** The first one or two sentences of `Decision` must state what was decided. A reader who stops there should already have the answer.
- **Name the decision, not the mechanism.** Don't name anything that could plausibly be renamed during implementation without changing the decision. Type names, function signatures, library version pins, env var names, struct fields, internal file paths — out. Interface-level names that the decision is *about* (a destination directory contract, a protocol identifier) are fine.
- **Consequences are non-optional, and balanced.** Every ADR ends with `Easier / Harder / Committed-to`. Both pros and cons must appear — a Consequences section with only upsides is a sales pitch, not a decision record. Drop labels that don't apply; add a fourth only when it captures something the three don't. This is the part future readers come back for.
- **Consequences must be objective.** Each bullet is backed by concrete evidence: a measurement, a prior incident, a constraint from a contract or platform, a count, a deadline. Subjective claims ("feels cleaner", "more elegant", "easier to reason about") don't belong — if you can't point at the evidence, the consequence isn't real enough to record.
- **One-line alternatives.** Each rejected option is `**Name** — reason`. If the reasoning needs a paragraph, the `Decision` section is under-stating something; fix that instead.
- **No code blocks except trivial inline.** Flow diagrams, schemas, and pseudo-code belong in design docs and the code, not the ADR.
- **No re-statement.** If `Consequences` repeats what `Decision` already said, cut it. Each section earns its words.

## Drafting protocol

When creating or updating an ADR:

1. Draft the `Decision` thesis (one or two sentences) before anything else. Show it to the user. If it doesn't survive that read, the rest is wasted work.
2. Fill in `Context` only enough to motivate the thesis. Stop when the reader has enough.
3. Write `Consequences` before `Alternatives Considered`. Knowing the cost makes the alternative comparisons honest.
4. Read the whole thing top to bottom and cut. Remove any sentence that doesn't change the decision or its cost. If two sentences say the same thing, keep the shorter one.

## Frontmatter (required)

Every ADR starts with a YAML frontmatter block. The index is *generated* from it, so the fields must be present and honest:

```yaml
---
id: NNN                    # zero-padded, matches the filename; omit for DRAFT-
title: Title
status: accepted           # accepted | proposed | deprecated
supersedes: NNN            # id this record replaces (optional)
subsystem: gateway         # the architecture page this decision concerns
tags: [envoy, secrets]     # optional free list
summary: One line stating what was decided.
---
```

- `supersedes` is a forward link only. The superseded record's status is *derived* by the generator — never hand-stamp the old file.
- `subsystem` is page-granularity: name the architecture page the decision is about. It drives recompile scoping later.
- `summary` is the one-liner the index shows; write it so a reader can decide whether to open the full record.

## Creating an ADR

Ask the user for any missing information. You need at minimum: title, context, decision, owner (@github-username), and the frontmatter fields above.

If the decision is made → create `docs/adrs/NNN-short-title.md` with status `accepted`.
If the decision is open → create `docs/adrs/DRAFT-short-title.md` with status `proposed` (omit `id`).

Read `docs/adrs/index.md` for the next free number. After creating the file, regenerate the index with `mise run docs:generate:adr-index` — the index is generated, not hand-edited.

## Updating an ADR

Valid status transitions: `accepted`, `deprecated`, and supersession via the *new* ADR's `supersedes` field (never edit the superseded file's body — its status is derived).

Read the target ADR directly. An accepted body is immutable: only its status changes, and only to superseded via the *new* ADR's `supersedes` field. `check:adr-immutable` enforces this at commit, so keep any edit to an accepted record inside that rule.

When promoting a Draft to Accepted: rename `DRAFT-title.md` → `NNN-title.md` with `git mv`, set `id` and `status: accepted` in the frontmatter, then regenerate the index with `mise run docs:generate:adr-index`.

## Conventions

- **Accepted**: `NNN-short-title.md` — numbered, zero-padded to 3 digits, never reused
- **Drafts**: `DRAFT-short-title.md` — no number until accepted
- **Owner**: the person accountable for the decision — drives it to resolution, revisits if context changes
- File names: short kebab-case, 2-3 words max
- Index: `docs/adrs/index.md` — generated from frontmatter by `mise run docs:generate:adr-index`, never hand-edited

## Template

See [`docs/adr-template.md`](../../../docs/adr-template.md) for the section skeleton.
