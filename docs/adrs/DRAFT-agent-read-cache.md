---
id:
title: Agent reads served from a watch-backed cache, writes from live reads
status: proposed
supersedes:
subsystem: agent-lifecycle
tags: [kubernetes, api-server, latency]
summary: The api-server serves Agent reads from a per-replica watch-backed cache, while any reader that decides a write from what it read stays on a live read.
---

# ADR-NNN: Agent reads served from a watch-backed cache, writes from live reads

**Date:** 2026-08-27
**Status:** Proposed
**Owner:** @jezekra1

## Context

Every Agent read in the api-server goes to the Kubernetes API: 22 single reads and 5 namespace-wide listings, the listing once per UI request. The wake path re-reads on a backoff that stretches to five seconds, so an agent can sit ready for up to six seconds before anything notices. Both are the same underlying gap — the api-server has no current picture of Agent state, so it asks again every time it needs one.

## Decision

The api-server serves Agent reads from a per-replica cache kept current by a watch, instead of querying the Kubernetes API on every call. Any reader that decides a write from what it read keeps reading directly, and that split — not the cache — is what this record fixes.

Three rules define the split:

- A reader that only reports state may use the cache. Listing an owner's agents, resolving ownership, and answering "is this agent ready" all qualify.
- A reader whose result determines a subsequent write must not. Read-modify-write of the spec, and the pause flow's compare-and-clear of the exact stamp it wrote, both break under a stale view: the first can silently drop a concurrent change, the second can resurrect an agent that was meant to stay down.
- Until the cache has completed its initial sync it answers from a live read, because an unsynced cache cannot distinguish "no such agent" from "not seen yet", and that distinction feeds the typed wake failures callers show users.

Which side of the split a reader sits on is a property of the reader, decided at its call site and visible there. The cache is not a global switch and does not change what a read means.

This refines ADR-032 rather than replacing it: observed `Ready` remains the authoritative answer to "can I call this pod?" — only the observation's source changes.

## Alternatives Considered

- **Poll faster** — dropping the backoff ceiling to sub-second closes the latency gap but multiplies control-plane reads, the load this record exists to reduce.
- **Readiness on the in-process event bus** — events do not cross replicas, and the Agent watch is lease-elected so each transition projects to browsers once; the event would fire in a replica that is not the one waiting.
- **Readiness cached in Redis, written by one watcher** — makes every replica's freshness depend on a single watcher process and adds a copy that outlives the truth when that watcher dies.
- **Mirror Agent status into Postgres** — the controller is the sole writer of status and is barred from Postgres, so the mirror would need the same watch plus a durable second copy of state that is authoritative elsewhere.

## Consequences

- **Easier:** the UI's agent listing stops issuing a namespace-wide Kubernetes listing per request, the single largest read source in the inventory above.
- **Easier:** readiness is observable the moment it changes rather than at the next poll, removing the mean ~3s and worst ~6s of dead time measured on the wake path.
- **Harder:** a stale read fails by succeeding with the wrong answer, which is quieter than a failed call. The split above is the only thing preventing it, so every new Agent reader has to be placed on one side deliberately.
- **Harder:** each replica holds every Agent object in memory. At the current fleet size this is negligible; it grows linearly and is not bounded by anything in this decision.
- **Committed-to:** a watch per replica. The lease that keeps browser projections single-fires does not apply to a cache read locally, so replica count now drives watch count against the Kubernetes API.
