# CLI

Last verified: 2026-05-06

## Motivated by

- [ADR-039 — Platform CLI foundation](../adrs/039-cli-foundation.md) — TypeScript Node package distributed via npm; reuses the api-server tRPC contract; flat config under `~/.dam/`; server-advertised compatibility floor.
- [ADR-037 — Remote terminal](../adrs/037-remote-terminal.md) — predecessor; established the "terminal" session mode the CLI complements with `dam shell` (a future verb).

## Overview

The `dam` CLI is a TypeScript Node package, installed via `npm install -g @dam-agents/cli`, that points at a configured Platform deployment. Users run it on their own machine; it never runs inside the cluster. Today's surface is `dam --version` and `dam --help` (commander.js built-ins). Subsequent work adds `dam config set`, `dam ping`, and `dam version` (the un-gated counterpart to `ping`); future verbs — `dam login`, `dam shell`, `dam import` — slot into the same module.

The package shares the api-server's tRPC contract directly via the `api-server-api` workspace package. Every server-side type change reaches the CLI without codegen or manual mirroring. tRPC is not wired in this initial slice — the foundation lands first; verbs that need authenticated calls bring the client wiring with them.

## Trust boundary

The CLI runs on the user's machine. It reads and writes only under `~/.dam/` (today: `config.toml`; later, credentials in their own files), and makes outbound network calls only to the configured server. There is no telemetry and no anonymous reporting — the platform collects nothing today and the CLI does not break that posture.

## Config

Two persistence concerns share `~/.dam/`: the configuration the user can edit (this file) and credentials, which arrive with [`#80`](https://github.com/dam-agents/dam/issues/80) and live in their own files.

- **Location:** `~/.dam/config.toml`. Flat schema, no profile indirection.
- **Keys:** v0 has one — `server` (URL). Adding a key is forced by a `satisfies Record<ConfigKey, true>` registry that fails to compile until the new field is registered.
- **Precedence at resolve time:** flag (per-invocation `--server`, when commands grow one) > env var > file > error. There is no silent default.
- **Env var:** `DAM_SERVER` for the server URL (matches the `dam` binary name). Future keys follow the same `DAM_<KEY>` convention.
- **Writes:** read-merge-rename. The CLI never blows away unrelated top-level keys, so a user can hand-edit comments or future config knobs without losing them on the next `dam config set`.

## Compatibility negotiation

Before any networked verb runs, the CLI hits the api-server's unauthenticated `GET /api/version` (plain HTTP, outside the tRPC surface) to learn the server's version and the minimum CLI version it accepts. Three verdicts:

- **Ok** — local CLI is at or ahead of the server's reported version. Command proceeds.
- **BehindCurrent** — local CLI is below the server but at or above the floor. The CLI warns to stderr and proceeds (exit 0).
- **BelowFloor** — local CLI is below the server's `minClientVersion`. The CLI hard-fails with a non-zero exit and refuses to run, regardless of which verb the user invoked.

The floor is configurable via Helm (`apiServer.minClientCliVersion`) so operators can drop support for known-broken older clients without rebuilding the image. `dam ping` is the verb that opts into this gate explicitly; future networked verbs (`login`, `shell`, …) will too. `dam version` (issue 6) reports the verdict but never refuses to run — it is informational, not gated.
