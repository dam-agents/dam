---
id: 102
title: Agent reconciles run on eight owner-sharded workers
status: accepted
subsystem: budgets
tags: [controller, vm-runner, budgets]
summary: The controller reconciles agents on a fixed eight workers, each with its own queue, and an agent's owner picks its worker, so one owner's agents still reconcile one at a time while a hung VM runner delays only the owners on its worker.
---

# ADR-102: Agent reconciles run on eight owner-sharded workers

**Date:** 2026-10-14 **Status:** Accepted **Owner:** @JanPokorny

## Context

The controller reconciled every agent of the install on one worker, which is what kept the budget's read-decide-scale for two agents of one owner from interleaving.
A vm agent's reconcile calls its owner's VM runner under the owner's lock with a 20 s timeout, and the health poll brings every vm agent back each minute.
A runner that hangs but keeps its listener therefore costs 20 s per agent of its owner per minute, and every other user's wake queues behind it; at about 120 vm agents the health poll alone saturates the one worker with no fault at all.
Ordering the queue, which put wakes ahead of background work, cannot help a wake that waits behind a reconcile already running.

## Decision

Agent reconciles run on a fixed eight workers, each draining its own queue with its own urgent and background lanes, and a hash of the agent's owner label picks the worker.
Every agent of one owner is reconciled by one worker, one at a time, so the budget invariant keeps the same structural guarantee it had, scoped to the owner instead of the install.

- The worker count is a constant, not a setting.
- A name the agent cache does not hold is not queued, so one agent never lands on two workers.
- An Agent's owner label is never changed after create; the routing relies on it.
  Nothing in the schema enforces this: the api-server never rewrites the label, and a hand relabel is unsupported, since it can put one agent on two workers for a short time.
- State the workers share across owners is decided under one install-wide lock where it was decided before: the runner roll's places and the runtime migration copy slots.
  The Kubernetes client rate limiter stays shared by all workers.
- There is no circuit breaker for a hung runner: its owner's agents still wait out the runner client's timeout.

## Alternatives Considered

- **Keep one worker and shorten the runner timeout** — a put that probes the guest or a delete that waits out an operation takes seconds legitimately; the fault still costs every user.
- **A worker per owner** — goroutines and queues grow with the user count for owners that are almost all idle; eight already make a shared worker unlikely.
- **A configurable worker count** — no install has a reason to tune it, and each value is another configuration to test.
- **A schema rule that makes the owner label immutable** — a CRD schema change breaks the shared dev cluster, and the CRDs are being removed.
- **A circuit breaker on a runner that keeps timing out** — a second state machine on the reconcile path, while sharding already confines the cost to the faulty owner's worker.

## Consequences

- **Easier:** A wake for an owner on another worker starts while a runner hangs; the controller test holds a hung runner's reconcile open and requires another owner's wake to start within a second, which fails with one worker.
  Eight reconciles run at once, so the health poll at 120 vm agents spreads over eight workers instead of saturating one.
- **Harder:** An owner whose hash shares a worker with a hung runner's owner (one in eight on average) still waits behind that reconcile.
  Shared reconciler state is now touched concurrently on every reconcile, not only by the background passes, so every new field shared across owners needs a lock or a concurrent map.
  The runner roll's lock is held across runner calls while it decides a roll, so during a release that rolls runners a hung runner can still hold every worker that reaches the roll; narrowing that lock is follow-up #4939.
  The workers draw on one 200 QPS client limiter: eight reconciles of about thirty calls each fit its burst of 400, but sustained fleet-wide work still queues for the same tokens.
- **Committed-to:** The owner label as the routing key, immutable after create; the per-owner mutex as the backup to the per-worker serialization; the queue metrics carry one name per worker.
