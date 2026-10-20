---
id: 111
title: A pod service takes an env change as a signal, with no env snapshot to re-read
status: accepted
subsystem: agent-lifecycle
summary: agent-runtime no longer writes the merged env for a pod service to re-read on a reload signal; a service that wants fresh env is one that does not handle the signal.
---

# ADR-111: A pod service takes an env change as a signal, with no env snapshot to re-read

**Date:** 2026-10-20
**Status:** Accepted
**Amends:** ADR-066 — its reload half only; the supervision half stands.
**Owner:** @JanPokorny

## Context

ADR-066 gives a pod service two ways to take an env change: re-read a snapshot file of the merged env that the runtime writes, or die by the reload signal's default action and be respawned with the fresh env.
It states them as the runtime that "persists the merged env to a well-known snapshot file" and sends SIGHUP, and as "a service that handles the signal re-reads the snapshot and re-points itself without closing its listener".
No shipped image carries a pod service.
The repository's only reader of the snapshot was a Claude Code image script that rewrote a permission mode, and that script reads nothing from it now.
What remains is a write on the path that refreshes the pod service's env: it runs first, and a failure the document store does not absorb, as a directory at the temp path it writes, stops the refresh, the model catalog refresh and the recovery scheduling that follow it.

## Decision

**The runtime no longer persists the merged env to a snapshot file; an env change reaches a pod service as a signal, and fresh env comes with a restart.**
This amends ADR-066's reload half and keeps its supervision half: the runtime still starts the one optional service, restarts it with capped backoff, and leaves it down after a clean exit.
A service that does not handle the reload signal dies by its default action and is respawned with the fresh env.
A service that handles it and stays up keeps the env it started with.

## Alternatives Considered

- **Keep writing the snapshot** — it has no reader in this repository, and its write sits before the env refresh, where a write the store cannot place on disk, as a directory at its temp path, throws and stops the refresh.
- **Restart every running service instead of signalling it** — a service that wants to drain in-flight work loses a signal it can still handle today, and none ships.
- **Delete the pod service hook** — out of scope: the hook stays for a custom image.

## Consequences

- **Easier:** an env change has one document write fewer on its path to the pod service's refresh; the snapshot write was awaited before that refresh and before the model catalog refresh that follows it.
- **Harder:** a service that handles the reload signal and stays up keeps the env it started with, since nothing writes the merged env any more; to reach fresh env it exits and waits for the next change, or restarts itself.
- **Committed-to:** in-place env reload without a restart is not supported. A future image that needs it has to bring back a file or a protocol for the service to read.
