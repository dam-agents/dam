# ADR-058: Unified runtime-channel apply path + Contributions-Settled gate

**Date:** 2026-06-03
**Status:** Accepted
**Owner:** @janjeliga

Amends ADR-032, ADR-045, ADR-052, ADR-053.

## Context

Readiness ("running") was gated only on the pod reporting Ready (ADR-032). But a Ready pod can still be missing the Contributions it declared, be a pod that is mid-roll, or — when the agent was created with a file import — be up before that import is in place. Nothing held "running" back until the declared state had actually landed, and a Contribution that failed to apply had no path to retry or surface — so an agent could read "running" while incomplete, and a failure could pass silently.

## Decision

An agent is **"running" once it has converged to its declared state on the live pod** — pod up, Contributions settled, any create-time import landed — not merely once the pod reports Ready. That gate applies only while the agent is **coming up** (at create, and on each wake from hibernation, which must pick up anything changed while it slept); once converged, it stays "running" through later changes, which apply in the background and surface only if they fail. Contributions are applied by a single background worker that runs every item to completion and reports failures, and readiness tracks whichever pod is actually live, so a pod roll from any cause is absorbed by retry, not anticipated.

The rules that follow:

- **Presence is not application.** A pod connecting registers its presence; it does not apply state. One background worker is the sole applier of Contributions, so writes to the pod have a single ordering.
- **Apply settles to completion.** Application runs every Contribution to termination and reports which ones failed. Readiness keys on whether the work *settled* (terminated at all), not on whether it succeeded; the retry keys on whether it applied *cleanly*. An agent can be settled-with-failures.
- **Readiness gates only while coming up.** The Contributions and create-time-import gates apply during a startup opening — a create, or a wake from hibernation. Once the agent has converged, later incremental applies and imports run in the background and never regress it to "starting."
- **Running does not assert success.** An agent whose work settled with failures is "running" but degraded — surfaced by a badge, not blocked.
- **A rolling pod is not ready.** A pod that is terminating does not count toward readiness, so a roll from any cause surfaces as "starting" rather than a false "running" against a pod about to vanish.
- **Failures surface; in-progress work is silent.** Outstanding or failed work retries in the background to a bound; a failure (Contribution or import) shows as a degraded badge that persists until a later attempt clears it, while in-progress and clean work stay silent — and nothing ever wedges.
- **Status reads are fail-soft.** A transient failure of the store that records settle/fail state must not fail a pod-backed read or block a wake; unknown defaults to "settled."
- **A file import is roll-robust by reaction.** A create-time import gates "running" until it lands. Robustness comes from re-importing against whichever pod is live with an idempotent finalize — not from anticipating a roll. A failed import surfaces as a degraded badge and never wedges or silently completes.
- **A failed create becomes an explicit Error.** If creation fails after the agent's backing resource exists, the agent goes to an explicit Error state with no pod running, recoverable by delete + recreate.

## Alternatives Considered

- **`hello` carries state / multiple appliers** — races connect-time application against the worker; a single applier gives one write ordering.
- **Abort application on the first failure** — one broken Contribution would block every other and stall readiness indefinitely.
- **Gate readiness on successful application** — a single unrecoverable item would wedge the agent forever; running-but-degraded is the honest surface.
- **Anticipate the env-roll by stamping the desired revision on the pod and gating on a match** — handles only the environment-change cause, not eviction, drain, or restart; reacting via retry covers every cause.
- **Detect a roll in progress from StatefulSet revision or node conditions** — deferred: widens the api-server's cluster-read surface and duplicates the controller's roll logic; reacting to a terminating pod covers the dominant case, leaving only a sub-second pre-termination window.
- **Buffer the import on the api-server and retry server-side** — the control plane is a single replica with no scratch capacity for large bundles; the client already holds the bytes and re-submits.

## Consequences

- **Easier:** a pod roll from any cause — environment change, eviction, node drain, manual restart — is absorbed by retry against the new pod, and readiness no longer shows "running" against a pod that is leaving; the import finalize is idempotent, so a half-delivered import is overwritten cleanly on the next attempt.
- **Easier:** a failing Contribution or import can't wedge the agent or pass unseen — it runs degraded behind a visible badge while every other Contribution still installs.
- **Easier:** reconfiguring a running agent — a new Contribution, a files import — no longer flips it to "starting"; it stays running while the change applies in the background, so the lifecycle pill means "coming up / healthy," not "busy reconciling."
- **Harder:** "running" now depends on the settle/fail store being readable; that path is made fail-soft (defaults to settled), so a store outage degrades to "assume ready" and can briefly mis-report a genuinely unsettled agent as ready.
- **Harder:** the client (UI/CLI) must hold the import bytes and re-submit on a transient failure; a control-plane restart mid-import loses the in-flight attempt — resolved as a failure badge, with the user re-importing.
- **Committed-to:** the api-server owns readiness — computed from the observed pod plus the settle/fail store, not read from the pod's self-report — and the convergence gate is scoped to the agent coming up; drop that scoping and every incremental change would regress a running agent to "starting."
- **Committed-to:** a failure of either kind is recorded as durable agent status that persists until resolved, not a transient notification a user can miss.

## Amends

- **ADR-032** — readiness widens from "pod Ready" to "converged, while coming up"; pod-reachability survives as the composable base.
- **ADR-045** — a create-time import gates the agent's "running" state; an import into an already-running agent applies in the background without gating.
- **ADR-052** — the "interchangeable delivery routes" framing no longer holds; a pod's connect is presence-only.
- **ADR-053** — state is applied only from the worker, not at connect time.
