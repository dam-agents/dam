# ADR-049: Transactional outbox + BullMQ worker for runtime-channel delivery

**Date:** 2026-05-21
**Status:** Proposed
**Owner:** @jezekra1

## Context

The unified runtime channel (ADR-048) replaces three direct-call mechanisms (pod-files SSE, `kubectl exec` trigger files, direct skills tRPC) with two tRPC pairs. The question is *who calls the agent and when*. Doing it inline from mutation handlers couples user-facing request latency to agent reachability — a hibernated or restarting pod would block or fail the user's request — and creates a fan-out problem when one mutation affects many agents. A persistent WebSocket model would push the routing concern into the cluster's load-balancer topology, bringing every cross-replica failure mode into the runtime-channel critical path. The platform's signal/truth split (ADR-036) names the right shape for problems that need both durability and low-latency cross-replica wakeup: Postgres holds the truth, Redis carries the signal. Within that shape, hand-rolling competing-consumer semantics (stalled-job recovery, retry/backoff, job-id dedupe, observability) is a meaningful surface to maintain when a battle-tested library already covers it.

## Decision

Agent-bound state changes and signals are committed to a Postgres outbox in the same transaction as their domain mutation; a BullMQ worker on every api-server replica consumes from BullMQ and delivers via the runtime channel.

- **Postgres is the source of truth, BullMQ is the dispatcher.** The outbox row is written inside the mutation transaction. After commit, the handler enqueues a BullMQ job that references the outbox row. BullMQ owns competing-consumer dispatch, retry-with-backoff, stalled-job recovery, and the operational dashboard surface; it does not own durability.
- **Two outbox surfaces, different shapes.** A state-outbox row exists at most one per agent — it carries no payload, only the marker that "this agent's contributions changed; recompute and push." Signal-outbox rows exist one per discrete event (id, action, payload, enqueued time, ttl). The shape difference reflects the semantics: state is snapshot-shaped and last-write-wins per agent; signals are event-shaped and each one needs its own delivery+ack lifecycle.
- **Mutation path is one Postgres transaction plus one BullMQ enqueue.** The handler commits the domain change and the outbox row atomically, then enqueues a BullMQ job after commit. The user-facing response returns immediately; agent reachability does not influence response time.
- **State coalescing via stable job ids.** State-outbox jobs are enqueued with a stable job id derived from the agent id (e.g. `state:<agentId>`). A flurry of mutations affecting the same agent in quick succession deduplicates naturally — BullMQ rejects re-adds of an already-pending id. Signal jobs use per-signal ids.
- **Periodic cron sweep is the Redis-down fallback.** A scheduled job (every few minutes) scans the outbox for rows where the most-recent enqueue is stale (or absent) and re-enqueues them. A Redis blip or BullMQ outage that loses pending jobs degrades to "delivery delayed by sweep interval"; no rows are lost because the outbox is in Postgres.
- **Non-running agents handled inside the job handler.** The handler reads agent state from the existing in-memory cache (ConfigMap watch in the agents service). If the agent is not running, the handler throws — BullMQ retries with a long-backoff policy. The agent's own `hello` on wake clears the outbox row; the eventual retry finds no row and exits clean.
- **The agent's `hello` returns pending signals; ack deletes them.** A single round-trip on wake returns both the current state (if hash diverged) and the agent's pending signal rows. Hello does not delete the rows; the agent's ack does. Duplicate delivery (hello + a BullMQ retry racing) is harmless because the agent deduplicates signals by id per ADR-048, and a second delete of an already-gone row is a no-op.
- **TTL on signal jobs.** Each signal-outbox row carries a TTL; the BullMQ job's retry budget approximates the TTL. The handler also checks TTL on entry and exits clean (deleting the row) when expired, counting `dropped-expired`.
- **The worker is a self-contained module.** It depends on BullMQ, Postgres, and an HTTP client; no shared in-process state with HTTP handlers. A future move into a separate Deployment is a feature-flag flip, not a refactor.
- **BullMQ free tier is sufficient.** None of the BullMQ Pro features (group rate-limiting, observers, batches, dynamic concurrency) are needed for this workload; this decision does not introduce a paid dependency.

## Alternatives Considered

- **Inline delivery from mutation handlers** — rejected, couples user-facing request latency to the agent's reachability and forces the handler to deal with agent-down / hibernated / restarting cases that have nothing to do with the user's mutation.
- **Hand-rolled worker over Postgres with `FOR UPDATE SKIP LOCKED` and Redis pub/sub wake** — viable; smaller dependency surface; uses only primitives we already run. Rejected because the surrounding code (stall detection, retry/backoff policy, job-id dedupe semantics, an ops dashboard) is non-trivial to maintain correctly and BullMQ has solved it. The simpler ADR text hides real implementation and operational cost.
- **BullMQ as the durable queue (no Postgres outbox)** — rejected. The platform's Redis is intentionally configured for relaxed durability per ADR-036; a Redis restart would drop pending jobs. Hardening Redis cluster-wide for this one consumer is out of proportion to the need.
- **Pure Postgres polling, no Redis-side wake** — rejected, sub-second propagation on state changes is incompatible with poll intervals that don't hammer the database.
- **`pg_notify` instead of Redis** — rejected per ADR-036's existing analysis (dedicated long-lived connection per LISTEN-ing replica, 8 KiB payload cap, awkward in node-postgres).
- **One state-outbox row per event, not per agent** — rejected, state delivery is snapshot-shaped; a flurry of mutations affecting the same agent should coalesce into one delivery, which one-row-per-agent plus stable job ids expresses naturally with no dispatch-time dedupe logic.

## Consequences

- **Easier:** Mutation handlers are fast and uniform — a domain write plus an outbox write in one transaction, then an enqueue. Agent reachability, hibernated pods, partial failures, and retry policy never enter the user-facing request path.
- **Easier:** Retry/backoff, stalled-job recovery, job-id dedupe, and an ops dashboard come from BullMQ's existing surface instead of being maintained in-tree. A future schedule-firing worker (a separate consumer on the same BullMQ surface) inherits the same infrastructure.
- **Easier:** Trigger delivery becomes durable end-to-end. The current `kubectl exec` model loses triggers on exec failure; signal-outbox rows survive replica crashes, agent disconnects, BullMQ restarts, and Redis outages, bounded only by their TTL.
- **Harder:** Two coordinators must agree on the truth — Postgres outbox and BullMQ's job state can diverge (job lost from Redis with the row remaining in the outbox; or row deleted while a stale job retries). The cron sweep covers the first case; the handler's lookup-by-row-id covers the second (no row → no-op). Both are simple but must exist for the architecture to be honest.
- **Harder:** A new library dependency and a new operational concern. Queue depth, stalled jobs, retry exhaustion, and Bull Board (or equivalent) become things the team has to learn to read.
- **Harder:** The schedule firing path now belongs to a BullMQ consumer, not the controller's cron. Reliability of "did this schedule fire?" depends on the worker being up, which depends on at least one api-server replica being up — a coverage profile equivalent to the existing controller but with a different failure mode.
- **Committed-to:** Postgres remains the truth substrate; the cron sweep is the load-bearing path for surviving any BullMQ / Redis loss. BullMQ's API surface (job ids, options, events, processor signatures) is now part of how the worker is reasoned about; a future migration off BullMQ pays the cost of porting that surface. The worker module's `start()` / `stop()` lifecycle and feature-flag gating must stay clean enough to lift into a separate Deployment without code changes.
