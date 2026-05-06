# Issue 4 — `ConfigService` + `dam config set <key> <value>`

**Depends on:** 2, 3
**Blocks:** —

## Context

Foundation work for the `dam` CLI ([ADR-039](../../adrs/039-cli-foundation.md), spec at [README.md](README.md), tracking issue [#79](https://github.com/dam-agents/dam/issues/79)). With the domain types and adapters from issue 3 in place, this issue introduces the first stateful command. `dam config set server <url>` is the only way for v1 users to configure the CLI before subsequent verbs (`ping`, `version`) can talk to a server.

**Why now:** every command after this assumes Config can be set and read. Landing the orchestration + the `set` verb in one focused issue keeps the next two issues focused on networking + version display, not on file-write plumbing.

## Scope

- A `ConfigService` in `packages/cli/src/modules/cli/services/` that orchestrates `ConfigStore` + `EnvReader`. It exposes (a) "resolve current config given an optional flag override" and (b) "persist a partial config update."
- The first command: `dam config set <key> <value>`. Validates key + value, persists via the service, prints a confirmation, exits 0 on success / non-zero on validation or write failure per the chosen exit-code scheme.
- Commander wiring through `compose.ts` and `bin.ts`.
- Settle the env var name for `server` configuration (proposed: `PLATFORM_SERVER` — confirm with the user during implementation if doubts arise; the variable is read by `ConfigService` via `EnvReader.get(name)`, no domain churn either way).

## Deliverables

### Service (`packages/cli/src/modules/cli/services/`)

- **`config-service.ts`**
  - Factory: takes a `ConfigStore` and `EnvReader`, returns a `ConfigService`.
  - Method: `getResolved({ flag?: Partial<Config> }): Promise<Result<Config, MissingConfigError | MalformedConfigError>>` — reads the file via `ConfigStore`, reads env via `EnvReader.get(<envVarName>)`, calls the pure `resolveConfig` from issue 3, returns the verdict.
  - Method: `set(key: ConfigKey, rawValue: string): Promise<Result<void, InvalidValueError | MalformedConfigError | FileWriteError>>`
    - Validates the value against the key (for `server`: must parse as a URL — `new URL(rawValue)` throws → `Err(InvalidValueError)`).
    - Reads existing file, merges in the new key, writes back via `ConfigStore.write`.
    - Note: `set` writes only to the file; env-supplied values are never overwritten by the service (env wins over file at resolve time, that's the precedence — but the file is the only persistence target).
- Unit tests against fake `ConfigStore` / `EnvReader` (in-memory implementations of the port interfaces). Cover:
  - `getResolved` with file-only, env-only, flag-only, and missing.
  - `set` valid → calls `write` with the merged partial.
  - `set` invalid value → returns `InvalidValueError`, `write` not called.

### Command (`packages/cli/src/modules/cli/commands/`)

- **`config-set.ts`**
  - Commander subcommand registered as `program.command("config").command("set <key> <value>")` (or chosen commander shape).
  - Calls `parseConfigKey` to validate `<key>`; on `Err`, prints to stderr and exits non-zero.
  - Calls `ConfigService.set(key, value)`; translates the `Result` into stdout/stderr + exit code.
  - On `Ok`: prints a one-line confirmation including the resolved file path (e.g. `wrote server = https://… to ~/.dam/config.toml`).
  - On `Err(InvalidValueError)`: stderr message + non-zero exit.
  - On `Err(FileWriteError)`: stderr message + non-zero exit.
- **The command is the only layer that calls `process.exit` and the only layer that writes to `process.stdout` / `process.stderr`** (per spec §"Layer Responsibilities").
- Pick exit codes consistent with the scheme ADR-039 proposes. Document the chosen scheme in a short comment in `bin.ts` or `compose.ts`.

### Composition

- Update **`packages/cli/src/modules/cli/compose.ts`**:
  - Instantiate the TOML `ConfigStore` (with the production `~/.dam/config.toml` path) and the `process.env` `EnvReader`.
  - Construct `ConfigService` from those.
  - Register the `config set` command on the commander program, injecting the service.
- Update **`packages/cli/src/bin.ts`** if needed (most wiring should live in `compose.ts`).
- The wiring should make the `~/.dam/` path overridable for tests — either via an env var (e.g. `DAM_CONFIG_HOME`) read in `compose.ts`, or by exposing a `compose({ configPath })` parameter that `bin.ts` calls with the production default. Either way, integration tests must run without touching the real `~/.dam/`.

### Tests

- Service unit tests (above).
- Command integration tests under `packages/cli/src/__tests__/`:
  - Spawn the built `bin.js` in a child process with `HOME` (or `DAM_CONFIG_HOME`) set to a temp dir; run `config set server https://example.test`; assert exit 0, stdout confirmation, file content.
  - Run `config set server not-a-url`; assert non-zero exit, stderr message, file untouched.
  - Run `config set unknown-key value`; assert non-zero exit, stderr explains.
  - Round-trip preservation: pre-populate the temp `config.toml` with `foo = "bar"\nserver = "old"`, run `config set server https://new.test`, assert `foo = "bar"` is still in the file.

### Documentation

- Update **`docs/architecture/cli.md`** (the stub from issue 2):
  - Add a "Config" subsection: precedence, file location, the env-var name chosen for `server`, the trust boundary (read/write under `~/.dam/`).

## Acceptance criteria

- `mise run check` passes.
- `mise run cli:test` passes (unit + integration).
- `mise run cli:build` succeeds.
- Round-trip preservation: setting `server` in a file that already has another top-level key leaves that key intact.
- Invalid key and invalid value paths produce non-zero exit + helpful stderr; the file is not modified.
- `dam config set server https://example.test` (against a temp `HOME`) writes a valid TOML file at `<HOME>/.dam/config.toml` containing exactly `server = "https://example.test"`.

### Reviewer checklist

- No `process.exit` outside `commands/`.
- No `process.stdout` / `process.stderr` writes outside `commands/` (services and domain return `Result`s).
- No fs / network outside `infrastructure/`.
- No `process.env` access outside the `EnvReader` adapter (the test override path goes through `compose` / `EnvReader`, not raw `process.env` reads in services).
- Service's `set` reads-merges-writes (does not blow away unrelated keys).
- Command translates `Result` → exit code; doesn't compose `Result` chains itself.
- The chosen env-var name is documented (in `cli.md`).

## Out of scope (explicit)

- `dam config get` / `dam config list` — future.
- Profile support — future ([ADR-039](../../adrs/039-cli-foundation.md) §"Future considerations").
- Credential storage — deferred to [#80](https://github.com/dam-agents/dam/issues/80).
- Anything that talks to a server (`ping`, `version`) — issues 5, 6.
- TUI / interactive config wizard — out.

## Verification

```sh
mise run check
mise run cli:test
mise run cli:build

# Manual verification against a fresh temp HOME:
TMPHOME=$(mktemp -d)
HOME=$TMPHOME node packages/cli/dist/bin.js config set server https://example.test
cat $TMPHOME/.dam/config.toml
# Expected: server = "https://example.test"

# Invalid value:
HOME=$TMPHOME node packages/cli/dist/bin.js config set server not-a-url
# Expected: exit non-zero, stderr explains

# Invalid key:
HOME=$TMPHOME node packages/cli/dist/bin.js config set unknown-key value
# Expected: exit non-zero, stderr explains

# Round-trip preservation:
echo 'foo = "bar"' >> $TMPHOME/.dam/config.toml
HOME=$TMPHOME node packages/cli/dist/bin.js config set server https://updated.test
grep -q '^foo = "bar"$' $TMPHOME/.dam/config.toml && echo "round-trip ok"
```

## Reference files

- Issue [03-config-domain-and-adapters.md](03-config-domain-and-adapters.md) — the domain + ports this issue composes.
- [README.md](README.md) §"Application Services", §"Layer Responsibilities" (commands → services → domain/infra rule).
- [ADR-039](../../adrs/039-cli-foundation.md) §"Configuration precedence", §"Flat config schema".
- [`packages/agent-runtime/src/modules/acp/services/acp-runtime.ts`](../../../packages/agent-runtime/src/modules/acp/services/acp-runtime.ts) — service-shape reference.
- [`docs/architecture/cli.md`](../../architecture/cli.md) — page to extend (created in issue 2).
