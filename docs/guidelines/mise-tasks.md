# Mise tasks

Rules for defining and running tasks. mise runs everything (`mise tasks --all` lists it); never call `pnpm`, `go`, `helm`, or `kubectl` directly.

## Layout

The repo is a mise monorepo (`monorepo_root = true` in [`mise.toml`](../../mise.toml)). Every package directory listed under `[monorepo].config_roots` is a config root with its own `mise.toml`, and its tasks are addressed by path:

| Where | Address | Example |
|---|---|---|
| Package task, from anywhere | `//<path>:<task>` | `mise run //packages/ui:check:tsc` |
| Package task, from inside the package | `:<task>` | `cd packages/ui && mise :check` |
| Same task in every package | `//...:<task>` | `mise run '//...:test'` |
| Repo-level task | bare name, or `//:<task>` from a package | `mise run check`, `mise run cluster:install` |

Repo-level tasks (aggregators, `common:*`, `docs:*`, `release:*`, `cluster:*`, `e2e*`) live in [`tasks.toml`](../../tasks.toml) and [`deploy/tasks.toml`](../../deploy/tasks.toml). The aggregators fan out: `check` = `setup` + every `*:check` at the root + `//...:check`. Inside a package, the convention is the same names one level down: `check` depends on `:check:*`, `fix` on `:fix:*`, `scan` on `:scan:*`.

## Templates

Repeated task shapes are `[task_templates]` in the root `mise.toml`; a package task picks one with `extends`. A TypeScript package is typically five one-liners:

```toml
[tasks."check:tsc"]
extends = "ts:check:tsc"
```

Local fields override the template's `run`, `depends`, and `sources` wholesale; `env` and `tools` merge. Templates render in the extending package, so `{{config_root}}` is that package and `{{vars.repo_root}}` is the repo root. Add a template when a third package needs the same task; override a field instead of copying the template when one package differs.

Templates: `ts:check:{tsc,lint,format}`, `ts:fix:{lint,format}`, `ts:test`, `agent:image`, `image:scan:trivy`.

## Artifact cache

A task with `sources` and `outputs` (`outputs = []` for a pure check) and `cache = { enabled = true }` is keyed by the content of its sources, its definition, resolved tool versions, platform, and its dependencies' cache keys. A hit restores the outputs and replays the log. Rules that keep hits honest:

- **Declare every input.** Cross-package reads are covered by depending on the upstream package's task (`^check:tsc` = the same task in every pnpm workspace dependency); `pnpm-lock.yaml` is in every TypeScript key.
- **Install steps are `cache = { enabled = false }` and referenced with `wait_for`, not `depends`.** A dependency that runs without a cache key makes every dependent uncacheable. Aggregators pull the install step in.
- **Never cache what talks to the outside**: image builds, cluster ops, anything reading a registry or a live cluster.

Inspect with `mise run --task-cache-explain <task>`; bypass with `mise run --task-cache off <task>`. Flags go before the task name. CI restores the artifact directory between runs; there is no remote cache yet (`task.cache.remote_url` is the upgrade path).

## Sandboxing

Checks run sandboxed (Landlock on Linux, Seatbelt on macOS; Windows runs unsandboxed with a warning): `deny_net = true` for anything that is pure files, `deny_write = true` where the tool writes nothing. `deny_write` blocks the whole tree except `/tmp`; tools that write caches into the tree or `$HOME` (Go, uv, vitest, drizzle-kit) keep write access and deny only the network. Test suites are not sandboxed: the network sandbox blocks every inet socket, loopback included.

When a sandboxed task fails with `Operation not permitted` or `Permission denied`, the task found a real undeclared side effect. Either fix the tool invocation or drop exactly the one `deny_*` it needs, with a comment saying why.
