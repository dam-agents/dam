# Issue 2 — CLI package scaffold + `dam --version` / `--help`

**Depends on:** —
**Blocks:** 3, 4, 5, 6

## Context

Foundation work for the `dam` CLI ([ADR-039](../../adrs/039-cli-foundation.md), spec at [README.md](README.md), tracking issue [#79](https://github.com/dam-agents/dam/issues/79)). This issue lands the package skeleton: an installable, buildable, testable `packages/cli/` directory with the layered module shape from the spec, commander.js wired, and the two commander built-ins (`--version`, `--help`) working.

**Why now:** every other CLI issue (3, 4, 5, 6) depends on the package existing, building, and exposing the `bin.ts` → commander.js entrypoint. Without this, the domain/service/command work has nowhere to live.

## Scope

Create `packages/cli/` with the spec's layered module structure, set up build + test, wire commander.js with the package version, and ship `dam --version` and `dam --help`. No domain logic, no services, no network, no fs reads beyond what `node` does at startup.

The package name is `@dam-agents/cli` ([ADR-039](../../adrs/039-cli-foundation.md)) but `package.json` stays `private: true` for this issue — publishing is deferred (no license decision yet).

## Deliverables

### Package skeleton

- **`packages/cli/package.json`**
  - `"name": "@dam-agents/cli"`
  - `"private": true`
  - `"type": "module"`
  - `"engines": { "node": ">=20" }`
  - `"bin": { "dam": "./dist/bin.js" }`
  - `"scripts"`: `dev`, `typecheck`, `build`, `test` — match the patterns in [`packages/agent-runtime/package.json`](../../../packages/agent-runtime/package.json) (closest analogue: TS Node package built with tsup).
  - Dependencies: `commander` (latest stable). No tRPC client yet (deferred to [#80](https://github.com/dam-agents/dam/issues/80)).
- **`packages/cli/tsconfig.json`** — extends the workspace base, ESM output, target Node 20+.
- **`packages/cli/tsup.config.ts`** — entry `src/bin.ts`, format `esm`, target `node20`, platform `node`. Emit a banner-prefixed `#!/usr/bin/env node` shebang on the bin output, OR ensure `bin.ts` itself starts with the shebang and tsup preserves it.
- **`packages/cli/vitest.config.ts`** — minimal vitest config matching repo conventions.
- **`packages/cli/.gitignore`** — `dist/`, `node_modules/`, `coverage/`.

### Source layout (per spec §"Layer Responsibilities")

```
packages/cli/src/
  bin.ts                          # entrypoint: shebang + commander wiring + process.exit
  modules/cli/
    compose.ts                    # single wiring point; returns commander program
    commands/                     # placeholder (issues 4, 5, 6 fill it in)
    services/                     # placeholder (issues 4, 5 fill it in)
    domain/                       # placeholder (issue 3 fills it in)
    infrastructure/               # placeholder (issue 3 fills it in)
```

For empty directories, add a one-line placeholder file so git tracks them (e.g. `services/.gitkeep`, or a stub with a TODO comment referencing the issue that fills it).

- **`bin.ts`** — imports `compose.ts`, calls it, runs `program.parseAsync(process.argv)`, exits 0 on success / non-zero on commander parse error. **Bootstrap-only — no domain logic, no I/O beyond stdin/stdout/exit code** (per spec §"Layer Responsibilities").
- **`compose.ts`** — creates the commander `program`, sets `.name("dam")`, `.version(<package.json version>)`, `.description(<short>)`. No subcommands wired yet — only commander's built-ins are exposed. Issues 4/5/6 will register subcommands here.

The package version passed to commander must come from `package.json` (e.g. via `with { type: "json" }` import assertions, or a build-time embed). Do **not** hardcode it.

### mise tasks

Add tasks to `packages/cli/tasks.toml` (mirroring [`packages/api-server/tasks.toml`](../../../packages/api-server/tasks.toml)):

- `cli:dev` — `tsx watch src/bin.ts`
- `cli:typecheck` — `tsc --noEmit` (run via pnpm filter in repo root, matching the pattern used by other packages)
- `cli:build` — `tsup`
- `cli:test` — `vitest run`

Wire `cli:typecheck` and `cli:test` into the umbrella `check` and `test` tasks in the root `tasks.toml`.

### Project metadata

- **`tseng/project-structure.md`** — add the entry under the client role:
  ```
  <!-- package: cli | role: client | path: packages/cli | package_name: @dam-agents/cli -->
  ```
  (Exact line per spec §"Project metadata updates".)

### Architecture documentation

- **`docs/architecture/cli.md`** (new) — minimal stub:
  - Standard headers per [`docs/guidelines/documentation-guidelines.md`](../../guidelines/documentation-guidelines.md): `Last verified: 2026-05-06`, `Motivated by: ADR-039 ...`.
  - One paragraph: "the CLI is a TypeScript Node package distributed via npm, with `bin` `dam`, that points at a configured Platform server. v0 surface is `--version` and `--help` only; subsequent issues add `config set`, `ping`, and `version`."
  - One subsection "Trust boundary" stating the CLI runs on the user's machine, reads/writes only `~/.dam/`, and makes outbound network calls only to the configured server.
- Link the new page from [`docs/architecture.md`](../../architecture.md) (alphabetical).

### Tests

A single smoke test under `packages/cli/src/__tests__/scaffold.test.ts` that imports `compose.ts`, asserts the program has `.name() === "dam"` and `.version()` matches the package.json version. Network and filesystem must not be touched.

## Acceptance criteria

- `mise run check` passes (lint + typecheck of the new package).
- `mise run test` passes (the smoke test runs and exits 0).
- `mise run cli:build` succeeds; `node packages/cli/dist/bin.js --version` prints the version from `package.json`.
- `node packages/cli/dist/bin.js --help` prints commander-generated help with the program named `dam`.
- The architecture page exists and is linked from the index.
- `tseng/project-structure.md` contains the new entry.

### Reviewer checklist

- `bin.ts` does no I/O beyond delegating to commander.js (bootstrap-only — per spec §"Layer Responsibilities").
- No imports from `api-server-api` yet (deferred to [#80](https://github.com/dam-agents/dam/issues/80)).
- No imports from `api-server`, `agent-runtime`, `controller`, `ui`.
- Module sits at `src/modules/cli/`, mirroring the architecture's standard `src/modules/<name>/` shape from day one.
- No outbound network calls of any kind in this issue (encodes the no-telemetry policy from ADR-039 — see spec §"Layer Responsibilities" infrastructure rule).
- `package.json` is `private: true` (publishing is a future issue; no license decided).

## Out of scope (explicit)

- Any commands beyond commander built-ins (`--version`, `--help`) — `version`, `ping`, `config set` are issues 4–6.
- Any domain or service code — issue 3 introduces the first.
- npm publishing, README polish, GitHub Actions release workflow — deferred until license is decided.
- tRPC client wiring — deferred to [#80](https://github.com/dam-agents/dam/issues/80).
- A subcommand stub for `version` (commander's built-in `--version` flag is sufficient for this issue; the `version` subcommand is issue 6).

## Verification

```sh
mise run check
mise run test
mise run cli:build
node packages/cli/dist/bin.js --version    # prints package.json version
node packages/cli/dist/bin.js --help       # prints commander help with name "dam"
node packages/cli/dist/bin.js              # no args: prints help and exits non-zero (commander default)
```

## Reference files

- [README.md](README.md) (the spec — read first; especially §"Layer Responsibilities" and §"Coupling Analysis").
- [ADR-039](../../adrs/039-cli-foundation.md).
- [`packages/agent-runtime/package.json`](../../../packages/agent-runtime/package.json), [`packages/agent-runtime/tsup.config.ts`](../../../packages/agent-runtime/tsup.config.ts) — closest analogue for a TS Node package built with tsup.
- [`packages/agent-runtime/src/modules/acp/`](../../../packages/agent-runtime/src/modules/acp/) — example of the `compose.ts` + `domain/` + `infrastructure/` + `services/` module shape.
- [`packages/api-server/tasks.toml`](../../../packages/api-server/tasks.toml) — task pattern to mirror.
- [`tseng/project-structure.md`](../../../tseng/project-structure.md) — where the metadata entry goes.
- [`docs/architecture/skills.md`](../../architecture/skills.md) — example architecture page format.
- [`docs/architecture.md`](../../architecture.md) — index to link the new page from.
- [`docs/guidelines/documentation-guidelines.md`](../../guidelines/documentation-guidelines.md) — required headers and content rules.
