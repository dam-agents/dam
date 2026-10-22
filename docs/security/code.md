# Code scanning

Last verified: 2026-10-20

## CodeQL

GitHub **CodeQL** runs SAST (static application security testing) from the repository's own workflows, one per language:

- **Go** — the controller
- **JavaScript / TypeScript** — api-server, agent-runtime, UI, CLI
- **Rust** — vm-runner
- **GitHub Actions** — the workflows themselves

Each language's workflow runs on pushes to `main`, weekly, and on a PR only when the PR changes a file of that language.
For Go and JavaScript / TypeScript the same job also runs CodeQL's `code-quality` query suite (maintainability and reliability) next to the security suite, so the quality results cost no separate job.
GitHub's managed Code Quality setup is off: the CodeQL action runs it only in the workflow GitHub generates for it, where it would take a second job per language.

Security and quality findings both surface as alerts in **GitHub → Security → Code scanning**.
PRs that introduce new findings are flagged in the review.

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

- **jactionlint** — static analysis of GitHub Actions workflows and composite actions: actionlint's syntax, expression and shell checks, plus zizmor's audits for script injection, excessive permissions, dangerous triggers, cache poisoning and credentials left in the checkout.
- **zizmor** — the same audits, run beside jactionlint for the cases its default profile leaves out, most of all a value from a dynamic matrix expanded in a script.
