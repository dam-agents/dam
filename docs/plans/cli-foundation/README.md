# Spec: Platform CLI foundation

> Implements [ADR-039](../../adrs/039-cli-foundation.md) and issue [#79](https://github.com/dam-agents/dam/issues/79). Foundation for [#80](https://github.com/dam-agents/dam/issues/80), [#81](https://github.com/dam-agents/dam/issues/81), [#86](https://github.com/dam-agents/dam/issues/86), [#73](https://github.com/dam-agents/dam/issues/73).

## Feature Overview

The Platform CLI (`dam`) is a TypeScript Node command-line client that lets a user point at a hosted Platform deployment and verify connectivity. It lives at `packages/cli/`, ships via npm as `@dam-agents/cli`, and uses commander.js for argument parsing and subcommand dispatch. The package is structured so wiring tRPC against `api-server-api` in [#80](https://github.com/dam-agents/dam/issues/80) is a mechanical extension, not an architectural change.

## Affected Bounded Contexts

**`platform-cli` — new bounded context, scoped to the package.**

- **Responsibility:** own the user's local interaction with a configured Platform server — resolve Config, check Compat, expose foundation verbs.
- **Domain concepts:** Config, Config Source, Server URL, Compat Verdict (see [vocabulary](../../../tseng/vocabulary.md)).
- **Invariants:**
  - Config is resolved by precedence: command-line flag → environment variable → config file → error. No silent default.
  - The config file is flat — top-level keys only, no profile indirection (no `[profiles.*]`, no `current-profile`).
  - Commands that need the server refuse to run when the CLI is below the server-advertised `minClientVersion`.
  - `~/.dam/config.toml` is the only persistence location for configuration. Auth credentials ([#80](https://github.com/dam-agents/dam/issues/80)) live elsewhere under `~/.dam/`, never in this file.
  - The package declares Node ≥ 20 as its engine and may rely on Node 20+ built-ins (native `fetch`, etc.).
  - The CLI's semver is independent of the Platform's; compatibility is negotiated at runtime, never assumed via version coupling.
- **Layout:** module nested at `packages/cli/src/modules/cli/`, mirroring the architecture's standard `src/modules/<name>/` shape from day one. `bin.ts` lives at the package root as the entrypoint. When a second bounded context arrives ([#80](https://github.com/dam-agents/dam/issues/80)), it slots in as `src/modules/<name>/` next to this one.

**No other modules affected.** The api-server gains one endpoint (`GET /version`) outside the tRPC surface — owned by the api-server side, scoped here as a contract the CLI consumes.

## Domain Events

**None.** Single bounded context, request/response interactions only. Re-evaluate when a second bounded context arrives.

## Application Services

Two services in `packages/cli/src/modules/cli/services/`:

- **Config service.** Resolves configuration from the three sources (file via `ConfigStore`, env via `EnvReader`, flag) and persists changes via `ConfigStore`. Uses the pure `resolveConfig` domain function. Translates infrastructure failures (file unreadable or malformed) into domain errors.
- **Compat service.** Calls the version probe, compares the result against the local CLI semver via `compareVersions`, and produces a `Compat Verdict`. Depends on Config — the probe target comes from the resolved Server URL, so Config resolution always precedes Compat.

Commands (`packages/cli/src/modules/cli/commands/`) are commander.js handlers that:

1. Receive args parsed by commander.js.
2. Ask the Config service for the resolved Config when needed.
3. Invoke the Compat service as a gate (opt-in per command).
4. Run the command's work.
5. Translate the `Result` into exit code + stdout/stderr.

**commander.js is the validation/dispatch layer for this package** — analogous to Zod + tRPC routers in the contract package. It owns argument parsing, type coercion, `--help` generation, and the local-only `--version`. No custom code lives at this layer.

Per-command behavior:

| Verb | Compat gate | Network |
|---|---|---|
| `--version`, `--help` | n/a (commander-owned) | none |
| `dam version` | no | best-effort `/version` call |
| `dam config set` | no | none |
| `dam ping` | yes | `/version` call (the only v1 verb that opts in) |

v1 command surface: `--version`, `--help`, `version`, `help`, `config set <key> <value>`, `ping`.

## Layer Responsibilities

| Layer | Lives at | Owns |
|---|---|---|
| **Bootstrap** | `packages/cli/src/bin.ts` | Runs the module's `compose.ts` once, configures the commander.js program with wired services, hands control to commander.js. **Wiring and process-handover only — no domain logic, no I/O beyond stdin/stdout/exit code.** |
| **Validation / dispatch** | commander.js | Argument parsing, type coercion, subcommand routing, `--help`, `--version`. Configuration only — no custom code. |
| **Commands** | `packages/cli/src/modules/cli/commands/` | One commander handler per verb; output formatting; `Result` → exit-code translation. **Only this layer translates `Result` into exit codes — services and domain never call `process.exit` or throw on domain errors. Commands never compose `Result` chains or implement multi-step logic — those belong in services.** |
| **Application** | `packages/cli/src/modules/cli/services/` | `ConfigService`, `CompatService`. Orchestrate domain functions and infrastructure ports. |
| **Domain** | `packages/cli/src/modules/cli/domain/` | `Config`, `ConfigKey`, `Compat Verdict`, `resolveConfig`, `compareVersions`, `Result<T, E>`, domain errors. Zero external imports. |
| **Infrastructure** | `packages/cli/src/modules/cli/infrastructure/` | `ConfigStore` port + TOML adapter; `VersionProbe` port + plain HTTP adapter; `EnvReader` port + `process.env` adapter. **No infrastructure adapter performs outbound network I/O other than `VersionProbe`** — encodes the no-telemetry policy as a layer-level rule. |
| **Composition** | `packages/cli/src/modules/cli/compose.ts` | Single wiring point — instantiates adapters, injects them into services. |

Dropped from the server-style three-layer template:

- `sagas/` — no internal events.
- `events.ts` — no internal event bus.
- module-level `index.ts` — no public API surface; reintroduce if the package ever exposes a programmatic API.

## Coupling Analysis

- **Single bounded context.** No inter-module coupling within the package.
- **Outbound imports.** Only `api-server-api` (read-only consumer of contract types; no tRPC procedure called in v1). Never imports from `api-server`, `agent-runtime`, `controller`, or `ui`.
- **File system.** Only `ConfigStore` reads/writes `~/.dam/config.toml`.
- **Network.** Only `VersionProbe` performs network calls.
- **Environment.** Only `EnvReader` reads `process.env`. Services depend on the port, never on the global directly.
- **Coupling direction.** bootstrap → commands → services → domain ← infrastructure. Domain has zero outside imports. Infrastructure imports domain types only.

Risks and mitigations:

- *Risk:* future verbs ([#80](https://github.com/dam-agents/dam/issues/80), [#86](https://github.com/dam-agents/dam/issues/86), [#73](https://github.com/dam-agents/dam/issues/73)) bypass services and import infrastructure directly. *Mitigation:* new commands go through application services; new ports follow `*Store` / `*Probe` / `*Reader` naming.
- *Risk:* `api-server-api` types get re-declared inside the CLI. *Mitigation:* import directly, never duplicate. Enforced when tRPC is wired in [#80](https://github.com/dam-agents/dam/issues/80).
- *Risk:* `~/.dam/` ownership contested when [#80](https://github.com/dam-agents/dam/issues/80) adds credentials. *Mitigation:* `ConfigStore` is scoped to `config.toml` only; [#80](https://github.com/dam-agents/dam/issues/80) introduces a separate adapter for credentials in the same directory.

## Project metadata updates

Required as part of the implementation:

- Add the CLI package entry to [`tseng/project-structure.md`](../../../tseng/project-structure.md) under the client role:
  ```
  <!-- package: cli | role: client | path: packages/cli | package_name: @dam-agents/cli -->
  ```

## What This Specification Does NOT Prescribe

Implementation freedom retained:

- Function signatures, class names, file names, exported identifiers.
- TOML library, fetch wrapper, argument-parsing flag style (within commander.js).
- commander.js program organization (single root file vs subcommand registration; inline vs imported handlers).
- TOML schema beyond "flat, single key `server` for v1."
- Shape of `Result<T, E>` (custom vs library; alignment with agent-runtime encouraged).
- Error message wording, color/no-color handling.
- Test framework specifics within repo conventions.
- Build tool selection (`tsc` vs `esbuild`).
- Exit-code numeric assignments (the ADR proposed a scheme).
- Identifiers for `VersionProbe`, `ConfigStore`, and `EnvReader` ports — naming is guidance, not contract.
- Adapter parameterization (URL at construction, per-call, or via a service handle).
- File-write atomicity, parent-directory creation, concurrent-writer handling.
