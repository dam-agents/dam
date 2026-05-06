# Issue 6 — `dam version` (best-effort upstream)

**Depends on:** 1, 2, 5
**Blocks:** —

## Context

Foundation work for the `dam` CLI ([ADR-039](../../adrs/039-cli-foundation.md), spec at [README.md](README.md), tracking issue [#79](https://github.com/dam-agents/dam/issues/79)). This issue closes the v1 verb surface defined in spec §"Application Services": `--version`, `--help`, `version`, `help`, `config set`, `ping`. With `ping` (issue 5) being the gated counterpart, `dam version` is the **un-gated** version-display verb — informational only, never refuses to run.

**Why now:** completes the foundation. After this, the next ADR/spec ([#80](https://github.com/dam-agents/dam/issues/80) `dam login`, etc.) plugs into the same skeleton.

## Scope

- `dam version` command — always prints local CLI semver (exit 0). If a server is configured, best-effort calls `VersionProbe`. On success, also prints server version + min CLI floor. On failure, prints "server unreachable" line and **still exits 0**.
- Verdict handling differs from `ping`:
  - `Ok` → print full info, exit 0.
  - `BehindCurrent` → soft warn to stderr, exit 0. (Same warning text as `ping`.)
  - `BelowFloor` → emit a stronger-worded warning to stderr, **but still exit 0**. (`version` is informational, not a gate.)
  - Probe error → print local + "server unreachable: <reason>", exit 0.

The commander built-in `--version` flag (from issue 2) remains the local-only short path. The `version` subcommand is the rich one.

## Deliverables

### Command (`packages/cli/src/modules/cli/commands/`)

- **`version.ts`** — commander handler.
  - Optional `--server <url>` flag (consistent with `ping`).
  - Always prints local CLI version on stdout. Format suggestion (single line, machine-greppable):
    ```
    dam <localCli>
    ```
  - If server is configured (resolved Config exists), call `CompatService.check`. On success, append:
    ```
    server <serverVersion> (min CLI <serverMinClient>)
    ```
  - On `BehindCurrent`: warn to stderr (same text as `ping`).
  - On `BelowFloor`: warn to stderr with stronger language (e.g. `error: CLI <localCli> is below the server's minimum required version <serverMinClient>. ping/login/shell will fail until you upgrade.`), but still exit 0.
  - On `MissingConfigError`: print the local line only and exit 0 (no setup hint — `version` works without a server).
  - On `ProbeError`: append `server unreachable: <reason>` to stdout (or stderr — pick one and stay consistent with `ping`'s pattern), exit 0.

### Service reuse

- Reuses `CompatService` and `VersionProbe` from issue 5. **No new infrastructure.** If you find yourself touching `infrastructure/`, stop and reconsider.

### Composition

- Register `version` on the commander program in `compose.ts`.
- The implementing agent should confirm that the commander built-in `--version` flag still works (it should — it's commander's behavior, not ours).

### Tests

Under `packages/cli/src/__tests__/`:

- No server configured (`HOME` is a fresh temp dir): `dam version` exits 0, stdout contains `dam <version>`, no server line.
- Server reachable (use a Hono in-memory fixture or a real local cluster as a smoke test): exits 0, stdout contains both `dam <localCli>` and `server <serverVersion>`.
- Server unreachable: exits 0, stdout has the local line, output mentions "server unreachable".
- Server returns a floor above the local CLI: exits **0** (informational), stderr contains the below-floor warning. (This is the contrast with `ping`, which would exit non-zero in the same scenario.)

### Documentation

- Update `docs/architecture/cli.md`:
  - In the "Compatibility negotiation" subsection (added in issue 5), add one sentence: `version` is the un-gated counterpart to `ping`; it surfaces the same verdict but never refuses to run.
- Add a one-line note to the "v1 surface" paragraph that the verb set is now complete.

## Acceptance criteria

- `mise run check` passes.
- `mise run cli:test` passes.
- `dam version` with no server configured prints local version, exit 0.
- `dam version` with reachable server prints both, exit 0.
- `dam version` with unreachable server prints local + "server unreachable" note, exit 0 (does **not** fail like `ping` does).
- `dam version` with the server floor above the local CLI version prints a below-floor warning on stderr, but exit 0.
- The commander built-in `dam --version` still works and prints just the local version (single line).

### Reviewer checklist

- `dam version` never returns non-zero on network errors or compat issues (informational, not a gate).
- No new `VersionProbe` adapter — reuses issue 5's.
- No new outbound HTTP path — same probe.
- No double output on the success path (single local line + at most one server line).
- The contrast with `ping` is testable and tested: same scenario, different exit codes.

## Out of scope (explicit)

- Replacing or modifying commander.js's `--version` flag (it remains the local-only short path).
- Caching the server response across invocations (future).
- A `--json` flag for structured output (future, when a downstream consumer asks).
- Documentation of upgrade instructions inside the warning message (would require knowing the user's install method — out).

## Verification

```sh
mise run check
mise run cli:test
mise run cli:build

# Local-only:
TMPHOME=$(mktemp -d)
HOME=$TMPHOME node packages/cli/dist/bin.js version       # local line only, exit 0

# With reachable server:
mise run cluster:install   # or upgrade
HOME=$TMPHOME node packages/cli/dist/bin.js config set server http://api-server.localhost:4444
HOME=$TMPHOME node packages/cli/dist/bin.js version       # local + server lines, exit 0

# Unreachable server:
HOME=$TMPHOME node packages/cli/dist/bin.js config set server http://127.0.0.1:1
HOME=$TMPHOME node packages/cli/dist/bin.js version       # local line + "server unreachable", exit 0

# Below the floor — contrast with ping:
mise run cluster:kubectl -- set env deployment/platform-apiserver MIN_CLIENT_CLI_VERSION=99.0.0
mise run cluster:kubectl -- rollout status deployment/platform-apiserver
HOME=$TMPHOME node packages/cli/dist/bin.js config set server http://api-server.localhost:4444
HOME=$TMPHOME node packages/cli/dist/bin.js version; echo "version exit=$?"   # expect: warning on stderr, exit 0
HOME=$TMPHOME node packages/cli/dist/bin.js ping; echo "ping exit=$?"          # expect: error, exit non-zero
mise run cluster:kubectl -- set env deployment/platform-apiserver MIN_CLIENT_CLI_VERSION=0.0.0
mise run cluster:kubectl -- rollout status deployment/platform-apiserver

# Commander built-in still works:
node packages/cli/dist/bin.js --version                    # single line, just the local semver
```

## Reference files

- Issue [01-server-version-endpoint.md](01-server-version-endpoint.md) — the endpoint contract.
- Issue [05-compat-and-ping-command.md](05-compat-and-ping-command.md) — `CompatService` + `VersionProbe` to reuse, and the `ping` behavior to contrast against.
- [README.md](README.md) §"Application Services" (per-command Compat-gate table — `version` is "no").
- [ADR-039](../../adrs/039-cli-foundation.md) §"server-advertised compatibility floor".
