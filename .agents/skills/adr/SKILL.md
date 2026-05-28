---
name: adr
description: >
  Tracks Architecture Decision Records (ADRs) in docs/adrs/.
  Creates, lists, and updates ADRs following project conventions.
  TRIGGER when: user wants to record, review, or update an architectural decision.
argument-hint: "[what you'd like to do]"
---

# ADR Tracking

Manage Architecture Decision Records in `docs/adrs/`. Interpret `$ARGUMENTS` as natural language.

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

## Creating an ADR

Ask the user for any missing information. You need at minimum: title, context, decision, and owner (@github-username).

If the decision is made → create `docs/adrs/NNN-short-title.md` with status `Accepted`.
If the decision is open → create `docs/adrs/DRAFT-short-title.md` with status `Proposed`.

Assign the next number by reading `docs/adrs/index.md`. Always update the index after creating a file.

## Updating an ADR

Valid status transitions: `Accepted`, `Deprecated`, `Superseded by ADR-NNN`.

When promoting a Draft to Accepted: rename `DRAFT-title.md` → `NNN-title.md` and move the row from Drafts to Accepted in the index.

## Conventions

- **Accepted**: `NNN-short-title.md` — numbered, zero-padded to 3 digits, never reused
- **Drafts**: `DRAFT-short-title.md` — no number until accepted
- **Owner**: the person accountable for the decision — drives it to resolution, revisits if context changes
- File names: short kebab-case, 2-3 words max
- Index: `docs/adrs/index.md` — always keep in sync

## Template

See [`docs/adr-template.md`](../../../docs/adr-template.md) for the section skeleton.
