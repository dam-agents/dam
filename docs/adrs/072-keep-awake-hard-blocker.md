# ADR-072: Keep agents awake with an explicit hard blocker, not work-detection

**Date:** 2026-06-24
**Status:** Accepted
**Owner:** @jjeliga

## Context

Agents auto-hibernate (scale to zero) when the runtime reports itself idle, and idleness is driven by ACP chat/terminal session activity. A long-running workload that runs *without* an ACP session generates no activity, so the idle checker hibernates it mid-job and kills the work. Session-bound background work is out of scope — closing the session may end the work it spawned. The open problem is the no-session workload; any solution had to be harness-agnostic and reliable across hours-long jobs.

## Decision

Keeping an agent awake is an explicit, per-agent opt-in — never inferred from the workload's processes. It takes two forms: an **unconditional flag** (off by default) that makes the agent count as never-idle so the controller never scales it to zero, for long-running no-session workloads that can't signal their own boundaries; and a **self-managed sentinel** a workload creates while its work runs and removes when done, pinning the agent only for that duration so it reclaims itself. The platform observes nothing about the workload and promises only that the agent will not hibernate while a pin is set. The flag is the per-agent form of the existing global auto-hibernation switch.

## Alternatives Considered

- **Lease/heartbeat** — the keep-alive connection would have to survive hours, and a transient network blip would drop the lease and kill the job; the agent also has no general signal for "still working" to renew on.
- **Per-process PID-liveness declaration** — requires harness cooperation and is blind to work the harness spawns ad hoc.
- **Platform run-in-background primitive** — every harness would have to route background work through it, and it cannot capture ad-hoc spawns, so coverage is partial and unreliable.
- **Generic child-process monitoring** — cannot distinguish always-on idle infrastructure (e.g. a model gateway) from active work, so it pins pods indefinitely on false positives, and orphaned processes silently defeat scale-to-zero.
- **Single supervised-hook observability** — correct only for workloads that adopt that hook *and* keep its process alive for the whole job; silently hibernates every other workload mid-job — a failure mode that looks robust but isn't.

## Consequences

- **Easier:** A no-session workload survives to completion regardless of how it spawns processes — process- and harness-agnostic, it covers the ad-hoc-spawn and orphaned-child cases every detection-based alternative provably misses. A workload that knows its boundaries self-manages the sentinel and reclaims automatically. Reuses the existing global idle-disable model, now scoped to one agent.
- **Harder:** The unconditional flag never scales back to zero on its own — the agent holds its resources until the flag is cleared by hand, even after the job finishes. The sentinel reclaims only if the workload removes its marker; a crash that skips cleanup leaves the agent pinned. Left enabled on an interactive agent, keep-awake disables its hibernation for no benefit.
- **Committed-to:** Reclaiming a flag-pinned agent is operational, not automatic. If forgotten or runaway pins become a resource problem, a bounding mechanism (max-lifetime cap, or staleness expiry on the sentinel) is the follow-up — none today.
