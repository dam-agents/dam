# Mise tasks

Rules for defining and running tasks. mise runs everything (`mise tasks --all` lists it); never call `pnpm`, `go`, `helm`, or `kubectl` directly.

## Layout

The repo is a mise monorepo (`monorepo_root = true` in [`.mise/config.toml`](../../.mise/config.toml), with `mise.lock` beside it). Every package directory listed under `[monorepo].config_roots` is a config root: `.mise/tasks/` holds its scripted tasks, and `.mise/config.toml` exists only when there is something declarative to hold (aggregators, template `extends`, `[deps]` providers). Its tasks are addressed by path:

| Where | Address | Example |
|---|---|---|
| Package task, from anywhere | `//<path>:<task>` | `mise run //packages/ui:check:tsc` |
| Package task, from inside the package | `:<task>` | `cd packages/ui && mise :check` |
| Same task in every package | `//...:<task>` | `mise run '//...:test'` |
| Repo-level task | bare name, or `//:<task>` from a package | `mise run check`, `mise run cluster:install` |

Repo-level tasks (aggregators and their `check:*` leaves, `release:*`, `cluster:*`, `e2e*`) live in [`.mise/config.toml`](../../.mise/config.toml) when they are one-liners, under [`.mise/tasks/`](../../.mise/tasks/) when they have a script body (the `cluster:*` operations included). Documentation checks are their own config root, `//docs:*`. The aggregators fan out: `check` = the root's own `check:*` leaves + `//...:check` (`//...` covers every package root but never the root itself). `mise run e2e` is an alias of the file task `e2e:run`, since a file and a directory cannot share the name `e2e`. Inside a package, the convention is the same names one level down: `check` depends on `:check:*`, `fix` on `:fix:*`.

## File tasks

Standalone scripts are tasks too: an executable under a root's `.mise/tasks/` is a task named by its path (`.mise/tasks/check/version` → `check:version`; `packages/db/.mise/tasks/new` → `//packages/db:new`), so `:check:*` picks it up like any TOML task. Metadata rides in a header (`#MISE key=value` in shell, `//MISE` in JavaScript): `description`, `sources`, `outputs`, `cache`, `depends`. Node files are extensionless ESM entrypoints (`#!/usr/bin/env node`); a task file that also serves as a module (the ADR index generator, the doc-size measurer) guards its entry point so importing it runs nothing. Arguments pass through verbatim after the first `--` (`mise run image:resolve -- build-or-reuse codex -- packages/agents/codex`). Sandbox fields are not accepted in file headers; a script that must be sandboxed gets a TOML task with `file = ...` instead. The one repo script that is not a task, the Claude Code doc-size hook, lives under `.claude/hooks/` and imports the doc-size task file as a module.

## Dependencies

Project dependencies are not tasks. Each config root declares `[deps]` providers: built-in ones (`pnpm` at the root, `go` in the controller, `uv` in the experiment SDK) and custom ones for anything that only prepares the ground for tasks (chart dependencies in `helm/`, the keycloakify `kc.gen.tsx` codegen); with `auto = true` they run before any `mise run` or `mise x` when their inputs changed or their outputs are missing, across every config root. Nothing needs to call them explicitly before a `mise run`; `mise deps --monorepo` installs them all without running a task (CI uses `mise -C helm deps` where a bare `helm package` follows), and `mise run --no-deps <task>` skips them. `mise deps --monorepo` installs every provider, so something only a few tasks need and expensive to fetch (Playwright's Chromium) stays a task those tasks depend on. No task depends on an install step, which is also what keeps cached tasks cacheable (a dependency without a cache key would make its dependents uncacheable).

## Templates

Repeated task shapes are `[task_templates]` in `.mise/config.toml`; a package task picks one with `extends`. A TypeScript package is typically five one-liners:

```toml
[tasks."check:tsc"]
extends = "ts:check:tsc"
```

Local fields override the template's `run`, `depends`, and `sources` wholesale; `env` and `tools` merge. Templates render in the extending package, so `{{config_root}}` is that package and `{{vars.repo_root}}` is the repo root. Add a template when a third package needs the same task; override a field instead of copying the template when one package differs.

Templates: `ts:check:{tsc,lint,format}`, `ts:fix:{lint,format}`, `ts:test`. Agent images are one task, `//packages/agents:image [-- <agent>…]`, which orders the bases and builds the rest in parallel. Security scanners (trivy, govulncheck, pnpm audit) are not tasks: `cd.yml` runs them against the published images and lockfiles.

## Artifact cache

A task with `sources` and `outputs` (`outputs = []` for a pure check) and `cache = { enabled = true }` is keyed by the content of its sources, its definition, resolved tool versions, platform, and its dependencies' cache keys. A hit restores the outputs and replays the log. Rules that keep hits honest:

- **Declare every input.** Cross-package reads are covered by depending on the upstream package's task (`^check:tsc` = the same task in every pnpm workspace dependency); `pnpm-lock.yaml` is in every TypeScript key.
- **Never depend on an install step.** Installs are `[deps]` providers, not tasks; a dependency that runs without a cache key makes every dependent uncacheable.
- **Never cache what talks to the outside**: image builds, cluster ops, anything reading a registry or a live cluster.

Inspect with `mise run --task-cache-explain <task>`; bypass with `mise run --task-cache off <task>`. Flags go before the task name. CI restores the artifact directory between runs; there is no remote cache yet (`task.cache.remote_url` is the upgrade path).

## Sandboxing

Checks run sandboxed (Landlock on Linux, Seatbelt on macOS; Windows runs unsandboxed with a warning): `deny_net = true` for anything that is pure files, `deny_write = true` where the tool writes nothing. `deny_write` blocks the whole tree except `/tmp`; tools that write caches into the tree or `$HOME` (Go, uv, vitest, drizzle-kit) keep write access and deny only the network. Test suites are not sandboxed: the network sandbox blocks every inet socket, loopback included.

When a sandboxed task fails with `Operation not permitted` or `Permission denied`, the task found a real undeclared side effect. Either fix the tool invocation or drop exactly the one `deny_*` it needs, with a comment saying why.
