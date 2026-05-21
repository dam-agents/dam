# ADR-049: Transactional outbox + worker for runtime-channel delivery

**Date:** 2026-05-21
**Status:** Proposed
**Owner:** @jezekra1

## Context

The unified runtime channel (ADR-048) replaces three direct-call mechanisms (pod-files SSE, `kubectl exec` trigger files, direct skills tRPC) with two tRPC pairs. The question is *who calls the agent and when*. Doing it inline from mutation handlers couples user-facing request latency to agent reachability — a hibernated or restarting pod would block or fail the user's request — and creates a fan-out problem when one mutation affects many agents. A persistent WebSocket model would push the routing concern into the cluster's load-balancer topology (which replica holds the WS for agent X? how does another replica's mutation reach it?), bringing every cross-replica failure mode into the runtime-channel critical path. The platform's signal/truth split (ADR-036) already establishes the right shape for problems that need both durability and low-latency cross-replica wakeup: Postgres holds the truth, Redis pub/sub wakes consumers.

## Decision

Agent-bound state changes and signals are committed to a Postgres outbox in the same transaction as their domain mutation; an in-process worker on every api-server replica consumes the outbox and dispatches via the runtime channel.

- **Two outbox surfaces, different shapes.** A state-outbox row exists at most one per agent — it carries no payload, only the marker that "this agent's contributions changed; recompute and push." Signal-outbox rows exist one per discrete event (id, action, payload, enqueued time, ttl). The shape difference reflects the semantics: state is snapshot-shaped and last-write-wins per agent; signals are event-shaped and each one needs its own delivery+ack lifecycle.
- **Mutation path is a single transaction plus one Redis publish.** The handler commits the domain change and the outbox row atomically, then publishes a best-effort wake notification on Redis. The user-facing response returns immediately; the worker does the agent call.
- **Workers compete via `FOR UPDATE SKIP LOCKED`.** Every api-server replica runs the worker loop; rows dispatch exactly-once at any moment without leader election. A periodic sweep (default thirty seconds) covers any Redis-dropped wakes, drift introduced when an agent transitions to running, or anything the publish missed.
- **Non-running agents are skipped at dispatch.** The worker reads agent state from the existing in-memory cache that the agents service maintains from its ConfigMap watch — no per-row K8s API calls. Outbox rows for non-running agents stay queued; the agent's own `hello` on next wake pulls the catch-up, and the sweep cleans up state rows that were claimed by hello.
- **The agent's `hello` claims pending signals.** A single round-trip on wake returns both the current state (if hash diverged) and the agent's pending signal queue, claimed under the same `FOR UPDATE SKIP LOCKED` lock the worker uses. This avoids "agent is up but its signals are waiting for the next 30-second sweep" latency.
- **TTL and retry policy live in the worker.** Exponential backoff with jitter on dispatch failure; rows past TTL are deleted and counted as `dropped-expired`. The worker is the single owner of retry semantics; mutation handlers and the controller never reason about retries.
- **The worker is a self-contained module.** It depends only on Postgres, Redis, and an HTTP client for tRPC calls into the agent; no shared in-process state with HTTP handlers. A future move into a separate Deployment is a feature-flag flip (`disable in-process worker, run elsewhere`), not a refactor.

## Alternatives Considered

- **Inline delivery from mutation handlers** — rejected, couples user-facing request latency to the agent's reachability and forces the handler to handle agent-down / hibernated / restarting cases that have nothing to do with the user's mutation.
- **BullMQ or another Redis-backed queue library** — rejected at this stage. Either it owns the durable queue (incompatible with ADR-036's "Redis is allowed to lose data on restart" rule) or it sits alongside Postgres as a wake-up mechanism (which Redis pub/sub already covers in five lines). Revisit if multiple discrete job kinds with different retry policies, a queue dashboard, or per-queue rate limits become operational asks.
- **Pure Postgres polling, no Redis wakeup** — rejected, sub-second propagation on state changes (the user clicks "grant" and the agent is expected to be up-to-date the next time they look) is incompatible with poll intervals that don't hammer the database.
- **`pg_notify` instead of Redis pub/sub** — rejected per ADR-036's existing analysis (dedicated long-lived connection per LISTEN-ing replica, 8 KiB payload cap, awkward in node-postgres); Redis is already in the platform and already used for this exact pattern (ADR-035 HITL wakeups).
- **One state-outbox row per event, not per agent** — rejected, state delivery is snapshot-shaped; a flurry of mutations affecting the same agent within seconds should coalesce into one delivery, which one-row-per-agent expresses naturally with no per-dispatch dedupe logic.

## Consequences

- **Easier:** Mutation handlers are fast and uniform — a domain write plus an outbox write in one transaction. Agent reachability, hibernated pods, partial failures, and retry policy never enter the user-facing request path.
- **Easier:** Cross-replica coordination collapses into one well-known pattern (outbox + competing consumers + best-effort wake). There is no per-agent routing state for replicas to share, no WebSocket connection map to maintain, no failover concern when a replica restarts.
- **Easier:** Trigger delivery becomes durable end-to-end. The current `kubectl exec` model loses triggers on exec failure; signal-outbox rows survive replica crashes, agent disconnects, and Redis outages, bounded only by their TTL.
- **Harder:** The same outbox row may dispatch from any replica; the agent's `applyState` must reject older `version`s (the per-agent monotonic version mandated by ADR-048) or last-write-loses races silently corrupt state.
- **Harder:** Operational visibility is two-layer — outbox row counts and the worker's dispatch metrics — instead of one in-flight call you can `kubectl logs`-trace. The system gains audit clarity (every dispatched event has a durable row) but loses one-shot debuggability.
- **Harder:** The schedule firing path now belongs to the worker (or another worker), not the controller's cron. The reliability of "did this schedule fire?" depends on the worker being up, which depends on at least one api-server replica being up — a coverage profile equivalent to the existing controller but with a different failure mode (worker loop stuck vs. cron-tick missed).
- **Committed-to:** Postgres remains the truth substrate for runtime-channel delivery state; Redis is wake-only and may drop events without correctness impact. Any future delivery primitive (broker queue, mesh-native pub/sub, etc.) that replaces Redis must preserve the snapshot-redo-from-Postgres recovery path. The worker's `start()` / `stop()` lifecycle and feature-flag gating must stay clean enough to lift into a separate Deployment without code changes.
