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

Reviews code changes against the **architecture documentation** under
[`docs/architecture/`](../../../docs/architecture/), enforcing only the **drift rule** in
[`docs/guidelines/documentation-guidelines.md`](../../../docs/guidelines/documentation-guidelines.md):

> When your work changes the behavior or responsibility of a subsystem, update its page in the same PR.

It reads the diff and the pages and reports mismatches. It is read-only: findings carry
proposed edits; applying them is separate work.

## Scope: architecture docs only

Only [`docs/architecture/`](../../../docs/architecture/) and the landing page
[`docs/architecture.md`](../../../docs/architecture.md). Never flag anything else, even if it
looks drifted:

- Vocabulary in [`docs/ubiquitous-language.md`](../../../docs/ubiquitous-language.md).
- ADRs (`docs/adrs/`), except check 7: never flag "this code should have an ADR", ADR prose,
  or ADR coverage. Log integrity, re-litigation, `supersedes` correctness and summary honesty
  are [`adr-policy`](../adr-policy/SKILL.md)'s job.
- READMEs, `CLAUDE.md`, code comments, guidelines, strategy docs, and cross-reference rot in
  non-architecture docs.

## Direction: code → docs

Code leads, docs trail. Drift exists only when **code in the diff** changes a subsystem's
behavior or responsibility and its architecture page doesn't reflect it. Anchor every check
1–6 on a concrete code change in the diff. ADRs are human-first, so no check 1–6 may depend
on an ADR's content or existence: if an ADR is the only evidence, drop the finding silently,
without narrating the exclusion.

## Checks

1. **Architecture-page drift**: code in the diff alters a subsystem's behavior or
   responsibility (subsystems listed in [`docs/architecture.md`](../../../docs/architecture.md))
   → its page under `docs/architecture/` must change in the same PR.
2. **`Last verified:` staleness**: every architecture page edited in the diff has its
   `Last verified: YYYY-MM-DD` header bumped to the PR date.
3. **ADR reference leak**: a page in the diff contains an ADR link, an `ADR-NNN` mention, or a
   `Motivated by:` section (the guidelines forbid ADR references).
4. **Volatile content leak**: a page edit *adds* exact package names, file paths, a Helm
   template tree, or library-level choices below framework level (forbidden); link out instead.
5. **New subsystem without a page**: the diff adds a long-lived component (controller, daemon,
   gateway, …) without a new `docs/architecture/` page linked from the landing page.
6. **Cross-reference rot**: only when the diff moves, renames or deletes an architecture page,
   inbound links from other architecture pages and `docs/architecture.md` must be updated.
   Links from outside `docs/architecture/` are out of scope.
7. **ADR state-change impact** (the sole ADR-anchored check): the diff flips an accepted ADR to
   `deprecated` or supersedes it (a new ADR whose `supersedes` points at a live record) → the
   page named by that ADR's `subsystem` may still describe the old state. The size cap only
   catches rot on growth, and a superseded decision rots a page at unchanged size, so nothing
   else catches this. Flag the page ⚠️ **possible drift**, "an ADR it derives from changed
   state; needs a re-fold look": never ❌, never a prescribed edit. No ADR status change → no
   output.

## Report

- **Verdict**: one line, `aligned`, `minor drift`, or `significant drift`.
- **Drift**: every ❌ with file/line evidence and the proposed edit, grouped by check.
- **Possible drift**: every ⚠️ with the question a human must answer.

Excluded items (trivial, out of scope, every ADR concern but check 7) appear nowhere in the
report: not in a section, a parenthetical or a footnote. Nothing to flag → just the verdict.

The report may be one section of a larger process (e.g. a code review that embeds it and
continues); it is then an intermediate result, not the final deliverable, and what the caller
does with it is not this skill's concern. It holds findings only, a verdict, drift entries and possible-drift questions,
and states no conclusion about the surrounding process and no instruction to the caller.

## Guidelines

- **The documentation guidelines are the sole rulebook.** Invent no rules; don't flag what
  they don't forbid (e.g. short pages: there is no length cap).
- **Trivial changes are exempt**: README typos, comment-only edits, dependency bumps without
  behavior change, lint fixes, test-only changes. Don't report them.
- **One pass with adr-policy.** On a PR touching `docs/adrs/`, the code-review agent runs both
  skills together; keep to docs-vs-code (plus check 7) here.
