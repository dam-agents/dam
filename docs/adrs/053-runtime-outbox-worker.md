# ADR-053: Transactional outbox + BullMQ worker for runtime-channel delivery

**Date:** 2026-05-21
**Status:** Proposed
**Owner:** @jezekra1

## Context

The unified runtime channel (ADR-052) replaces three direct-call mechanisms (pod-files SSE, `kubectl exec` trigger files, direct skills tRPC) with one tRPC route the api-server calls (`applyState`) and one the agent calls (`hello`). Events in the payload are processed by per-kind handlers on the harness API server. The question is *who calls the agent and when*. Doing it inline from mutation handlers couples user-facing request latency to agent reachability — a hibernated or restarting pod would block or fail the user's request — and creates a fan-out problem when one mutation affects many agents. A persistent WebSocket model would push the routing concern into the cluster's load-balancer topology, bringing every cross-replica failure mode into the runtime-channel critical path. The platform's signal/truth split (ADR-036) names the right shape for problems that need both durability and low-latency cross-replica wakeup: Postgres holds the truth, Redis carries the signal. Within that shape, hand-rolling competing-consumer semantics (stalled-job recovery, retry/backoff, job-id dedupe, observability) is a meaningful surface to maintain when a battle-tested library already covers it.

## Decision

Agent-bound state changes (Contribution edits, event insertions) are committed to a Postgres outbox in the same transaction as their domain mutation; a BullMQ worker on every api-server replica consumes from BullMQ and delivers via the runtime channel's `applyState`.

- **Postgres is the source of truth, BullMQ is the dispatcher.** The outbox row is written inside the mutation transaction. After commit, the handler enqueues a BullMQ job that references the outbox row. BullMQ owns competing-consumer dispatch, retry-with-backoff, stalled-job recovery, and the operational dashboard surface; it does not own durability.

- **One outbox surface — snapshot-shaped.** A `runtime_state_outbox` row exists at most one per agent. It tracks `last_enqueued_at`, `last_applied_version`, `last_applied_hash`, and `last_applied_at`. Events are not a second outbox: they live in `runtime_events` (one row per pending event, with `version`, `dispatched_at`, and `expires_at`), and the state-builder reads non-dispatched events as part of constructing the payload. Any change to contributions or any event insert bumps the agent's `version` and the outbox row's `last_enqueued_at`.

- **One per-agent monotonic version.** All changes — contribution edits and event inserts alike — bump a single per-agent `version` counter. State-builder reads use it; the agent acks it. There is no separate counter for events.

- **Mutation path is one Postgres transaction plus one BullMQ enqueue.** The handler commits the domain change (contribution edit or event insert), bumps the agent's `version`, upserts the outbox row, all in one transaction; then enqueues a BullMQ job after commit. The user-facing response returns immediately; agent reachability does not influence response time.

- **State coalescing via stable job ids.** Jobs are enqueued with a stable id derived from the agent id (e.g. `state:<agentId>`). A flurry of mutations affecting the same agent in quick succession deduplicates naturally — BullMQ rejects re-adds of an already-pending id. Each dispatch computes the *current* state slice and *currently pending* events from Postgres, so a coalesced job still picks up everything that happened during its in-flight window.

- **Worker stamps `dispatched_at` on a successful ack, in one transaction.** When `applyState` returns `{ appliedVersion, appliedHash }`, the worker runs:
  - `UPDATE runtime_state_outbox SET last_applied_version = $V, last_applied_hash = $H, last_applied_at = now() WHERE agent_id = $A;`
  - `UPDATE runtime_events SET dispatched_at = now() WHERE agent_id = $A AND version <= $V AND dispatched_at IS NULL;`
  The work-doing per-kind event handlers do NOT touch `runtime_events`. Their job is the side effect and its own idempotency key; the dispatch marker is owned by the worker.

- **Idempotency lives on the work-doing handler's side-effect table.** Each event kind's harness handler holds a unique constraint joining its side-effect table back to the event id. A redelivered event (agent crashed between work-call and apply-ack, lost ack, network blip) re-invokes the handler; the constraint catches the duplicate; the second call returns the existing side-effect row. The next apply-ack stamps `dispatched_at` and removes the event from future snapshots.

- **Periodic cron sweep is the Redis-down fallback.** A scheduled job (every minute) scans the outbox for rows where `last_enqueued_at > last_applied_at` and `last_enqueued_at < now() - sweepInterval`, and re-enqueues. A Redis blip or BullMQ outage that loses pending jobs degrades to "delivery delayed by sweep interval"; no rows are lost because the outbox is in Postgres. The same sweep deletes expired events (`expires_at <= now()` and `dispatched_at IS NULL`).

- **Non-running agents are deferred to the sweep.** The handler reads agent state from the existing in-memory cache (ConfigMap watch in the agents service). If the agent is not running, the handler exits clean and leaves the outbox row in place — the cron sweep re-enqueues it on a later tick, and the agent's own `hello` clears it on wake. BullMQ retries are reserved for actual transport failures (network blip, agent crash mid-call), not for "not ready yet."

- **`hello` reads the same state-builder.** A waking agent calls `hello` with its `lastAppliedVersion`; the harness server runs the same state-builder, compares the resulting payload against the agent's reported state, and returns it only if anything diverged. Events the agent receives via `hello` follow the same execute-and-commit rule; the agent's eventual apply-ack via the next worker dispatch is what advances `dispatched_at`.

