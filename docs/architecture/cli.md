# CLI

Last verified: 2026-05-07

## Motivated by

- [ADR-039 — Platform CLI foundation](../adrs/039-cli-foundation.md) — TypeScript Node package distributed via npm; reuses the api-server tRPC contract; flat config under XDG-standard locations; server-advertised compatibility floor.
- [ADR-037 — Remote terminal](../adrs/037-remote-terminal.md) — predecessor; established the "terminal" session mode the CLI complements with `dam shell` (a future verb).

## Overview

The `dam` CLI is a TypeScript Node package that users install on their own machine and point at a configured Platform deployment. It never runs inside the cluster. The v1 surface is complete: `dam --version`, `dam --help` (built-in flags), `dam config set`, `dam ping`, and `dam version`. Future verbs — `dam login`, `dam shell`, `dam import` — slot into the same module.

The CLI shares types directly with the api-server via a shared contract package, so server-side type changes reach the CLI without codegen or manual mirroring. The contract client is not wired in this initial slice — the foundation lands first; verbs that need authenticated calls bring the client wiring with them.

## Trust boundary

The CLI runs on the user's machine. It reads and writes only under the XDG config and state directories (today: `config.toml` under `$XDG_CONFIG_HOME/dam/`; later, credentials under `$XDG_STATE_HOME/dam/`), and makes outbound network calls only to the configured server. There is no telemetry and no anonymous reporting — the platform collects nothing today and the CLI does not break that posture.

## Config

Two persistence concerns are split across the XDG directories: editable configuration (this file, under `$XDG_CONFIG_HOME/dam/`) and credentials, which arrive with [`#80`](https://github.com/dam-agents/dam/issues/80) and live under `$XDG_STATE_HOME/dam/`.

- **Location:** `$XDG_CONFIG_HOME/dam/config.toml` (default `~/.config/dam/config.toml`). Flat schema, no profile indirection.
- **Keys:** v0 has one — `server` (URL). Adding a new config key requires registering it at compile time — undeclared keys are a build error.
- **Precedence at resolve time:** flag (per-invocation `--server`, when commands grow one) > env var > file > error. There is no silent default.
- **Env var:** `DAM_SERVER` for the server URL (matches the `dam` binary name). Future keys follow the same `DAM_<KEY>` convention.
- **Writes:** read-merge-rename. The CLI never blows away unrelated top-level keys, so a user can hand-edit comments or future config knobs without losing them on the next `dam config set`.

## Compatibility negotiation

Before any networked verb runs, the CLI hits the api-server's unauthenticated `GET /api/version` (plain HTTP, outside the tRPC surface) to learn the server's version and the minimum CLI version it accepts. Three verdicts:

- **Ok** — local CLI is at or ahead of the server's reported version. Command proceeds.
- **BehindCurrent** — local CLI is below the server but at or above the floor. The CLI warns to stderr and proceeds (exit 0).
- **BelowFloor** — local CLI is below the server's `minClientVersion`. Gated verbs (see below) hard-fail with a non-zero exit; un-gated verbs surface the same verdict but proceed.

When no floor is configured (`minClientVersion` absent from the response), `BelowFloor` is never produced — the CLI proceeds with `Ok` or `BehindCurrent` as if the floor check were skipped.

The floor is configurable via Helm (`apiServer.minClientCliVersion`) so operators can drop support for known-broken older clients without rebuilding the image. `dam ping` is the verb that opts into this gate explicitly; future networked verbs (`login`, `shell`, …) will too. `dam version` is the un-gated counterpart to `ping`: it surfaces the same verdict (and the same stderr warnings) but never refuses to run — it is informational, not gated, and always exits 0 even on probe failure.
