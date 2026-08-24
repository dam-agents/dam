# Per-user resource budgets

Last verified: 2026-08-21

## Overview

A **Budget** is a per-user ceiling on the CPU and memory that user's *running* agents can use concurrently. The cluster has a fixed compute pool and all agents share one namespace, so without a ceiling the first users to spin up agents can starve everyone else. Within their Ceiling a user is free: deploy whatever they want, for as long as they want — the Budget constrains **starting** an agent, never running one, with one exception: a blocked start may **reclaim** room by hibernating that same owner's unattended idle agents early (see [Reclaiming room](#reclaiming-room-for-a-blocked-start)). Admission pressure from one owner is the only thing that ever takes a running agent down for budget reasons — nothing is evicted because a ceiling changed, and no owner's demand touches another owner's agents.

Enforcement lives in the **controller, at the 0→1 scale transition**. The reconciler is the single actuator that brings an agent's pod pair up, so every wake path — UI, ACP/terminal/SSH relays, channels, the scheduler, or a bare annotation stamp — converges on one check that no api-server code path can bypass. The api-server's role is legibility: it translates the controller's refusal into a typed, immediate error and serves the visibility surface. (Kubernetes offers no native per-user primitive here: `ResourceQuota` is namespace-scoped and all agents share one namespace.)

## What is counted

**Reserved** — the consumption side of a Budget — is the sum of **Sizes** (`spec.resources.limits`) across the owner's scaled-up agents:

- **Limits, because the Budget bounds what agents can actually use.** An agent's Size — its CPU/memory limits — is the one resource concept users see: the template's default at create, the slider in the agent's settings, else the small chart default (1 CPU / 1Gi). Limits hard-cap consumption (memory OOM-caps, CPU throttles), so Σ Sizes ≤ Ceiling is a deterministic guarantee: a user's agents can never consume past their Ceiling, even all bursting at once. The requests/limits split is deliberately *not* a user concept.
- **Requests are derived scheduling internals.** The controller computes them at render: `max(limit × fraction, floor)` per dimension (`controller.requestsFromLimits`, default fraction 0.5, floors 100m/128Mi, clamped to the limit). The cluster packs on `Σ Sizes × fraction` — a fixed, operator-chosen overcommit ratio. A template that sets `requests` explicitly bypasses derivation (operator escape hatch).
- **Straight off the spec.** The api-server stamps a concrete Size onto every Agent CR at create (an explicitly requested size wins, else template, else default) — user intent stays api-server-written. The controller **materializes** the chart's `legacyAgentSize` — the limits pre-Sizes agents actually ran with (default 1 CPU / 2Gi), so convergence records reality rather than silently shrinking a workload — into any spec missing a dimension: fill-if-absent on reconcile, never touching a set value (the same license the K8s scheduler takes with `spec.nodeName`). The watch-driven fill is what makes limits effectively *required* without schema-level enforcement: every Agent converges to a concrete Size within one reconcile of existing, however it was created (api-server, kubectl, GitOps), and the filling reconcile itself already renders and budgets with the filled values. An unfilled spec (a peer awaiting its own reconcile) counts at `legacyAgentSize` — fallback, never zero.
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

A denial is **remembered per wake attempt** (keyed by the `last-activity` value it was denied under, in leader memory): a parked agent does **not** start by itself when room frees — a spontaneous start would surprise the user and grab the freed room out from under whoever freed it. Only a *new deliberate start* (a fresh activity bump: the Start button, opening the sandbox, a schedule fire) retries the gate. Two kinds of agent are exempt from the memo and auto-start within ~30s of room freeing (a dedicated retry tick re-enqueues parked exempt agents on that cadence): a **never-hibernate** agent (effective timeout `0`, which declares "always run"), and a **sweepable** agent — an ephemeral Invocation target, whose driver is blocked polling for its result: the freed room belongs to the same owner and starting is exactly what that owner is waiting for, so an over-budget spawn simply queues until room frees (e.g. earlier invocations completing), bounded by the Invocation's own liveness deadline. That queue only helps a spawn that *can* fit: a target whose Size alone exceeds the Ceiling would park until its deadline reaped it hours later, so the spawn route rejects it synchronously with both figures — the one admission the api-server refuses up front, because no amount of freed room ever admits it. If a parked agent's activity window lapses, the idle checker's sweep restamps plain `Hibernated` and it becomes an ordinary sleeping agent. Already-running agents are never re-checked by resyncs or ceiling changes: budget-check reads happen only on a real 0→1 or on a **grown Size** (the live-resize gate below). (A controller restart forgets denials and re-evaluates once — an accepted, rare exception.)

Creates are never rejected. An over-budget create simply lands parked, and the UI's job is to make "free some room" obvious. This also means the whole enforcement path is invisible on the happy path: under-ceiling users never touch it.

**Resizing** changes an Agent's Size in the agent settings and always restarts the pod (the CR patch re-renders the pair — a "live" resize does not exist in Kubernetes terms). A sleeping Agent's new Size simply rides its next start through the 0→1 gate. An **up** Agent's resize rolls at replicas = 1 and never crosses that gate, so the controller gates it at render instead: when the new limits **grew** past the Ceiling, the pair parks — scaled to zero *before* the new template applies (a pod at the denied size never launches), `OverBudget` with the figures — the same "doesn't fit ⇒ park" semantics as an over-budget start. The check is grow-only (a shrink always renders: even for an over-ceiling owner it only helps) and diff-keyed against the live StatefulSet template, which is what keeps "never re-checked" true for resyncs and ceiling changes. The api-server *additionally* rejects an over-ceiling grow synchronously (`FORBIDDEN` with the figures; read+check+patch serialized per owner via a Postgres advisory lock, so the courtesy holds across api-server replicas) so the settings dialog fails at save time instead of parking a moment later — a UX courtesy in front of the controller's gate, not the enforcement. Out-of-band spec writes (kubectl, GitOps) bypass only the courtesy, never the gate.

**Self-healing races.** The api-server's courtesy check and the controller's gates read overlapping state without a shared lock, so a resize racing a wake *by the same owner* can transiently slip past the courtesy check. Nothing accumulates: every slip lands as a spec change the controller re-gates — an ungated grow of an up Agent parks within one reconcile, and a hibernated Agent resized mid-admit starts at the old Size, then its roll to the grown Size hits the same gate. The residual acceptance is UX, not overshoot: a live grow denied at the controller briefly *interrupts* the Agent (it parks; shrink it back or free room and start it) instead of erroring at save time.

## Reclaiming room for a blocked start

Before a refusal is published, the gate tries to make the room itself: it hibernates the owner's own **unattended idle** agents ahead of their idle timeout, longest-idle first, then re-runs the same arithmetic. The blocked start is usually blocked by room its owner has already finished with, sitting behind a timeout that hasn't lapsed — an hour on the chart default — and the alternative is asking the user to go stop something they thought they were done with. Every start path gets this, including schedule fires and channel-driven wakes, which is where a manual "free some room" resolution is worst: nobody is present to perform it.

The verdict stays **synchronous**. Reserved counts *desired* replicas, so scaling a victim's pair to zero frees budget the instant the write lands and the same reconcile admits — there is no reclaim-in-progress state, and the fail-fast above needs no third outcome to distinguish. Pods draining afterwards are the scheduler's business, which Budgets have never modelled.

Four rules bound it:

- **Unattended only.** A session pin (`active-session`), an Experiment pin, or a sweepable Invocation target (whose driver is blocked on its result) is never a candidate, and neither is a **never-hibernate** agent — effective timeout `0` declares "always run", not a default to be overridden. The pins carry this weight because the runtime's own idle flag reads an attached-but-turnless chat as idle: probe alone would reclaim a pod somebody is watching. Candidates are then probed exactly as an ordinary hibernation probes, so declared in-flight work is spared.
- **An idle floor** (3 minutes) beneath which nothing is reclaimed. Besides sparing an agent its user may be moments from returning to, the floor is what makes reclaim **non-recursive**: an agent admitted this way carries fresh activity and so cannot be the next start's victim, which is what stops A-evicting-B-evicting-A from cycling.
- **Provably sufficient, or nothing.** The candidates' summed Sizes must cover the shortfall in both dimensions before any of them is touched, so no agent is ever hibernated for a start that was going to be refused regardless.
- **A reclaimed agent stays down.** Its activity stamp is still inside its own timeout — that is the premise of reclaiming it early — so it is marked as having *spent* that stamp and only a **newer** activity bump revives it, back through the gate like any other start. Without that, the victim's own next reconcile would take the room straight back. The mark is self-clearing: a deliberate touch outdates it.

Reclaiming is **silent**. The eligibility rules confine it to agents with no attached viewer, the victim lands in ordinary `Hibernated` state indistinguishable from a lapsed timeout, and the outcome — hibernated somewhat sooner than its own timer said — is one the agent's settings already sanction. The exposure this adds is hibernation's existing blind spot (unreported work, which no signal sees) arriving earlier than advertised; the floor bounds it and the escape is unchanged: disable hibernation on agents whose real work runs off-session.

## Failure semantics upstream

The api-server classifies the `OverBudget` condition reason into a typed wake-failure (non-transient, fail-fast — a denied wake errors in about a reconcile round-trip, not a wake-timeout), so the UI, relays, channels, and scheduler all inherit the same message: the figures plus "stop a running agent to free room." A scheduled fire on an over-budget agent records a failed fire; the trigger event is already durably committed to the outbox, so it redelivers once room frees or expires at its TTL.

The fail-fast is a **heuristic**, not a raw condition read: a parked agent keeps its `OverBudget` condition standing, and the condition doesn't say which wake attempt it applies to — so a fresh wake's first poll would otherwise see the *previous* attempt's denial and fail a start that room now permits. The wake therefore treats `OverBudget` as its own denial only when it *observed the condition appear* during its own poll (the controller ruled on this attempt), or once a short grace window (~10s, comfortably above the informer-driven reconcile latency) passes with the refusal still standing. A stale denial inside the grace rides through to the reconcile of the wake's activity bump, which admits or re-denies well within the window. Deliberately local to the api-server: the alternative — echoing the denied activity value through the Agent status — buys exactness at the price of a CRD schema field and a cross-component contract, which this failure mode doesn't warrant.

## Freeing room

Users free capacity by stopping a running agent (see [agent-lifecycle](agent-lifecycle.md) for the hard-stop mechanics) or letting it hibernate — and, for a start they are blocked on, the gate frees it for them where it can ([above](#reclaiming-room-for-a-blocked-start)). Reserved is computed from live state and never persisted, so a hibernate, stop, or delete credits the budget back with nothing to reconcile.
