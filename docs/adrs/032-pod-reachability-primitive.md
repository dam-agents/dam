# ADR-032: Centralized pod-reachability primitive; observed pod Ready is the truth

**Date:** 2026-04-24
**Status:** Proposed
**Owner:** @janjeliga

## Context

Three code paths currently wake and wait for an agent pod before calling into it: the scheduler's `fire()` (Go), the ACP relay's WS upgrade handler (TypeScript), and `ensureRunning` in `acp-client.ts` used by channel adapters (TypeScript). They are near-duplicates with subtly different semantics. The scheduler gates its readiness wait on `if woke` — meaning it skips the wait whenever `desiredState` is already `"running"` — which treats *user intent* as proof of *pod reachability*. They are not the same: a pod can be absent, cycling, or still coming up from a wake initiated by another caller while `desiredState == "running"`.

This mismatch is the root cause of the intermittent `pods "X-0" not found` failures on scheduled triggers. Related races affect the UI wake path (fire-and-forget, no readiness wait) and the idle-checker interaction with continuous-mode schedules, where `platform.ai/last-activity` is never bumped by trigger-initiated sessions and the pod gets hibernated mid-chain.

Adding tactical patches at each site would fix the immediate symptoms but preserves three near-duplicate implementations that will drift again.

## Decision

Every caller that sends work to an agent pod routes through a single primitive, `ensureReady(instanceId)`, whose contract is:

- Observed pod `Ready` condition is the authoritative answer to "can I call this pod?" — not `desiredState`.
- Idempotent and single-flight per `instanceId`; concurrent callers share one wait.
- Bumps `platform.ai/last-activity` on every successful call, so any caller implicitly keeps the pod warm and closes the continuous-schedule re-hibernation race without special-casing trigger sessions.
- `desiredState` remains **user intent** (running vs. hibernated) and continues to drive the reconciler. It is no longer read as a reachability signal by callers.

The primitive is implemented once per runtime — Go (`packages/controller/pkg/lifecycle/`) and TypeScript (`InstancesRepository.ensureReady`) — with parallel test suites. `wakeIfHibernated`, `waitForPodReady`, and `pollUntilReady` become private implementation details of the primitive in each language. The three existing wake-and-wait sites are replaced; `ensureRunning` is deleted.

No UI changes, no new ConfigMap keys, no new annotations, no new lifecycle states.

## Alternatives Considered

**Surgical patches at each site.** Drop the `if woke` guard in the scheduler; add `last-activity` bumps where they are missing; keep three parallel implementations. Rejected: fixes the known races but preserves the drift risk. The three implementations already have diverged semantics once (`ensureRunning` polls reconciler-maintained state, the relay polls pod Ready directly); they will diverge again.

**Explicit lifecycle state machine with a `Waking` phase.** Add `status.phase ∈ {Running, Waking, Hibernating, Hibernated, Error}` maintained by the reconciler from observed pod state; callers gate on phase. Rejected for this iteration: larger surface area, controller reconcile loop changes, would surface in the UI and require product decisions about how to present `Waking`. Valuable later for UI polish, but not needed to make the system robust. Can be layered on top of the primitive without changing caller contracts.

**Removing hibernation entirely.** Run pods continuously, rely on K8s autoscaling. Rejected: hibernation is load-bearing for the platform's resource model (ADR-012 runtime lifetime). This ADR is about making hibernation/wake correct, not removing it.

## Consequences

- Single enforcement point for pod reachability. New callers that send work to pods cannot bypass the guard without importing private helpers.
- Removes three races (scheduler skip-wait, UI wake fire-and-forget, continuous-schedule re-hibernation) with one architectural change.
- Adds one K8s `getPod` call on every hot-path entry — millisecond cost, acceptable given the calls are bursty, not sustained.
- Adds `golang.org/x/sync/singleflight` as a Go module dependency (small, stable).
- The primitive's 2-minute timeout becomes the external-facing deadline for reconciler responsiveness. If the reconciler is slow, `ensureReady` timeouts surface as loud errors in schedule status, WS close codes, and channel logs — correct failure surfacing for that class of problem.
- `ensureRunning` in `acp-client.ts` is deleted; channel adapters import from the repository instead. This also removes a reconciler-round-trip in channel paths (`ensureRunning` polled observed state; `ensureReady` polls pod state directly).
- No migration, no schema change, no UI change. The behavior ships with a normal controller + api-server upgrade.
