# Code scanning

Last verified: 2026-06-02

Motivated by: operational policy, not an architectural decision — no ADR.

## CodeQL

GitHub **CodeQL** is enabled via the default setup. It runs SAST (static application security testing) on every PR for:

- **Go** — the controller
- **JavaScript / TypeScript** — api-server, agent-runtime, UI, CLI

Findings surface in **GitHub → Security → Code scanning**. PRs that introduce new findings are flagged in the review.

## Pre-commit hardening

`mise run check` runs on every commit in CI:

- **TypeScript strict-mode type checking** — eliminates entire classes of type-confusion bugs.
- **ESLint** — catches suspicious patterns and common mistakes.
- **Prettier** — enforces consistent formatting (prevents obfuscation via whitespace).
