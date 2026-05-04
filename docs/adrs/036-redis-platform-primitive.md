# ADR-036: Redis as a platform primitive — pub/sub, queues, cache

**Date:** 2026-04-29
**Status:** Accepted
**Owner:** @jezekra1

## Context

Several upcoming and existing features want a primitive that Postgres does not fit cleanly:

- Cross-replica signaling — held call wake-ups, fan-out to user WSs ([ADR-035](035-unified-hitl-ux.md)).
- Caching layer for read-heavy paths shared across replicas — no specific feature is decided here, but session-log replay ([ADR-026](026-session-log-replay.md)) is a plausible first candidate (many concurrent cursors re-reading the same rows).
- Simple work queues for low-latency background work where cron + table polling is too coarse but a full broker is too much.

`pg LISTEN/NOTIFY` is the natural first reach for the signaling case but has real warts: requires a dedicated long-lived connection per LISTEN-ing replica (cannot use the pool), has an 8KB payload limit, and is awkward in `node-postgres`. For caching, Postgres has no equivalent at the latency tier we'd want. Standing up a full broker (RabbitMQ, NATS, Kafka) is over-scoped for the work we have in flight.

## Decision

**Adopt Redis as a platform primitive alongside Postgres.** Use Redis for:

- **Pub/sub** — cross-replica signaling, fan-out to user WSs, held-call wake-ups. Channel-per-id pattern.
- **Simple queues** — when we need to dispatch work to an idle worker but don't need transactional handoff or full broker semantics.
- **Cache** — replica-shared cache for read-heavy paths. No specific use case is committed by this ADR; the primitive becomes available, individual features decide on their own merits whether to reach for it.

Use Redis going forward wherever it makes sense within these categories. The split between Redis and Postgres is the load-bearing rule:

- **Postgres = source of truth.** Anything where data loss would be incorrect — durable state, audit, anything queryable for inboxes / history / debugging — lives in Postgres. Redis is on the signal path, not the truth path.
- **Redis = ephemeral coordination and accelerated reads.** A Redis outage must degrade a feature to its Postgres-backed fallback (poll, re-query, compute), never to data loss or incorrect verdicts.
- **Don't reach for Redis when replica-local memory is enough.** Cross-replica primitives have a real cost; default to in-process unless coordination across replicas is required.

## Operational shape

- Deployed via the Helm chart, single instance for v1. Sentinel / cluster mode deferred until usage warrants.
- Cluster-wide, not per-namespace or per-instance.
- Dev cluster: deployed as part of `mise run cluster:install`.
- Connection URL exposed to the API Server via env, alongside the Postgres connection string.
- Persistence (AOF / RDB) is enabled with relaxed durability — Redis is allowed to lose recent data on restart; consumers must already tolerate that per the truth-path rule.

## Alternatives Considered

- **`pg LISTEN/NOTIFY` for all signaling, no Redis.** Considered. Rejected for the reasons in Context — the connection-pool interaction and TS ergonomics make it a worse default than the Redis primitive, and it does nothing for the caching and queuing categories. Postgres-poll remains a per-feature fallback when Redis is unavailable.
- **Full broker (RabbitMQ / NATS / Kafka).** Considered for the queueing category. Rejected — over-scoped for our current needs; introduces a heavy new dependency with operational and authoring overhead far beyond what Redis covers. Revisitable if a feature emerges that genuinely needs durable broker semantics.
- **Defer the decision; pick per-use-case.** Rejected — would result in three near-duplicate ad-hoc solutions over the next few features, each justified locally. Naming the platform primitive once means new features can reach for it without re-litigating.

## Consequences

- One new platform dependency in the Helm chart and dev bootstrap.
- HITL ext_authz hold ([ADR-035](035-unified-hitl-ux.md)) uses Redis as its cross-replica wake-up channel without inheriting `pg LISTEN/NOTIFY`'s pool quirks.
- Future caching work has a clear destination if and when a feature wants it — replica-shared, fast, with a Postgres-backed fallback path. No specific feature is committed by this ADR.
- Future simple-queue work can use Redis lists / streams without introducing a heavier broker.
- Operators size Redis for memory pressure. Cache TTLs and queue depth are author-side responsibilities; the platform doesn't enforce a global cap.
- Features that lean on Redis must declare a graceful Redis-down behavior, even if it's just "extra latency" or "feature disabled until Redis recovers." No feature is allowed to corrupt durable state on a Redis outage.

## Related ADRs

- [ADR-017 — DB-backed sessions](017-db-backed-sessions.md) — Postgres remains the platform's source of truth; this ADR adds an ephemeral-coordination primitive alongside it.
- [ADR-035](035-unified-hitl-ux.md) — first consumer of Redis pub/sub for cross-replica HITL wake-ups.
