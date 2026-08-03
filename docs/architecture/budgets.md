# Per-user resource budgets

Last verified: 2026-07-30

## Overview

A **Budget** is a per-user ceiling on the CPU and memory that user's *running* agents can use concurrently. The cluster has a fixed compute pool and all agents share one namespace, so without a ceiling the first users to spin up agents can starve everyone else. Within their Ceiling a user is free: deploy whatever they want, for as long as they want — the Budget constrains **starting** an agent, never running one. Nothing is ever evicted because a ceiling changed.

Enforcement lives in the **controller, at the 0→1 scale transition**. The reconciler is the single actuator that brings an agent's pod pair up, so every wake path — UI, ACP/terminal/SSH relays, channels, the scheduler, or a bare annotation stamp — converges on one check that no api-server code path can bypass. The api-server's role is legibility: it translates the controller's refusal into a typed, immediate error and serves the visibility surface. (Kubernetes offers no native per-user primitive here: `ResourceQuota` is namespace-scoped and all agents share one namespace.)

## What is counted

**Reserved** — the consumption side of a Budget — is the sum of **Sizes** (`spec.resources.limits`) across the owner's scaled-up agents:

- **Limits, because the Budget bounds what agents can actually use.** An agent's Size — its CPU/memory limits — is the one resource concept users see: the slider at create, the template's default, else the small chart default (1 CPU / 1Gi). Limits hard-cap consumption (memory OOM-caps, CPU throttles), so Σ Sizes ≤ Ceiling is a deterministic guarantee: a user's agents can never consume past their Ceiling, even all bursting at once. The requests/limits split is deliberately *not* a user concept.
- **Requests are derived scheduling internals.** The controller computes them at render: `max(limit × fraction, floor)` per dimension (`controller.requestsFromLimits`, default fraction 0.5, floors 100m/128Mi, clamped to the limit). The cluster packs on `Σ Sizes × fraction` — a fixed, operator-chosen overcommit ratio. A template that sets `requests` explicitly bypasses derivation (operator escape hatch).
- **Straight off the spec.** The api-server stamps a concrete Size onto every Agent CR at create (slider wins, else template, else default) — user intent stays api-server-written. The controller **materializes** the chart's `legacyAgentSize` — the limits pre-Sizes agents actually ran with (default 1 CPU / 2Gi), so convergence records reality rather than silently shrinking a workload — into any spec missing a dimension: fill-if-absent on reconcile, never touching a set value (the same license the K8s scheduler takes with `spec.nodeName`). The watch-driven fill is what makes limits effectively *required* without schema-level enforcement: every Agent converges to a concrete Size within one reconcile of existing, however it was created (api-server, kubectl, GitOps), and the filling reconcile itself already renders and budgets with the filled values. An unfilled spec (a peer awaiting its own reconcile) counts at `legacyAgentSize` — fallback, never zero.
- **Scaled-up means desired replicas ≥ 1** on the agent StatefulSet — an agent still starting already counts, so two near-simultaneous wakes cannot both slip under the ceiling.
- **Deliberate exclusions:** the paired gateway pod (uniform per-agent platform overhead — operators price it into default ceilings) and per-command Run pods (a known undercount, unchanged from the original design).

## The Ceiling

Chart-wide defaults live in `controller.userBudgets` (`defaultCpu`, `defaultMemory`). A **UserBudget** CR overrides them for one user:

```yaml
apiVersion: agent-platform.ai/v1
kind: UserBudget
metadata:
  name: budget-<keycloak-sub>   # pinned to spec.owner at admission (CEL)
  namespace: <agents-namespace>   # the chart's agent namespace (default platform-agents)
spec:
  owner: "<keycloak-sub>"        # exact plaintext sub, as on the agent owner label
  cpu: "8"
  memory: "16Gi"
```

The name↔owner pin makes one-budget-per-user structural (a second budget is a name collision), and the schema validates quantities at admission, so a malformed ceiling is rejected rather than silently parsed to zero. UserBudgets are operator-managed (`kubectl`/GitOps); there is no self-service path. Role-based budgets and approval flows are out of scope — when they arrive, richer policy in the api-server will *materialize* its results as UserBudget CRs, and the controller's contract stays a dumb numeric invariant.

## Enforcement

On each reconcile that wants to scale an agent up (`shouldRun` true) where the pair is currently at zero, the controller sums the owner's Reserved, adds the candidate's footprint, and compares against the Ceiling (UserBudget, else default, both read live; no informer lag on the enforcement path). The read-decide-scale sequence cannot interleave for two same-owner agents because agent reconciles are drained by a **single worker goroutine** on the leader-elected instance — an invariant pinned in code at the worker spawn and in the check itself; a per-owner mutex backs it up. Outcomes:

