# Issue 5 — Compat domain + `VersionProbe` + `CompatService` + `dam ping`

**Depends on:** 1, 2, 3
**Blocks:** 6

## Context

Foundation work for the `dam` CLI ([ADR-039](../../adrs/039-cli-foundation.md), spec at [README.md](README.md), tracking issue [#79](https://github.com/dam-agents/dam/issues/79)). With Config resolved (issue 3) and the server-side `/api/version` endpoint live (issue 1), the CLI can finally make a network call. `dam ping` is the first networked verb and the only v1 verb that opts into the **Compat gate** (see spec §"Application Services" per-command table).

**Why now:** this slice introduces the network port and the compatibility-negotiation machinery in one focused change. Subsequent verbs (issue 6's `version`, plus future verbs from [#80](https://github.com/dam-agents/dam/issues/80)/[#86](https://github.com/dam-agents/dam/issues/86)) reuse `VersionProbe` and `CompatService` — they don't reintroduce networking.

## Scope

- Pure compat domain — `compareVersions`, `CompatVerdict`, and a verdict-deriving function.
- Port + adapter — `VersionProbe` calling `GET /api/version`, native `fetch`, with a timeout.
- Service — `CompatService` orchestrating `ConfigService` + `VersionProbe` + `compareVersions`.
- Command — `dam ping`. Hard-fails if the local CLI is below the server-advertised floor (per ADR-039); soft-warns to stderr if the local CLI is behind current; succeeds otherwise.

The local CLI version comes from `package.json` (already wired in commander via issue 2).

## Deliverables

### Domain (`packages/cli/src/modules/cli/domain/`)

- **`compat.ts`**
  - `CompatVerdict` — discriminated union or enum: `Ok | BehindCurrent | BelowFloor`. Each variant carries the relevant version strings (`localCli`, `serverVersion`, `serverMinClient`).
  - `compareVersions(a: string, b: string): -1 | 0 | 1` — semver compare. May use a tiny zero-dep helper (e.g. `semver-compare`) or inline a parser; do **not** pull a heavy `semver` lib into domain. If a lib is unavoidable, put it behind a thin domain-internal helper so `domain/` stays effectively dependency-free in spirit.
  - `verdictFor({ localCli, serverVersion, serverMinClient }): CompatVerdict` — pure function:
    - `compare(localCli, serverMinClient) < 0` → `BelowFloor`
    - else `compare(localCli, serverVersion) < 0` → `BehindCurrent`
    - else → `Ok`
- Unit tests: table-driven over equal / behind / ahead / floor-equal / floor-violated, plus pre-release semver edges (`1.0.0-rc.1` vs `1.0.0` if the chosen comparator handles it; if not, document the caveat).

### Port + adapter (`packages/cli/src/modules/cli/infrastructure/`)

- **`version-probe.ts`**
  ```
  VersionProbe {
    probe(serverUrl: string): Promise<Result<{ serverVersion: string; minClientVersion: string }, ProbeError>>
  }
  ```
  - HTTP adapter using native `fetch` (Node 20+).
  - Default timeout: 5 seconds (use `AbortController` + `AbortSignal.timeout(5000)`).
  - Handles non-2xx as `ProbeError("non-ok-status", { status })`.
  - Handles network errors as `ProbeError("network", { cause })`.
  - Handles malformed JSON / missing fields as `ProbeError("malformed-response")`.
  - Resolves the `/api/version` URL by joining the configured server URL with the path — be careful with trailing slashes.
- Adapter test using a local Hono fixture **or** `MockAgent` from `undici` — whichever fits existing repo patterns. (api-server tests currently use `Hono` apps in-memory; mirror that.)

### Service (`packages/cli/src/modules/cli/services/`)

- **`compat-service.ts`**
  - Factory: takes `ConfigService` (or just a "give me the resolved Config" callback) + `VersionProbe` + the local CLI version string.
  - Method: `check({ flag? }): Promise<Result<CompatVerdict, MissingConfigError | ProbeError>>` — resolves config, calls probe, computes verdict via `verdictFor`.
- Unit tests against a fake `VersionProbe` (in-memory). Cover the three verdict branches and both error paths.

### Command (`packages/cli/src/modules/cli/commands/`)

- **`ping.ts`** — commander handler.
  - Optional `--server <url>` flag for one-off override (gets passed as `flag` into the resolution).
  - Calls `CompatService.check`.
  - Verdict mapping:
    - `Ok` → exit 0, stdout: `ok — server <serverVersion>` (one line).
    - `BehindCurrent` → exit 0, stderr warning: `warning: CLI <localCli> is behind server <serverVersion>; consider upgrading`. stdout: `ok — server <serverVersion>`.
    - `BelowFloor` → **hard fail**, exit non-zero (per ADR-039 — CLI refuses to run below the floor). stderr: `error: CLI <localCli> is below the server's minimum required version <serverMinClient>; upgrade and retry`.
  - Error mapping:
    - `MissingConfigError` → non-zero exit, stderr setup hint: `no server configured; run "dam config set server <url>" or set <ENV_VAR_NAME>`.
    - `ProbeError` → non-zero exit, stderr explains the failure mode (network, status, malformed).

### Composition

- Update `packages/cli/src/modules/cli/compose.ts` to instantiate `VersionProbe` and `CompatService`, wiring the local CLI version (from package.json — already in commander) into the service.
- Register `ping` on the commander program.

### Documentation

- Update `docs/architecture/cli.md`:
  - Add a "Compatibility negotiation" subsection: how the floor works, hard-fail vs soft-warn, where the data comes from (link to issue 1's endpoint contract).

## Acceptance criteria

- `mise run check` passes.
- `mise run cli:test` passes (unit + adapter tests).
- Against a real cluster: `dam ping` (with `server` configured) returns 0, prints `ok — server <version>`.
- Against an unreachable server (e.g. `server` set to `http://127.0.0.1:1`): `dam ping` returns non-zero with a network-error stderr message; does not hang past the 5s timeout.
- With local CLI version `0.0.0` and a server `MIN_CLIENT_CLI_VERSION=99.0.0`: `dam ping` returns non-zero with a "below floor" message.
- `dam ping` with no server configured returns non-zero with the setup hint.

### Reviewer checklist

- No outbound network calls outside `VersionProbe` (encodes the no-telemetry rule from spec §"Layer Responsibilities").
- `compareVersions` and `verdictFor` are pure (no fs/network/env in domain).
- The probe has a timeout and never hangs forever.
- `BelowFloor` is a hard fail; `BehindCurrent` is a warn-only path that still exits 0.
- Error stderr messages name the env var and command needed to recover (real fix-it text, not "an error occurred").
- The `Ok` path's stdout is single-line and machine-friendly enough to grep.

## Out of scope (explicit)

- `dam version` — issue 6.
- Auth (Authorization header on the probe call) — deferred ([#80](https://github.com/dam-agents/dam/issues/80)).
- Caching the probe result across invocations — future (no observed need yet).
- Resilience features (retries, circuit breaker) — out.
- Choosing the env-var name for `server` — settled in issue 4 and reused here without changing the contract.

## Verification

```sh
mise run check
mise run cli:test
mise run cli:build
mise run cluster:install   # or upgrade

TMPHOME=$(mktemp -d)
HOME=$TMPHOME node packages/cli/dist/bin.js config set server http://api-server.localhost:4444
HOME=$TMPHOME node packages/cli/dist/bin.js ping                     # expect: ok — server <version>

# Unreachable server:
HOME=$TMPHOME node packages/cli/dist/bin.js config set server http://127.0.0.1:1
HOME=$TMPHOME node packages/cli/dist/bin.js ping                     # expect: non-zero exit, network error

# No server configured:
TMPHOME2=$(mktemp -d)
HOME=$TMPHOME2 node packages/cli/dist/bin.js ping                    # expect: non-zero exit, setup hint

# Below the floor:
mise run cluster:kubectl -- set env deployment/platform-apiserver MIN_CLIENT_CLI_VERSION=99.0.0
mise run cluster:kubectl -- rollout status deployment/platform-apiserver
HOME=$TMPHOME node packages/cli/dist/bin.js config set server http://api-server.localhost:4444
HOME=$TMPHOME node packages/cli/dist/bin.js ping                     # expect: non-zero exit, below-floor error
mise run cluster:kubectl -- set env deployment/platform-apiserver MIN_CLIENT_CLI_VERSION=0.0.0
mise run cluster:kubectl -- rollout status deployment/platform-apiserver
```

## Reference files

- Issue [01-server-version-endpoint.md](01-server-version-endpoint.md) — the endpoint contract this consumes.
- Issue [03-config-domain-and-adapters.md](03-config-domain-and-adapters.md) — `Config`, `Result`, ports.
- Issue [04-config-service-and-set-command.md](04-config-service-and-set-command.md) — `ConfigService` to compose.
- [README.md](README.md) §"Application Services" (per-command Compat-gate table — `ping` opts in).
- [ADR-039](../../adrs/039-cli-foundation.md) §"server-advertised compatibility floor".
- [`packages/api-server/src/__tests__/auth.test.ts`](../../../packages/api-server/src/__tests__/auth.test.ts) — Hono in-memory test fixture pattern (useful for adapter tests against a fake `/api/version`).