- **The worker is a self-contained module.** It depends on BullMQ, Postgres, and an HTTP client; no shared in-process state with HTTP handlers. A future move into a separate Deployment is a feature-flag flip, not a refactor.

- **BullMQ free tier is sufficient.** None of the BullMQ Pro features (group rate-limiting, observers, batches, dynamic concurrency) are needed for this workload; this decision does not introduce a paid dependency.

## Alternatives Considered

- **Worker stamps based on the agent's reported `processedEventIds`** — rejected. Adds a per-event ack list to the wire response and creates a second source of truth for "event done" beside the work-handler's side-effect commit. The single-cursor model collapses to one query — `UPDATE … WHERE version <= acked` — and is unambiguous.

- **Work-doing handler stamps `runtime_events.dispatched_at`** — rejected. Couples every event kind's handler to the outbox table and splits the dispatch marker between two callers (the work handler on the inbound RPC, the worker on the apply-ack). The clean shape: worker owns the outbox, work-handler owns its own side-effect table's idempotency.

- **Two outbox surfaces — `runtime_state_outbox` and `runtime_signal_outbox`** — rejected. Earlier draft. Once ADR-052 collapsed signals into the runtime payload, the second outbox became a delivery rail without distinct delivery semantics. One outbox, one queue, one set of operational metrics.

- **Inline delivery from mutation handlers** — rejected, couples user-facing request latency to the agent's reachability and forces the handler to deal with agent-down / hibernated / restarting cases that have nothing to do with the user's mutation.

- **Hand-rolled worker over Postgres with `FOR UPDATE SKIP LOCKED` and Redis pub/sub wake** — viable; smaller dependency surface; uses only primitives we already run. Rejected because the surrounding code (stall detection, retry/backoff policy, job-id dedupe semantics, an ops dashboard) is non-trivial to maintain correctly and BullMQ has solved it. The simpler ADR text hides real implementation and operational cost.

- **BullMQ as the durable queue (no Postgres outbox)** — rejected. The platform's Redis is intentionally configured for relaxed durability per ADR-036; a Redis restart would drop pending jobs. Hardening Redis cluster-wide for this one consumer is out of proportion to the need.

- **Pure Postgres polling, no Redis-side wake** — rejected, sub-second propagation on state changes is incompatible with poll intervals that don't hammer the database.

- **`pg_notify` instead of Redis** — rejected per ADR-036's existing analysis (dedicated long-lived connection per LISTEN-ing replica, 8 KiB payload cap, awkward in node-postgres).

- **One state-outbox row per event, not per agent** — rejected, delivery is per-agent and coalescing-friendly; a flurry of mutations affecting the same agent should merge into one delivery, which one-row-per-agent plus stable job ids expresses naturally with no dispatch-time dedupe logic.

## Consequences

- **Easier:** Mutation handlers are fast and uniform — a domain write plus a `version` bump plus an outbox upsert in one transaction, then an enqueue. Agent reachability, hibernated pods, partial failures, and retry policy never enter the user-facing request path.

- **Easier:** Retry/backoff, stalled-job recovery, job-id dedupe, and an ops dashboard come from BullMQ's existing surface instead of being maintained in-tree. A future schedule-firing worker (the producer that inserts event rows) inherits the same infrastructure.

- **Easier:** Trigger delivery becomes durable end-to-end and shares its rail with configuration. The current `kubectl exec` model loses triggers on exec failure; event rows in Postgres survive replica crashes, agent disconnects, BullMQ restarts, and Redis outages, bounded only by their `expires_at`.

- **Easier:** Single cursor for both slices. The worker's apply-ack stamp is one `UPDATE … WHERE version <= acked` for events plus one row update for state. No per-event tracking across the round-trip.

- **Easier:** No agent-side persistent dedupe needed. Work-handler idempotency on the event id (a unique constraint on its side-effect table) handles the crash-during-fire case; the worker's cursor stamp handles "stop sending it next time."

- **Easier:** One queue, one worker, one set of metrics. The earlier signal-channel and worker-stamp-via-processedEventIds designs each added a parallel surface; collapsing eliminates both.

- **Harder:** Two coordinators must agree on the truth — Postgres outbox and BullMQ's job state can diverge (job lost from Redis with the row remaining in the outbox; or row deleted while a stale job retries). The cron sweep covers the first case; the handler's lookup-by-agent-id covers the second (no pending change → no-op). Both are simple but must exist for the architecture to be honest.

- **Harder:** A new library dependency and a new operational concern. Queue depth, stalled jobs, retry exhaustion, and Bull Board (or equivalent) become things the team has to learn to read.

- **Harder:** The schedule firing path now belongs to a BullMQ consumer or an api-server cron task that inserts event rows, not the controller's cron. Reliability of "did this schedule fire?" depends on the producer running, which depends on at least one api-server replica being up — a coverage profile equivalent to the existing controller but with a different failure mode.

- **Harder:** Each event kind's harness handler needs an idempotency key (a unique constraint joining its side-effect table back to `runtime_events.id`). The pattern is small and uniform but must be applied consistently or a kind's redelivery becomes lossy or double-firing.

- **Committed-to:** Postgres remains the truth substrate; the cron sweep is the load-bearing path for surviving any BullMQ / Redis loss. BullMQ's API surface (job ids, options, events, processor signatures) is now part of how the worker is reasoned about; a future migration off BullMQ pays the cost of porting that surface. The worker module's `start()` / `stop()` lifecycle and feature-flag gating must stay clean enough to lift into a separate Deployment without code changes.
