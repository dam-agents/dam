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

## Compatibility negotiation

Before any networked verb can run, the CLI hits the api-server's unauthenticated `GET /api/version` endpoint (plain HTTP, outside the tRPC surface) to learn the server's version and the minimum CLI version it accepts. The CLI hard-refuses to run when its own semver is below the floor, and warns to stderr when the server is ahead but compatible. The endpoint is configurable via Helm so operators can drop support for known-broken older clients without rebuilding the image.
