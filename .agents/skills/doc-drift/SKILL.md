---
name: doc-drift
description: >
  Detect drift between code changes and architecture documentation under `docs/architecture/`.
  Inspects a PR, branch, or local diff against the project's documentation guidelines
  (`docs/guidelines/documentation-guidelines.md`) and flags places where architecture pages
  no longer match the code — missing page updates, stale `Last verified:` dates, missing
  pages for new subsystems, volatile content or ADR references leaking into pages. Scope is
  architecture docs only — vocabulary, ADRs, READMEs, and other docs are out of scope. Triggers on phrases like "doc drift", "docs drift",
  "are the architecture docs in sync", "check documentation drift", "do the docs need
  updating", or "architecture documentation review". Also invocable via the `/doc-drift`
  slash command.
---

# Doc Drift

Reviews code changes against the project's **architecture documentation** under
[`docs/architecture/`](../../../docs/architecture/). The contract is the **drift rule** in
[`docs/guidelines/documentation-guidelines.md`](../../../docs/guidelines/documentation-guidelines.md):

> When your work changes the behavior or responsibility of a subsystem, update its page in the same PR.

This skill operationalizes that rule, **and only that rule**. It reads the diff, reads the
architecture pages, and reports mismatches. It does **not** rewrite docs — its output is a set
of findings with proposed edits; applying any of them is separate work outside this skill.

## Scope: architecture docs only

This skill is narrowly scoped to [`docs/architecture/`](../../../docs/architecture/) and the
landing page at [`docs/architecture.md`](../../../docs/architecture.md). Everything else is
**out of scope** — do not flag it, even if it looks drifted:

- Vocabulary in [`tseng/vocabulary.md`](../../../tseng/vocabulary.md).
- ADRs (`docs/adrs/`) — out of this skill's scope with **one** narrow exception (check 7
  below): never flag "this code should have an ADR", ADR prose quality, or anything else
  about ADR coverage. ADR log integrity and decision judgment are
  [`adr-policy`](../adr-policy/SKILL.md)'s job.
- READMEs, `CLAUDE.md`, code comments, guidelines, strategy docs.
- Cross-reference rot in non-architecture docs.

If a check would land outside `docs/architecture/`, drop it.

## Direction of drift: code → docs

Code leads, docs trail. Drift is measured **code vs docs**, in that direction only. ADRs play
no part in the code→docs checks (1–6): they are human-first, so no code-drift check may depend
on an ADR's content or existence.

Drift only exists when **code in the diff** changes subsystem behavior/responsibility and the
matching architecture page does not reflect that code. Anchor every code→docs check on something
concrete in the diff. If the only evidence for one of those checks is "an ADR exists", ignore it
— silently. Do not narrate the exclusion.

**One exception (check 7):** an ADR *state change* in the diff — an accepted record flipped to
deprecated/superseded — flags its own `subsystem` page as *possible* rot. This is the sole
ADR-anchored signal, it is never blocking, and it flags a page for a human look, not a required
edit. Everything else about ADRs stays out of scope.

## What this skill checks

Each check is grounded in code changes observed in the diff and lands inside
[`docs/architecture/`](../../../docs/architecture/):

1. **Architecture-page drift** — if code in the diff alters behavior or responsibility of a
   subsystem, the corresponding page under `docs/architecture/` must be updated in the same
   PR. Subsystems are listed in [`docs/architecture.md`](../../../docs/architecture.md).
2. **`Last verified:` staleness** — every architecture page edited in the diff must have its
   `Last verified: YYYY-MM-DD` header bumped to the PR date.
3. **ADR reference leak** — architecture pages must not link or reference ADRs (the guidelines
   forbid it). If a page in the diff contains an ADR link, an `ADR-NNN` mention, or a
   `Motivated by:` section, flag it.
4. **Volatile content leak** — if an architecture page was edited to *add* exact package names,
   file paths, Helm template tree, or library-level choices below framework level, that is
   drift toward volatility (the guidelines forbid it). Link out instead.
5. **New subsystem without a page** — if the diff introduces a new long-lived component
   (controller, daemon, gateway, …) it needs a new page under `docs/architecture/` linked from
   the landing page.
6. **Architecture-doc cross-reference rot** — only when an architecture page itself is moved,
   renamed, or deleted in the diff: inbound links from *other architecture pages* and from
   `docs/architecture.md` must be updated. Inbound links from outside `docs/architecture/`
   are out of scope.
7. **ADR state-change impact** (the one ADR-anchored check) — if the diff flips an accepted
   ADR to `deprecated` or supersedes it (a new ADR whose `supersedes` points at a live
   record), the page named by that ADR's `subsystem` frontmatter may still describe the
   superseded state. The cap only catches rot on *growth*; a superseded decision rots a page
   at unchanged size, so nothing else catches it. Flag that page as ⚠️ **possible drift** —
   "an ADR it derives from changed state; needs a re-fold look." Never a ❌, never an edit you
   prescribe: net-new state, not observed mismatch. Anchor on the ADR status change in the
   diff; if no ADR status changed, this check produces nothing.

## Report

The skill's result is a focused drift report — a structured finding, not an act of delivery.
Assemble the checks' output into this format:

- **Verdict** — one line: `aligned`, `minor drift`, or `significant drift`.
- **Drift** — every ❌, with file/line evidence and the proposed edit. Group by check number.
- **Possible drift** — every ⚠️, with the human-judgement question that needs answering.

Items excluded by the rules above (trivial, out-of-scope, and every ADR concern except the
check-7 state-change signal) must not appear anywhere in the report — not in either section,
not as a parenthetical, not as a footnote. If there is nothing to flag, the report is just the
verdict.

This skill may run as one sub-step of a longer process — for example, one section of a broader
code review whose caller embeds the report and continues with its own remaining steps. The
report is then an intermediate result, not the final deliverable, and what the caller does
with it is not this skill's concern. Nothing in the report may read as a completion or
termination signal, and it must carry no imperatives aimed at the caller — no "done", "no
further action needed", "present this to the user", "stop here", or the like.

## Guidelines

- **Read-only.** This skill never edits documentation — it only proposes fixes inside its
  findings. Applying a proposed fix is separate follow-up work outside this skill's run.
- **The documentation guidelines are the sole rulebook.** Do not invent rules. Do not flag things
  the guidelines don't forbid (e.g., short architecture pages — there is no length cap).
- **Trivial changes are exempt.** README typos, comment-only edits, dependency bumps with no
  behavior change, lint fixes, and test-only changes do not trigger doc drift. Don't report.
- **Code is the anchor** for checks 1–6. Every flagged code→docs drift must point at a concrete
  code change in the diff. Never flag such drift whose only evidence is an ADR file or its
  absence. Check 7 is the lone exception: it anchors on an ADR *status change* in the diff and
  only ever emits ⚠️, never ❌.
- **Log integrity is not this skill's job.** Re-litigation, `supersedes` correctness, and summary
  honesty belong to [`adr-policy`](../adr-policy/SKILL.md). On a PR touching `docs/adrs/` the
  code-review agent runs both skills in one pass; keep to docs-vs-code (plus check 7) here.