## Project Overview

Platform — a Kubernetes platform for running AI agent harnesses (Claude Code, Codex, Gemini CLI) in isolated environments with credential injection, network isolation, and scheduled execution.

### Monorepo layout

pnpm workspaces + standalone Go module. Concept depth lives in [`docs/architecture/`](docs/architecture/).

## Workflow

mise is the task runner. All tasks are defined in `tasks.toml` files. **Always use `mise run` for building, checking, testing, and cluster operations — never invoke `go`, `pnpm`, `helm`, `kubectl`, etc. directly.** mise manages tool versions and environment; running tools directly will break. `mise tasks` lists everything available.

For the local k3s cluster (lima), e2e test runs, and mesh/cert failures, use the [`cluster-ops`](.claude/skills/cluster-ops/SKILL.md) skill.

## System Architecture (what this system is)

Platform-specific. **Always** start from [`docs/architecture.md`](docs/architecture.md) to understand the system. Before changing behavior in any subsystem, you **must** read its architecture page. Do not infer the architecture from the code alone — the architecture pages are the source of truth.

ADRs (`docs/adrs/`) are human-first decision history; the agent-facing source of truth is the architecture docs. Agents read ADRs only when authoring a new ADR (via the `/adr` skill) or recompiling docs. Ordinary work (implementing, understanding the current system) uses the architecture docs, never the ADR log. Never link or reference an ADR from code or documentation.

## TypeScript Engineering (how to write TS here)

Generic conventions for TS server-side code (tRPC, Zod, RxJS, layering). Invoke the `/typescript-engineering` skill whenever touching server-side TS. If you spot a contradiction between the skill and a Platform architecture doc, **stop and flag it** — the two should stay aligned, so a conflict means one of them is wrong.

## Code comments

No untyped comments. Every comment in TS/JS/Go must start with a registered type prefix (currently only `TEST_OVERVIEW:`); tool directives (`@ts-expect-error`, `eslint-disable`, `//go:`, `// +kubebuilder`, …) are exempt. Registry and rules: [`docs/guidelines/comment-guidelines.md`](docs/guidelines/comment-guidelines.md). Enforced by `mise run common:check:comment-types`.

## Documentation

Always follow [`docs/guidelines/documentation-guidelines.md`](docs/guidelines/documentation-guidelines.md).

## Work process

Proposed ideal flow for new features — see [`docs/guidelines/work-process.md`](docs/guidelines/work-process.md).

## Commit Conventions

- **Conventional Commits**: `type(scope): short summary` — types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `revert`, `style`, `perf`, `ci`, `build`.
- **Scope**: Optional but encouraged (e.g., `feat(ui):`, `fix(hook):`, `docs(design):`).
- **Body**: Optional concise bullet points for non-trivial changes.
- **Trailer**: Configured via `.claude/settings.json` `attribution` — do not add manually.
- **DCO**: Always use `git commit -s` to add `Signed-off-by` trailer.
- **Branch naming**: `type/short-description` (e.g., `feat/session-history`, `fix/stale-timer`). Same type prefixes as commits.

## Branding

Never hardcode the brand (`Dam`, `dam`, or any replacement) in code. The codename `platform` is permanent; user-visible brand flows through Helm `brand.*` ([`deploy/helm/platform/values.yaml`](deploy/helm/platform/values.yaml)) → api-server `config.brand` → UI `getBrand()` ([`packages/ui/src/brand.ts`](packages/ui/src/brand.ts)).

## Worktrees

Use `.worktrees/` for git worktrees. Branch naming follows commit conventions (e.g., `feat/session-history`).

