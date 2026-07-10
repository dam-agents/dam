# Documentation Guidelines

Rules for writing project documentation under [`docs/`](../).

## Structure

Docs are split into a few kinds. Pick the right one before writing — putting the wrong content in the wrong place is the most common drift source.

- **Guidelines** ([`docs/guidelines/`](.)) — rules to follow when writing docs, issues, or PRs. This page is one. Prescriptive, not descriptive.
- **Strategy** ([`docs/strategy/`](../strategy/)) — high-level overview of what Platform is trying to be, for product, security, and positioning audiences. Independent of how the current system happens to be built.
- **Architecture** ([`docs/architecture/`](../architecture/)) — the authoritative architectural overview of the system as it exists today. One page per subsystem, indexed from [`docs/architecture.md`](../architecture.md).

- **ADRs** ([`docs/adrs/`](../adrs/)) — Architecture Decision Records. Filed *before* work begins on anything that requires an important decision, so the reasoning is captured up front. One ADR per decision. An immutable event log; the architecture pages and the [ADR index](../adrs/index.md) are projections of it. Use the `/adr` skill. See [ADR Guidelines](#adr-guidelines) for the rules.

## Vocabulary

Use the ubiquitous language defined in [`tseng/vocabulary.md`](../../tseng/vocabulary.md). Terms there (Template, Agent, Session, Channel, Fork, Secret, …) are scoped to bounded contexts — match that scoping in docs. Docs do not introduce new domain terms; code does, and docs follow.

## Architecture Documentation Guidelines

Architecture pages are the **authoritative, self-contained description of the current system** — both what it looks like and enough of the *why* to work in it. They must stand alone: a reader never needs an ADR to understand a page, and pages never link to ADRs. Make drift the harder path, not the default.

### Structure

- One page per subsystem under [`docs/architecture/`](../architecture/), indexed from [`docs/architecture.md`](../architecture.md).
- Adding a new subsystem means adding a new page and linking it from the landing page.
- No shared template. Free-form per page. Hard [size cap](#size-cap) per page and on the landing page.
- Cross-page concept ownership: one page owns each concept in depth; others one-liner + cross-link.

### Mandatory headers

Each subsystem page starts with one header directly under the title:

- `Last verified: YYYY-MM-DD` — bumped whenever you edit the page. A date older than the last subsystem refactor is a smell.

### Content policy

**Durable content only.** Architecture pages outlive refactors; volatile facts rot. Write at the altitude of architecture — roles, decisions, couplings, and contracts — in the project's [ubiquitous language](#vocabulary), not at the altitude of the code. If a sentence would break when someone renames a field, reorders a function's arguments, or adds an optional property, it is pitched too low — raise it until it describes the *meaning*, not the *shape*.

- **Include**: component roles, who-talks-to-whom, protocols *and what their messages mean*, persistence substrates, resource-model invariants, framework-level tech, security layers, trust boundaries.
- **Omit**: exact package names, file paths, Helm template tree, implementation phase markers, library-level choices below framework level, and **code-level shape** — type signatures, field names, function arguments, enum members. Name the concept in domain vocabulary, not the symbol in the code.
- **Describe protocols semantically.** A protocol belongs on the page; its literal type signature does not. Say what is exchanged and what each outcome *means* — e.g. "`applyState` returns either *applied* (with any per-driver failures) or *stale*" — then link out to the contract package as the field-level source of truth. Do not transcribe the type; a reader who needs exact fields follows the link, and the page never drifts when those fields change.
- **Link out** for volatile content rather than restating it (repo paths like [`packages/`](../../packages/), [`deploy/helm/platform/templates/`](../../deploy/helm/platform/templates/)).

Shared vocabulary is what makes this safe: because [code names concepts in the same ubiquitous language the docs use](#vocabulary), speaking abstractly is not vaguer than the code — it is the same concept, named once, at the level that survives.

### Size cap

Architecture pages are a bounded projection of the [ADR log](#adr-guidelines), capped by construction. The cap is not a budget; it is the forcing function that keeps the projection reduced and pushes rationale down into the log.

- Measured in characters. Per-page cap plus a harder cap on the always-loaded landing page ([`docs/architecture.md`](../architecture.md)).
- Enforced two ways off one measurement: `mise run docs:check:doc-size` (runs in `mise run check` + CI, authoritative, covers human edits) and a PreToolUse hook on `docs/architecture/**` that rejects an over-budget Write/Edit in-session.
- Over budget is not a trim-to-fit signal. Do not delete meaning. Reconcile: tighten prose, merge related statements, or push detail and rationale into an ADR. If a subsystem genuinely no longer fits, its boundaries may be wrong — stop and surface that to a human. Splitting a page or redrawing subsystem boundaries is a human decision, not an autonomous reconcile; do not shrink meaning.

### Diagrams

- Mermaid only — renders on GitHub, reviewable as text in PR diffs.
- One system-context diagram on the landing page.
- Subsystem pages include a diagram only if it adds clarity: sequence diagrams for flows, component diagrams for topology.
- Box labels use code names (`api-server`, `agent-runtime`, `envoy`, …).

### Links

- Repo-relative, pointing to main (no SHA pins).
- Never link to ADRs.

### Drift rule

When your work changes the behavior or responsibility of a subsystem, update its page in the same PR.

## ADR Guidelines

ADRs are an append-only event log. The architecture pages ("what is") and the generated ADR index ("what was decided, live or not") are both projections of that log, never hand-maintained sources of truth.

### Immutability

- An accepted ADR body is frozen. The only permitted change to an accepted record is stamping its supersession.
- Superseded, not rewritten. A reversal is a new ADR carrying `supersedes: <id>`; the old record stays as filed. The superseded status is *derived* from the forward link, so nobody hand-edits the old file.
- No deleting or renaming an accepted ADR — that rewrites history and breaks the id.
- Enforced deterministically by `mise run docs:check:adr-immutable` (staged-vs-HEAD in precommit, merge-base in CI). New ADRs are free.

### Reads are human-first

ADRs exist for humans; the architecture pages are the agent-facing source of truth. Agents read the log for exactly two jobs — authoring a new ADR (you need the dead branches the projection deletes) and recompiling docs (the only wholesale read). Ordinary work — implementing, understanding the current system — uses the architecture pages, never the log. A superseded decision must not leak into implementation as if it were live.

### Generated index

[`docs/adrs/index.md`](../adrs/index.md) is generated from ADR frontmatter, never hand-edited. Read it first when authoring: scan the one-line summaries, open only the two or three records that matter. Each ADR carries `id`, `title`, `status`, `supersedes`, `subsystem`/`tags`, and a one-line `summary`; the generator resolves supersession and computes each record's live/superseded status. `mise run docs:check:adr-index` (in `mise run check` + CI) fails if the committed index does not match regeneration — run `mise run docs:generate:adr-index` after editing an ADR.

### No ADR references in docs or code

Architecture pages stand alone and never link to an ADR; neither does code. Traceability from an ADR back to the page it affects serves only the maintenance process (recompile scoping and supersession impact), and rides the `subsystem`/`tags` frontmatter already carried for the index — no sidecar, no forward pointer in prose. The tag is a frozen historical fact about the subsystem as it stood then; a later page split maps old names to current pages via an alias table rather than rewriting immutable ADRs.

