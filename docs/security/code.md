# Code scanning

Last verified: 2026-06-12

## CodeQL

GitHub **CodeQL** is enabled via the default setup. It runs SAST (static application security testing) on every PR for:

- **Go** — the controller
- **JavaScript / TypeScript** — api-server, agent-runtime, UI, CLI

Findings surface in **GitHub → Security → Code scanning**. PRs that introduce new findings are flagged in the review.

## Pre-commit hardening

`mise run check` runs on every commit in CI:

**TypeScript** (api-server, agent-runtime, UI, CLI):

- **Strict-mode type checking** — eliminates entire classes of type-confusion bugs.
- **ESLint** — catches suspicious patterns and common mistakes.
- **Prettier** — enforces consistent formatting.

**Go** (controller):

- **gofmt** — enforces canonical formatting.
- **go vet** — catches suspicious constructs the compiler doesn't flag.
- **staticcheck** — extended static analysis (unused code, deprecated APIs, correctness bugs).

## Workflow hardening

`mise run check` also runs:

- **zizmor** — static security analysis for GitHub Actions workflows (credential persistence, excessive permissions, template injection, cache poisoning).
