---
id: 083
title: Eventing layers by guarantee — in-process sagas, Redis signals, BullMQ work
status: accepted
subsystem: platform-topology
tags: [events, sagas, redis, bullmq, live-updates]
summary: Domain events stay in-process and non-durable, consumed by sagas that forward cross-replica signals to Redis pub/sub or enqueue durable work as BullMQ jobs; no single distributed bus.
---

# ADR-083: Eventing layers by guarantee — in-process sagas, Redis signals, BullMQ work

**Date:** 2026-08-13
**Status:** Accepted
**Owner:** @jezekra1

## Context

The live-UI-updates work (#3170) made invalidation hints the third tenant of
cross-replica messaging and forced a standing question: should the server's
three mechanisms — the in-process domain-event bus, Redis pub/sub, and BullMQ —
consolidate onto one distributed bus? Consolidation onto BullMQ (custom-event
broadcast plus jobs), raw Redis Streams, Postgres NOTIFY, and a default
transactional outbox were each evaluated (issue #3288). Three facts decided it:
saga consumers depend on exactly-once-per-emission, co-located delivery (the
audit saga writes log lines that no unique key can deduplicate; one event fires
on every authenticated request); no transport makes publishing atomic with the
Postgres commit, so a durable bus still loses the crash window it was bought to
close; and the platform already bounds that window with reconciles, not
delivery guarantees.

## Decision

Eventing is layered by delivery guarantee, one primitive per guarantee, and
events are **non-critical by contract**: nothing may depend on an event
arriving.

- **Domain events are in-process, synchronous, at-most-once, and non-durable.**
  Services emit them after the write commits; the only consumers are sagas
  running in the emitting process.
- **A saga that must reach other replicas forwards a signal to Redis pub/sub,
  never the event itself.** Signals are thin (an id, a topic) and consumers
  re-read truth from the store — today: per-owner UI hints, approval wakes,
  session inject frames. Anything crossing the process boundary is
  schema-parsed on receipt and dropped on mismatch.
- **Durable, once-across-the-fleet work is a BullMQ job**, enqueued directly by
  the code that needs it (periodic reconciles, schedule fires, the runtime
  outbox) — jobs carry work, not events.
- **Loss is bounded by reconciliation, not by delivery guarantees.** Every
  domain whose events matter has a converging fallback (reconnect-`sync` for
  hints, hold timeouts for approvals, periodic sweeps elsewhere). An event type
  whose loss no reconcile can bound earns a transactional outbox for exactly
  that consumer — none exists today.

## Alternatives Considered

- **One distributed bus on BullMQ** (custom-event broadcast + jobs) —
  re-platforms every emitter and saga onto serialized, at-least-once delivery;
  log-line consumers cannot deduplicate, and per-request events would hit Redis
  on every API call.
- **Raw Redis Streams with consumer groups** — the hybrid semantics fit, but
  hand-rolls pending-entry recovery and lag management that BullMQ already
  wraps.
- **Postgres LISTEN/NOTIFY as the bus** — the only option with commit-atomic
  publish, but it moves the signal path onto database connections while keeping
  the same at-most-once loss profile.
- **Transactional outbox by default** — pays a table, a relay, and consumer
  idempotency on every event type when only loss-sensitive ones would ever need
  it; kept as the per-type escalation path instead.

## Consequences

- **Easier:** write sites emit exactly one thing, and a new UI topic is a
  schema variant plus a projection row — the whole live-updates feature landed
  without touching transport or saga plumbing. Saga handlers remain plain
  in-memory calls: no serialization, no versioning across rolling deploys, no
  redelivery handling.
- **Harder:** a future consumer that genuinely needs durable or cross-replica
  event consumption has no rail — it must bring its own outbox and idempotency,
  or a reconcile that bounds its loss. Cross-replica consumers receive signals
  only, so each owns a re-read of truth on wake.
- **Committed-to:** events stay advisory everywhere — any feature that would
  break when one is lost must ship its bounding reconcile in the same change,
  and domain events never cross a process boundary unparsed.
