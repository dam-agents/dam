# ADR-065: Pod services — image-provided background processes supervised by agent-runtime

**Date:** 2026-06-10
**Status:** Accepted
**Owner:** @JanPokorny

## Context

The claude-code image needs a pod-scoped background process (a local LiteLLM
gateway, [ADR-066](066-local-litellm-gateway.md)) — the first long-lived
process in an agent pod outside agent-runtime's per-session children. The
first cut launched it as a `nohup`'d daemon from the harness shims, which
exposed what an unsupervised daemon costs in this pod model: PID 1 is
agent-runtime (Node reaps only children it spawned, so a dead orphan
zombifies), nothing restarts a crashed daemon (the next session stalled 60 s
on a stale lock and then ran broken against the raw upstream), and nothing
restarts it when credentials/URLs change — yet env is runtime-delivered and
hot ([ADR-052](052-runtime-channel.md)), so a daemon's spawn-time env snapshot
goes stale the moment a provider is re-saved.

## Decision

**Agent images may ship one optional "pod service" executable at a well-known
path; agent-runtime supervises it as a direct child for the life of the pod.**
The runtime spawns it once the runtime env is first materialized, respawns it
whenever the env driver rewrites the env, restarts crashes with capped
backoff, and treats exit 0 as "nothing to do for this env" (down until the
next env change). The service gets the same env, with the same precedence, as
every harness spawn. The contract is harness-agnostic — the runtime knows
nothing about what the service does; the image decides by what it installs,
exactly like the harness shims of [ADR-037](037-remote-terminal.md).

Additionally, the base image's PID 1 is wrapped in a minimal init
(catatonit), so descendants the runtime did *not* spawn — processes orphaned
by a dying harness or service — are still reaped and signals still forward.

## Alternatives Considered

- **`nohup` daemon from the harness shims (the first cut)** — no reaping, no
  crash restart, no env-change restart; raced on a hand-rolled lock and stalls
  sessions when the daemon dies.
- **Sidecar container in the agent pod** — proper k8s lifecycle, but the
  service needs the runtime-delivered env, which lands over the runtime
  channel into the agent container; a sidecar would need a second delivery
  path and a pod-spec change for what is one image's concern.
- **Declaring the service in `runtime-manifest.yaml`** — the manifest binds
  Contribution drivers and is advertised to the api-server; a pod service is
  purely pod-local, and claude-code doesn't fork the base manifest today, so a
  schema entry would force every image to carry a manifest copy for one path
  string.

## Consequences

- **Easier:** background-process correctness is owned once, in the runtime —
  crash restart, env-change respawn, reaping, shutdown — instead of
  re-implemented in shell per image (the first cut duplicated restart logic
  in shell *and* Python and still missed the env-change case).
- **Easier:** service output lands in the pod log stream (`kubectl logs`)
  instead of a file inside the container.
- **Harder:** a service crash-loop now consumes pod resources invisibly to
  k8s — the kubelet sees one healthy container; only the backoff cap and pod
  logs surface it.
- **Harder:** an unrelated env change (e.g. a GitHub token landing) also
  respawns the service, briefly interrupting it; acceptable because the same
  change already recycles the harness, but a service must tolerate restarts
  at any time.
- **Committed-to:** the well-known executable path is now image ABI, like the
  harness shim paths; and every env rewrite implies "no process may keep
  routing on the previous env" — future env-consuming daemons must use this
  hook rather than caching env at boot.
