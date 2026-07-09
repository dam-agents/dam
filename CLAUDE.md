## Project Overview

Platform — a Kubernetes platform for running AI agent harnesses (Claude Code, Codex, Gemini CLI) in isolated environments with credential injection, network isolation, and scheduled execution.

### Monorepo layout

pnpm workspaces + standalone Go module. Concept depth lives in [`docs/architecture/`](docs/architecture/); this is just orientation:

- `packages/controller/` — Go K8s reconciler + scheduler
- `packages/api-server/` + `packages/api-server-api/` — TypeScript API server (tRPC, ACP relay) and its contract package
- `packages/agent-runtime/` + `packages/agent-runtime-api/` — in-pod ACP WebSocket server and its contract package
- `packages/agents/` — per-harness agent images (`claude-code`, `pi-agent`, `codex`, `bob`)
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
mise run cluster:install         # create k3s VM, build images, install cert-manager + Platform chart (or upgrade if already installed)
mise run cluster:build-apiserver # rebuild api-server image only, restart apiserver pod
mise run cluster:build-ui        # rebuild UI image only, restart UI pod
mise run cluster:build-controller# rebuild controller image only, restart controller pod
mise run cluster:build-agent     # rebuild agent image only, restart agent pods
mise run cluster:build-keycloak  # rebuild keycloak image only, restart keycloak pod
mise run cluster:fix-certs       # recover from expired dev-cluster certs: roll ztunnel, waypoints, cert-manager webhook (issue #283)
mise run cluster:status          # show pods and cluster state
mise run cluster:logs            # show api-server pod logs
mise run cluster:stop            # stop k3s VM (preserves data)
mise run cluster:uninstall       # helm uninstall + cleanup PVCs
mise run cluster:delete          # destroy k3s VM entirely
```

The `cluster:build-*`, `cluster:fix-certs`, and `cluster:status` tasks honor a `LIMA_INSTANCE` env var (default `platform-k3s`); set it to target a different VM (e.g. the e2e cluster).

Services are available at `*.localhost:4444` automatically (Traefik on port 4444, auto-forwarded by lima). `*.localtest.me:4444` also works as an alias.

### E2E tests (Playwright)

```sh
mise run e2e          # full from-scratch run: nuke test VM, install fresh cluster, run specs, tear down (CI path)
mise run e2e:loop     # fast rerun against a warm test cluster: bootstrap once if missing, optionally rebuild components, wipe data, run specs. Options: --headed --rebuild=apiserver,ui,controller,keycloak,mock-agent
mise run e2e:reset    # data wipe only: drop+recreate platform DB, delete agents (CMs/sts/pods/PVCs), clear stored Playwright auth. Leaves the cluster running
```

`e2e:loop` runs on a dedicated persistent `platform-k3s-test` VM that it never deletes, so reruns skip VM/Istio/cert-manager/Keycloak provisioning. Running `mise run e2e` nukes that VM (shared name); the next `e2e:loop` bootstraps a fresh one. `e2e:loop` does not heal a wedged cluster — if the warm cluster is broken, it fails loud; use `mise run e2e` or `cluster:fix-certs`. Use `e2e:loop` for iteration, `e2e` after helm/realm/infra changes.

### Cluster debugging (pre-approved in .claude/settings.json)

Use `mise run cluster:kubectl -- <args>` and `mise run cluster:shell -- <cmd>` instead of raw `kubectl` or `export KUBECONFIG=...`. These are auto-approved.

Activate cluster environment for interactive use: `export KUBECONFIG="$(mise run cluster:kubeconfig)"`.

If in-mesh traffic misbehaves — the UI suddenly can't log in, `cluster:install` hangs on the keycloak realm step with a misleading `Connection reset`, or a new agent never seeds its workspace (agent pod logs repeat `[runtime] hello failed`) — suspect expired Istio ambient workload SVIDs (issue #283). `mise run cluster:status` reports whether the expired-cert signature is present. The `ztunnel-cert-watchdog` CronJob in `istio-system` auto-rolls `ds/ztunnel` and the waypoint deployments within ~10 min when it sees the signature; `mise run cluster:fix-certs` is the manual escape hatch if you can't wait. The same suspend/resume clock skip can expire cert-manager's webhook serving cert (`cluster:install` fails at admission with `failed calling webhook ... certificate has expired`) — `cluster:status` probes for it and `cluster:fix-certs` heals it too.

## System Architecture (what this system is)

Platform-specific. **Always** start from [`docs/architecture.md`](docs/architecture.md) to understand the system. Before changing behavior in any subsystem, you **must** read its architecture page. Do not infer the architecture from the code alone — the architecture pages are the source of truth.

ADRs (`docs/adrs/`) are human-facing decision history and **off limits to agents**: never read them (reads are denied in settings) and never link or reference them in code or documentation. Creating new ADRs via the `/adr` skill is allowed.

## TypeScript Engineering (how to write TS here)

Generic conventions for TS server-side code (tRPC, Zod, RxJS, layering). Invoke the `/typescript-engineering` skill whenever touching server-side TS. If you spot a contradiction between the skill and a Platform architecture doc, **stop and flag it** — the two should stay aligned, so a conflict means one of them is wrong.

## Database Migrations (`packages/db`)

Tables/indexes/enums are **generated** from `schema.ts`; the `usage_*` reporting views are **hand-written** raw SQL (they aren't in `schema.ts`) (#739). Full workflow in [`packages/db/README.md`](packages/db/README.md).

- **Table change**: edit `src/schema.ts` → `mise run db:generate` (writes the `.sql`, `_journal.json` entry, and snapshot — never hand-edit them) → add a top comment explaining *why*.
- **View change**: `mise run db:new -- <name>` scaffolds the `.sql` + journal entry, then hand-write the `CREATE/DROP VIEW` SQL (dependency order; `--> statement-breakpoint` between statements).
- Never hand-write a table migration: `mise run db:check:generated` (part of `mise run check`, no database) fails if the snapshot doesn't match `schema.ts`.

Migrations run automatically on api-server startup — no manual migrate step in production. The squash split the original history into `0000_squashed_baseline.sql` (tables) and `0001_usage_views.sql` (views); existing deployments skip both (do not change their journal `when`). Commit `_journal.json` alongside the `.sql` file.

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


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