- **Fits** — the pair scales up exactly as before.
- **Overflows** — the pair is scaled to zero (healing a gateway a prior admitted-then-failed reconcile may have left up) and the Agent is **parked**: `Ready=False, reason=OverBudget`, with the reserved/ceiling figures in the condition message. `Reconciled` stays true — the render succeeded; the start was refused.

A denial is **remembered per wake attempt** (keyed by the `last-activity` value it was denied under, in leader memory): a parked agent does **not** start by itself when room frees — a spontaneous start would surprise the user and grab the freed room out from under whoever freed it. Only a *new deliberate start* (a fresh activity bump: the Start button, opening the sandbox, a schedule fire) retries the gate. Two kinds of agent are exempt from the memo and auto-start within ~30s of room freeing (the informer's resync guarantees the pass): a **never-hibernate** agent (effective timeout `0`, which declares "always run"), and a **sweepable** agent — an ephemeral Invocation target, whose driver is blocked polling for its result: the freed room belongs to the same owner and starting is exactly what that owner is waiting for, so an over-budget spawn simply queues until room frees (e.g. earlier invocations completing), bounded by the Invocation's own liveness deadline. If a parked agent's activity window lapses, the idle checker's sweep restamps plain `Hibernated` and it becomes an ordinary sleeping agent. Already-running agents are never re-checked by resyncs or ceiling changes: budget-check reads happen only on a real 0→1 or on a **grown Size** (the live-resize gate below). (A controller restart forgets denials and re-evaluates once — an accepted, rare exception.)

Creates are never rejected. An over-budget create simply lands parked, and the UI's job is to make "free some room" obvious. This also means the whole enforcement path is invisible on the happy path: under-ceiling users never touch it.

**Resizing** changes an Agent's Size in the sandbox settings and always restarts the pod (the CR patch re-renders the pair — a "live" resize does not exist in Kubernetes terms). A sleeping Agent's new Size simply rides its next start through the 0→1 gate. An **up** Agent's resize rolls at replicas = 1 and never crosses that gate, so the controller gates it at render instead: when the new limits **grew** past the Ceiling, the pair parks — scaled to zero *before* the new template applies (a pod at the denied size never launches), `OverBudget` with the figures — the same "doesn't fit ⇒ park" semantics as an over-budget start. The check is grow-only (a shrink always renders: even for an over-ceiling owner it only helps) and diff-keyed against the live StatefulSet template, which is what keeps "never re-checked" true for resyncs and ceiling changes. The api-server *additionally* rejects an over-ceiling grow synchronously (`FORBIDDEN` with the figures; read+check+patch serialized per owner) so the settings dialog fails at save time instead of parking a moment later — a UX courtesy in front of the controller's gate, not the enforcement. Out-of-band spec writes (kubectl, GitOps) bypass only the courtesy, never the gate.

**Self-healing races.** The api-server's courtesy check and the controller's gates read overlapping state without a shared lock, so a resize racing a wake *by the same owner* can transiently slip past the courtesy check. Nothing accumulates: every slip lands as a spec change the controller re-gates — an ungated grow of an up Agent parks within one reconcile, and a hibernated Agent resized mid-admit starts at the old Size, then its roll to the grown Size hits the same gate. The residual acceptance is UX, not overshoot: a live grow denied at the controller briefly *interrupts* the Agent (it parks; shrink it back or free room and start it) instead of erroring at save time.

## Failure semantics upstream

The api-server classifies the `OverBudget` condition reason into a typed wake-failure (non-transient, fail-fast — a denied wake errors in about a reconcile round-trip, not a wake-timeout), so the UI, relays, channels, and scheduler all inherit the same message: the figures plus "stop a running sandbox to free room." A scheduled fire on an over-budget agent records a failed fire; the trigger event is already durably committed to the outbox, so it redelivers once room frees or expires at its TTL.

The fail-fast is a **heuristic**, not a raw condition read: a parked agent keeps its `OverBudget` condition standing, and the condition doesn't say which wake attempt it applies to — so a fresh wake's first poll would otherwise see the *previous* attempt's denial and fail a start that room now permits. The wake therefore treats `OverBudget` as its own denial only when it *observed the condition appear* during its own poll (the controller ruled on this attempt), or once a short grace window (~10s, comfortably above the informer-driven reconcile latency) passes with the refusal still standing. A stale denial inside the grace rides through to the reconcile of the wake's activity bump, which admits or re-denies well within the window. Deliberately local to the api-server: the alternative — echoing the denied activity value through the Agent status — buys exactness at the price of a CRD schema field and a cross-component contract, which this failure mode doesn't warrant.

## Freeing room

Users free capacity by stopping a running agent (see [agent-lifecycle](agent-lifecycle.md) for the hard-stop mechanics) or letting it hibernate. Reserved is computed from live state and never persisted, so a hibernate, stop, or delete credits the budget back with nothing to reconcile.
