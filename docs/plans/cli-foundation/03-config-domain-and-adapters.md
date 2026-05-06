# Issue 3 — Config domain + ConfigStore (TOML) + EnvReader

**Depends on:** 2
**Blocks:** 4, 5

## Context

Foundation work for the `dam` CLI ([ADR-039](../../adrs/039-cli-foundation.md), spec at [README.md](README.md), tracking issue [#79](https://github.com/dam-agents/dam/issues/79)). Before any command can resolve "where do I send requests?", we need the pure resolution logic and the two infrastructure adapters that feed it. ADR-039 sets the precedence (flag > env > file > error) and locks the config path to `~/.dam/config.toml`, flat schema. This issue lands the **domain + adapters in isolation** — no commands, no service yet.

**Why now:** issue 4's `dam config set` and issue 5's `dam ping` both need resolved Config. Building the pure pieces and ports first means service code in 4/5 has a fixed contract to wire into and the layering stays clean.

## Scope

Three things, all under `packages/cli/src/modules/cli/`:

1. **Pure domain types and functions** in `domain/` — `Config`, `ConfigKey`, `Result<T, E>`, domain errors, `resolveConfig`, `parseConfigKey`. Zero external imports.
2. **Ports** for the infrastructure boundary in `infrastructure/` — `ConfigStore`, `EnvReader`.
3. **Adapters** for those ports — TOML adapter for `ConfigStore`, `process.env` adapter for `EnvReader`.

This issue **does not** touch `commands/` or `services/`, and does not register anything with commander.

The exact identifier names (`ConfigStore`, `EnvReader`, `resolveConfig`, etc.) are guidance — the spec retains naming freedom. The shape of `Result<T, E>` is open; alignment with `agent-runtime`'s pattern is encouraged where it fits cleanly.

## Deliverables

### Domain (`packages/cli/src/modules/cli/domain/`)

- **`config.ts`**
  - `Config` type — for v1, a single field `server: string` (URL). Spec keeps the schema flat; this issue adds exactly one key.
  - `ConfigKey` — literal-union type with the single member `"server"` (extension point for future keys).
  - `parseConfigKey(input: string): Result<ConfigKey, InvalidKeyError>`.
  - `resolveConfig(sources: { flag?: Partial<Config>; env: Partial<Config>; file: Partial<Config> }): Result<Config, MissingConfigError>` — pure precedence function: for each key in `Config`, take flag > env > file; if a required field has no source, return `MissingConfigError` with structured detail (which key is missing).
- **`result.ts`** — `Result<T, E>` with `Ok` / `Err` constructors and at least `map` / `flatMap` / `unwrapOr`. Choose one shape and stick with it — alignment with `agent-runtime`'s pattern is fine if it exists; otherwise pick a small custom shape.
- **`errors.ts`** — domain error types: `MissingConfigError`, `MalformedConfigError`, `InvalidKeyError`, `InvalidValueError`. Each carries enough structure to render a useful CLI message (which key, what was malformed).

**Domain rule (per spec §"Layer Responsibilities"):** zero external imports. No `node:fs`, no `node:path`, no `process`, no third-party libs (a tiny semver helper is acceptable in issue 5; this issue stays library-free).

### Ports (`packages/cli/src/modules/cli/infrastructure/`)

Define the port interfaces here — they're owned by infrastructure but consumed by services. (Some teams put ports in domain; spec does not prescribe — keeping them in `infrastructure/` matches the existing `agent-runtime` convention.)

- **`config-store.ts`**
  ```
  ConfigStore {
    read(): Promise<Result<Partial<Config>, MalformedConfigError>>
    write(partial: Partial<Config>): Promise<Result<void, FileWriteError>>
  }
  ```
  - Missing file → `Ok({})` (not error). The CLI should resolve "no file yet" identically to "file with no relevant key."
  - Malformed TOML → `Err(MalformedConfigError)`.
  - `write` merges partial input with the existing file (preserve unrelated top-level keys; do not rewrite the entire file).
- **`env-reader.ts`**
  ```
  EnvReader {
    get(name: string): string | undefined
  }
  ```
  Minimal interface so [#80](https://github.com/dam-agents/dam/issues/80) can add credential env reads without churn.

### Adapters

- **TOML `ConfigStore`** (in `infrastructure/config-store.ts` next to the port, or a sibling file)
  - File path supplied at construction. Default for production wiring is `${os.homedir()}/.dam/config.toml`. Tests pass an explicit temp path.
  - Atomic write: write to a temp sibling, `fs.rename` over the real path. Create the parent directory if missing (`fs.mkdir({ recursive: true })`).
  - Reads: missing file → `Ok({})`; unreadable file → `Err(MalformedConfigError)` (treat permission errors the same as parse errors at this layer; the user gets one error category to react to).
  - Choose a TOML library and add it to `package.json`. Keep it light. Pick one with both parse and stringify.
- **`process.env` `EnvReader`** — trivial wrapper. The env var names for v1 are not finalized in this issue's domain — `EnvReader.get` takes the name as a parameter, and the **service layer** in issue 4 decides which name to read (`PLATFORM_SERVER` is a reasonable choice — confirm with the implementing agent in issue 4). For this issue, the adapter is name-agnostic.

### Tests

Under `packages/cli/src/modules/cli/__tests__/` (or alongside the source per repo convention):

- **Domain unit tests for `resolveConfig`** — table-driven over at minimum:
  - flag-only → uses flag.
  - env-only → uses env.
  - file-only → uses file.
  - flag overrides env overrides file.
  - none of the above → `MissingConfigError`, with the right key in the error.
- **Domain unit test for `parseConfigKey`** — accepts `"server"`, rejects anything else with `InvalidKeyError`.
- **TOML `ConfigStore` integration tests** against a temp dir (`fs.mkdtemp` or `tmpdir()`):
  - Read missing file → `Ok({})`.
  - Write then read round-trips a `server` value.
  - Write preserves an unrelated top-level key (write a TOML file with `server = "x"\nfoo = "bar"`, call `write({ server: "y" })`, assert `foo = "bar"` still present).
  - Malformed file → `Err(MalformedConfigError)`.
- **`EnvReader` adapter test** — trivial: spy on `process.env`, assert pass-through.

Tests **must not** touch the real `~/.dam/`. Use `mkdtemp` and pass the path explicitly to the adapter.

## Acceptance criteria

- `mise run check` passes.
- `mise run cli:test` passes; coverage for `resolveConfig` is table-driven (≥5 cases per the list above).
- `ConfigStore` and `EnvReader` adapters are tested against a temp dir / fake env, never against real `$HOME` or real `process.env`.
- Domain has zero imports outside its own directory (verifiable by grep: no `import .* from "node:` and no third-party imports inside `domain/`).

### Reviewer checklist

- `domain/` imports nothing outside its directory (no `node:`, no third-party).
- No `process.env` access outside the `EnvReader` adapter.
- No filesystem access outside the `ConfigStore` adapter.
- Adapter tests do not write to real `~/.dam/`.
- `ConfigStore.write` round-trip preserves unrelated TOML top-level keys (the test for this is present and passing).
- Error types are domain errors with structured detail, not raw filesystem/parse errors leaked from the adapter.
- No `process.exit` anywhere in this issue's code.

## Out of scope (explicit)

- The `ConfigService` that orchestrates these — issue 4.
- Wiring into commander — issue 4.
- Config keys beyond `server` — future.
- Credential storage — deferred to [#80](https://github.com/dam-agents/dam/issues/80) (a separate adapter in the same `~/.dam/` directory).
- Concurrent-writer safety beyond atomic rename (single-process CLI; no advisory lock).
- Architecture page updates — issue 4 adds the first paragraph beyond the stub from issue 2 once a service exists to describe.

## Verification

```sh
mise run check
mise run cli:test

# Smoke check the adapter against a temp dir without any commands wired:
node -e '
  // The implementing agent supplies the exact import path.
  // This is a sketch — replace with the chosen module path.
  const { createTomlConfigStore } = await import("./packages/cli/dist/modules/cli/infrastructure/config-store.js");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-cfg-"));
  const store = createTomlConfigStore(path.join(dir, "config.toml"));
  console.log(await store.read());                                // Ok({})
  console.log(await store.write({ server: "https://example" }));  // Ok(undefined)
  console.log(await store.read());                                // Ok({ server: "https://example" })
'
```

## Reference files

- [README.md](README.md) §"Layer Responsibilities", §"Coupling Analysis", §"What This Specification Does NOT Prescribe".
- [ADR-039](../../adrs/039-cli-foundation.md) §"Configuration precedence", §"Flat config schema; no profiles", §"Config lives at `~/.dam/config.toml`".
- [`packages/agent-runtime/src/modules/acp/`](../../../packages/agent-runtime/src/modules/acp/) — module shape (`compose.ts`, `domain/`, `infrastructure/`, `services/`).
- [`packages/agent-runtime/src/modules/skills/`](../../../packages/agent-runtime/src/modules/skills/) — another module example for layout patterns.
- Issue [02-cli-package-scaffold.md](02-cli-package-scaffold.md) — the package this issue extends.
