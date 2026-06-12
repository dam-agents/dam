# Documentation Guidelines

Rules for writing project documentation under [`docs/`](../).

## Structure

Docs are split into a few kinds. Pick the right one before writing — putting the wrong content in the wrong place is the most common drift source.

- **Guidelines** ([`docs/guidelines/`](.)) — rules to follow when writing docs, issues, or PRs. This page is one. Prescriptive, not descriptive.
- **Strategy** ([`docs/strategy/`](../strategy/)) — high-level overview of what Platform is trying to be, for product, security, and positioning audiences. Independent of how the current system happens to be built.
- **Architecture** ([`docs/architecture/`](../architecture/)) — the authoritative architectural overview of the system as it exists today. One page per subsystem, indexed from [`docs/architecture.md`](../architecture.md).

- **ADRs** ([`docs/adrs/`](../adrs/)) — Architecture Decision Records. Filed *before* work begins on anything that requires an important decision, so the reasoning is captured up front. One ADR per decision. Immutable after acceptance; superseded, not rewritten. Use the `/adr` skill. ADRs are **human-facing only**: agents create them but never read them, and no code or documentation links or references an ADR. Architecture pages are the agent-facing source of truth.

## Vocabulary

Use the ubiquitous language defined in [`tseng/vocabulary.md`](../../tseng/vocabulary.md). Terms there (Template, Agent, Session, Channel, Fork, Secret, …) are scoped to bounded contexts — match that scoping in docs. Docs do not introduce new domain terms; code does, and docs follow.

## Architecture Documentation Guidelines

Architecture pages are the **authoritative, self-contained description of the current system** — both what it looks like and enough of the *why* to work in it. They must stand alone: a reader never needs an ADR to understand a page, and pages never link to ADRs. Make drift the harder path, not the default.

### Structure

- One page per subsystem under [`docs/architecture/`](../architecture/), indexed from [`docs/architecture.md`](../architecture.md).
- Adding a new subsystem means adding a new page and linking it from the landing page.
- No shared template. Free-form per page. No length cap.
- Cross-page concept ownership: one page owns each concept in depth; others one-liner + cross-link.

### Mandatory headers

Each subsystem page starts with one header directly under the title:

- `Last verified: YYYY-MM-DD` — bumped whenever you edit the page. A date older than the last subsystem refactor is a smell.

### Content policy

**Durable content only.** Architecture pages outlive refactors; volatile facts rot.

- **Include**: component roles, who-talks-to-whom, protocols, persistence substrates, resource-model invariants, framework-level tech, security layers, trust boundaries.
- **Omit**: exact package names, file paths, Helm template tree, implementation phase markers, library-level choices below framework level.
- **Link out** for volatile content rather than restating it (repo paths like [`packages/`](../../packages/), [`deploy/helm/platform/templates/`](../../deploy/helm/platform/templates/)).

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

