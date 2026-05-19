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

Look at the template at `docs/adr-template.md` for the expected structure and content of ADR files. Follow that format closely.