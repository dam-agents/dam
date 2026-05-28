## Project Overview

Platform — a Kubernetes platform for running AI agent harnesses (Claude Code, Codex, Gemini CLI) in isolated environments with credential injection, network isolation, and scheduled execution.

### Monorepo layout

pnpm workspaces + standalone Go module. Concept depth lives in [`docs/architecture/`](docs/architecture/); this is just orientation:

- `packages/controller/` — Go K8s reconciler + scheduler
- `packages/api-server/` + `packages/api-server-api/` — TypeScript API server (tRPC, ACP relay) and its contract package
- `packages/agent-runtime/` + `packages/agent-runtime-api/` — in-pod ACP WebSocket server and its contract package
- `packages/agents/` — per-harness agent images (`claude-code`, `pi-agent`, `google-workspace`)
- `packages/ui/` — React chat interface (Vite)
- `packages/platform-base/` — shared base image/utilities
- `packages/db/` — database schema and migrations
- `deploy/helm/platform/` — Helm chart for all components + PostgreSQL

## Workflow

mise is the task runner. All tasks are defined in `tasks.toml` files. **Always use `mise run` for building, checking, testing, and cluster operations — never invoke `go`, `pnpm`, `helm`, `kubectl`, etc. directly.** mise manages tool versions and environment; running tools directly will break.

```sh
mise run check              # lint + type-check all packages (also runs as pre-commit hook)
mise run test               # run all tests
mise run helm:check:lint    # helm lint
mise run helm:check:render  # helm template | kubeconform
mise run ui:run             # start UI dev server
```

### Cluster lifecycle (k3s via lima)

```sh
mise run cluster:install      # create k3s VM, build images, install cert-manager + Platform chart (or upgrade if already installed)
mise run cluster:build-agent  # rebuild agent image only, restart agent pods
mise run cluster:status       # show pods and cluster state
mise run cluster:logs         # show api-server pod logs
mise run cluster:stop         # stop k3s VM (preserves data)
mise run cluster:uninstall    # helm uninstall + cleanup PVCs
mise run cluster:delete       # destroy k3s VM entirely
```

Services are available at `*.localhost:4444` automatically (Traefik on port 4444, auto-forwarded by lima). `*.localtest.me:4444` also works as an alias.

### Cluster debugging (pre-approved in .claude/settings.json)

Use `mise run cluster:kubectl -- <args>` and `mise run cluster:shell -- <cmd>` instead of raw `kubectl` or `export KUBECONFIG=...`. These are auto-approved.

Activate cluster environment for interactive use: `export KUBECONFIG="$(mise run cluster:kubeconfig)"`.

If the UI suddenly can't log in or `cluster:install` hangs on the keycloak realm step with a misleading `Connection reset`, suspect expired Istio ambient workload SVIDs (issue #283). The `ztunnel-cert-watchdog` CronJob in `istio-system` auto-rolls `ds/ztunnel` within ~10 min when it sees the expired-cert signature; `mise run cluster:fix-certs` is the manual escape hatch if you can't wait.

## System Architecture (what this system is)

Platform-specific. **Always** start from [`docs/architecture.md`](docs/architecture.md) to understand the system. Before changing behavior in any subsystem, you **must** read its architecture page and the ADRs it links. Do not infer the architecture from the code alone — the docs are the source of truth for *why* the system is shaped the way it is.

## TypeScript Engineering (how to write TS here)

Generic conventions for TS server-side code (tRPC, Zod, RxJS, layering). Invoke the `/typescript-engineering` skill whenever touching server-side TS. If you spot a contradiction between the skill and a Platform architecture doc or ADR, **stop and flag it** — the two should stay aligned, so a conflict means one of them is wrong.

## Documentation

Always follow [`docs/guidelines/documentation-guidelines.md`](docs/guidelines/documentation-guidelines.md).

## Work process

Proposed ideal flow for new features — see [`docs/guidelines/work-process.md`](docs/guidelines/work-process.md).

## UI (`packages/ui`)

Follow the [`react-ui-engineering`](.agents/skills/react-ui-engineering/SKILL.md) skill for all React + TypeScript work. Run `mise run lint:fix` after edits; auto-fixes import order and `import type`.

## Commit Conventions

- **Conventional Commits**: `type(scope): short summary` — types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `revert`, `style`, `perf`, `ci`, `build`.
- **Scope**: Optional but encouraged (e.g., `feat(ui):`, `fix(hook):`, `docs(design):`).
- **Body**: Optional concise bullet points for non-trivial changes.
- **Trailer**: Configured via `.claude/settings.json` `attribution` — do not add manually.
- **DCO**: Always use `git commit -s` to add `Signed-off-by` trailer.
- **Branch naming**: `type/short-description` (e.g., `feat/session-history`, `fix/stale-timer`). Same type prefixes as commits.

## Separation of Concerns & DRY Principle

This system is a modular component system following the DRY (Don't Repeat Yourself) principle. Each piece has a single responsibility. You should be able to swap out any component without rewriting others.

## Branding

Never hardcode the brand (`Dam`, `dam`, or any replacement) in code. The codename `platform` is permanent; user-visible brand flows through Helm `brand.*` ([`deploy/helm/platform/values.yaml`](deploy/helm/platform/values.yaml)) → api-server `config.brand` → UI `getBrand()` ([`packages/ui/src/brand.ts`](packages/ui/src/brand.ts)).

## Worktrees

Use `.worktrees/` for git worktrees. Branch naming follows commit conventions (e.g., `feat/session-history`).

### Setup

After creating a worktree, run project setup:

- **Node.js**: `pnpm install`

### Verification

Run tests to confirm a clean baseline before starting work. If tests fail, report failures and ask before proceeding.

### Report

After setup, report: worktree path, test results, and readiness.
