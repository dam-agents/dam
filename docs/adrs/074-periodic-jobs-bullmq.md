# ADR-074: Periodic work on BullMQ

**Date:** 2026-07-17
**Status:** Accepted
**Owner:** @jezekra1

## Context

Six modules each run their own jittered per-replica interval loop for periodic reconciliation — agent-artifacts sweep, experiment-arm reaping, approvals delivery sweep, runtime-delivery cron sweep, OAuth token refresh, and artifact-library expiry sweep. Each reimplements the same lifecycle (jittered start, idempotent tick, drain-on-shutdown), every replica scans redundantly, and there is no single place to see what background work exists or whether it ran. Meanwhile BullMQ on the platform Redis — a mandatory primitive — already runs the schedules and runtime-delivery queues, but only for per-entity deferred jobs; periodic work never adopted it.

## Decision

Periodic background work in the api-server runs as BullMQ repeatable jobs on the platform Redis, through one shared helper; per-replica `setInterval` sweep loops are deprecated and migrate to it.

Scope is periodic platform work: reconciliation sweeps and refresh loops. The helper owns the repeatable-job lifecycle — registration, cleaning stale repeat keys when an interval changes, graceful drain on shutdown. Ticks remain idempotent and concurrency-safe: the queue provides scheduling and visibility, never correctness — a raced or duplicated tick must stay a no-op, exactly as the interval sweepers guarantee today. Per-connection protocol timers (relay keepalives, ACP timeouts) are out of scope; they are connection state, not platform work. The existing per-entity deferred queues are unaffected.

## Alternatives Considered

- **Keep per-replica interval loops** — safe and proven, but six duplicated lifecycle implementations and N-replica redundant scans, with no shared observability.
- **Kubernetes CronJobs** — each tick needs the module composition (DB, object store, config), so every job would duplicate api-server boot wiring to run a millisecond-scale scan.
- **Postgres leader election (advisory locks / pg_cron)** — avoids new queue machinery but adds leader-election code the platform doesn't have; BullMQ already provides the semantics on an existing primitive.

## Consequences

- **Easier:** one execution per period instead of one per replica (six sweepers today run on every replica); one lifecycle implementation instead of six hand-rolled loops; all periodic work is enumerable and inspectable in one place — the queue — with uniform retry/backoff semantics.
- **Harder:** introduces BullMQ's repeatable-job machinery, which neither existing queue uses — notably, changed intervals orphan old repeat keys unless the helper cleans them (documented BullMQ behavior). A Redis outage now pauses all periodic work platform-wide, where interval loops kept running per replica; Redis is already load-bearing for schedules and delivery, so this widens an existing shared fate rather than creating one.
- **Committed-to:** ticks stay idempotent under at-least-once execution — migrating a sweeper never removes its concurrency safety; all six existing sweepers migrate, and new periodic work must not add `setInterval` loops.
