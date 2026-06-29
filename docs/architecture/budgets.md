# Per-user resource budgets

Last verified: 2026-06-29

## Overview

A **budget** is a ceiling on the CPU and memory a single user's *running* agents may reserve at once. The cluster has a fixed compute pool and all agents share one namespace, so without a ceiling the first users to spin up agents can starve everyone else. The budget makes each user's concurrent share explicit: within it a user is free to deploy whatever they want for as long as they want; they just cannot exceed their share concurrently.

Enforcement lives entirely in the **api-server**, which is the sole writer of the Agent spec and the only actor that initiates a wake. The controller and Kubernetes are unaware of budgets — there is no `ResourceQuota` (it is namespace-scoped, and all agents share one namespace) and no metrics-server, so a Kubernetes-native per-user ceiling is not available. The api-server is also the only place that already knows which agents an owner has.

## What is counted

The budget sums pod resource **requests**, not limits and not live usage:

- Limits are burst ceilings and are not even set on every pod (the paired gateway has requests but no limits), and there is no metrics API to read live consumption from. Requests are the scheduler's actual reservation and the only value knowable before a pod is scheduled — which an admission check requires.
- A running agent's footprint is its agent-container requests plus a fixed constant for its paired gateway pod. When an agent's spec omits `resources`, the api-server falls back to the chart's default agent requests, surfaced to it as `AGENT_DEFAULT_CPU_REQUEST` / `AGENT_DEFAULT_MEMORY_REQUEST` and templated from the same Helm value the controller uses, so the two cannot drift.
- Only non-hibernated agents count. Consumption is computed on demand from the live agent list, never persisted — so a hibernate or delete credits the budget back automatically with nothing to reconcile.

Because the cap bounds reservation rather than live use, a user can sit under budget while individual agents burst toward their limits. The visibility surface therefore labels the figure **reserved**, not used. Per-turn fork Jobs are excluded from v1 and are a known undercount.

## The ceiling

Each install has a chart-wide default ceiling (`DEFAULT_USER_CPU_BUDGET` / `DEFAULT_USER_MEMORY_BUDGET`). A `user_budgets` row, keyed on the same plaintext owner identity the `agent-platform.ai/owner` label carries, overrides the default for one user; it is operator-managed (there is no self-service path). Role-based budgets and "request more" approval flows are out of scope.

## Enforcement

The api-server gates every path that brings an agent online against the owner's remaining budget, rejecting before any spec write:

- **Create** — checked against the new agent's requested footprint.
- **Wake / connect** — when waking a hibernated agent (UI wake, or a UI/channel session attaching), checked against that agent's footprint. Waking an already-running agent is a no-op for the budget.
- **Scheduled fire** — the scheduler pokes the agent awake through the same gate. A fire that would exceed budget is **blocked and deferred**: the trigger event is already durably committed to the outbox, so nothing is lost — it redelivers once the user frees room, or expires at its TTL. The fire is recorded as failed.

A rejection surfaces a clear over-budget error naming the reserved and limit figures and pointing the user to stop a running agent.

The check is read-decide-write without a cross-replica lock, so two concurrent waking actions by the same user can transiently overshoot; hibernation reclaims the excess. A per-owner advisory lock is the upgrade path if strict correctness across api-server replicas becomes necessary.

## Visibility and freeing room

Any authenticated user can read their own reserved-vs-limit figure (a `budgets.usage` query, rendered as a meter on the sandbox list). To free capacity a user issues a hard stop on a running agent; see [agent-lifecycle](agent-lifecycle.md#hibernate) for the stop mechanics and how hibernation is reframed as a convenience for staying under the ceiling rather than the enforcement mechanism itself.
