# CLI

Last verified: 2026-05-11

## Motivated by

- [ADR-039 — Platform CLI foundation](../adrs/039-cli-foundation.md) — TypeScript Node package distributed via npm; reuses the api-server tRPC contract; flat config under XDG-standard locations; server-advertised compatibility floor.
- [ADR-037 — Remote terminal](../adrs/037-remote-terminal.md) — predecessor; established the "terminal" session mode the CLI complements with `dam shell` (a future verb).

## Overview

The `dam` CLI is a TypeScript Node package that users install on their own machine and point at a configured Platform deployment. It never runs inside the cluster. The current surface: `dam --version`, `dam --help` (built-in flags), `dam config set`, `dam ping`, `dam version`, and the `dam auth login` / `dam auth logout` / `dam auth status` verbs added by [#80](https://github.com/dam-agents/dam/issues/80). Future verbs — `dam shell`, `dam import` — slot into their own modules and consume the Token Provider seam from `auth`.

The CLI shares types directly with the api-server via a shared contract package, so server-side type changes reach the CLI without codegen or manual mirroring. The contract client is not wired in this initial slice — the foundation lands first; verbs that need authenticated calls bring the client wiring with them.

## Trust boundary

The CLI runs on the user's machine. It reads and writes only under the XDG config and state directories (today: `config.toml` under `$XDG_CONFIG_HOME/dam/`; later, credentials under `$XDG_STATE_HOME/dam/`), and makes outbound network calls only to the configured server. There is no telemetry and no anonymous reporting — the platform collects nothing today and the CLI does not break that posture.

## Config

Two persistence concerns are split across the XDG directories: editable configuration (this file, under `$XDG_CONFIG_HOME/dam/`) and credentials (`auth.toml` under `$XDG_STATE_HOME/dam/`, written by `dam auth login`).

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

The floor is configurable via Helm (`apiServer.minClientCliVersion`) so operators can drop support for known-broken older clients without rebuilding the image. `dam ping` and `dam auth login` opt into this gate explicitly; future networked verbs (`shell`, …) will too. `dam version` is the un-gated counterpart to `ping`: it surfaces the same verdict (and the same stderr warnings) but never refuses to run — it is informational, not gated, and always exits 0 even on probe failure.

## Authentication

`dam auth login` authenticates the user against the Active Host's Keycloak realm via the OAuth 2.0 Device Authorization Grant ([RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628)). The realm advertises a public client `platform-cli` (no secret, device grant only) registered in the Helm chart; `/api/auth/config` exposes its id alongside the existing `platform-ui` id so the CLI never hardcodes it.

The flow:

1. Pre-flight `CompatService.check()` — same gate the `ping` verb uses.
2. `GET /api/auth/config` → `{ issuer, clientId, cliClientId }`.
3. `GET <issuer>/.well-known/openid-configuration` → device, token, revocation endpoints.
4. `POST <device endpoint>` → user code + verification URI; CLI prints the URI (and opens the browser unless `--no-browser`).
5. Polling `POST <token endpoint>` with `grant_type=urn:ietf:params:oauth:grant-type:device_code` per RFC 8628 §3.5 (slow_down → +5s, expired_token / access_denied → terminal).
6. On success, persist a per-host record into `$XDG_STATE_HOME/dam/auth.toml` (mode 0600, atomic tmp+rename, read-merge-write to preserve unrelated keys). If `--server` was supplied, persist it as the new active host in `config.toml`.

Credentials are keyed by host URL — the file is a `Map<HostUrl, HostAuth>` shape so switching between Platform deployments doesn't clobber state. `dam auth status` lists every host (active marked), the credential source, and the access-token expiry. **It never prints tokens.** `dam auth logout` best-effort RFC 7009 revokes the refresh token and atomically removes the host's entry — local clear always proceeds even when revocation fails (exit 0, stderr warning). Logout is not OIDC RP-Initiated Logout: the CLI must not kill SSO sessions for unrelated clients (the web UI, federated apps).

The `auth` module exposes a single application service — **`TokenProvider`** — which every future authenticated CLI verb consumes via `getValidAccessToken(host)`. Precedence: `DAM_TOKEN` env var (returned verbatim, no refresh) > Auth Store entry (refreshed proactively within 60s of expiry) > `not-logged-in` error. On a successful refresh the rotated refresh token is persisted atomically; on `invalid_grant` the host's entry is cleared and `session-expired` surfaces so the next command line directs the user to `dam auth login` again. Concurrent refreshes can race in v1 — the cost is one forced re-login, not data loss (single-flight is a deferred follow-up).

For headless / CI use, set `DAM_TOKEN=<bearer>` — the CLI uses it verbatim and bypasses `auth.toml`. There is no `--token` flag (avoids leaking tokens into shell history and `ps`).
