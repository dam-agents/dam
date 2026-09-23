# Code scanning

Last verified: 2026-09-23

## CodeQL

GitHub **CodeQL** runs SAST (static application security testing) from the repository's own workflows, one per language:

- **Go** — the controller
- **JavaScript / TypeScript** — api-server, agent-runtime, UI, CLI
- **Rust** — vm-runner
- **GitHub Actions** — the workflows themselves

Each language's workflow runs on pushes to `main`, weekly, and on a PR only when the PR changes a file of that language. For Go and JavaScript / TypeScript the same job also runs the **Code Quality** queries on the same database, so the quality results cost no separate job.

Security findings surface in **GitHub → Security → Code scanning**, quality findings under **Code quality**. PRs that introduce new findings are flagged in the review.

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
