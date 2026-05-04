# DRAFT: Remote terminal — CLI attaches to a tmux-multiplexed harness TUI in the agent pod

**Date:** 2026-05-04
**Status:** Proposed
**Owner:** @tomkis

## Context

Humr's only first-class user surface today is the chat-primary web UI ([ADR-013](013-ui-approach.md), [ADR-020](020-responsive-ui-pwa.md)). Power users who already live in their terminal want to drive a Humr instance with the same harness UX they get from running `claude` (or `codex`, `gemini`) on their laptop. Forcing them through a browser is the single biggest friction point for the "agent on a remote box" use case.

Three approaches are on the table; we have not picked one. The platform's value lives in the pod — credential gateway, isolated FS/PVC, network policy, schedules, channels — and the workspace must keep living in the cluster. Within that constraint, the three live shapes are:

- **Option A — Local harness, cluster-side credentials + FS sync.** Harness binary runs on the user's laptop. Credential injection is reached as a network-exposed endpoint on the cluster (extending the credential gateway, [ADR-005](005-credential-gateway.md) / [ADR-033](033-envoy-credential-gateway.md), to be reachable from outside the pod). The workspace continues to live in the cluster PVC, kept consistent with the laptop via a filesystem sync mechanism (mount/FUSE/Mutagen-style). Tradeoffs: requires (i) a remote-reachable credential gateway, (ii) a real FS sync story (latency, conflicts, large repos), (iii) handling laptop-side OS/arch variance for the harness, and (iv) reasoning about egress that no longer flows through the pod's NetworkPolicy.
- **Option B — TUI client over ACP.** A new client renders a terminal UI from the existing ACP session stream. Harness still runs in the pod. Reuses the current relay path; no new privilege on the api-server. Tradeoff: ACP carries turns/events, not the harness's actual screen, so client-side rendering of slash menus, pickers, pagers, etc. has to be built and maintained per harness — and is bounded by what ACP exposes.
- **Option C — TTY bridge to the in-pod harness.** Bridge a local TTY to a harness process running inside the pod; the harness's own TUI is the rendering layer. Common tradeoff: introduces a second relay protocol on the api-server; terminal byte streams aren't natively replayable/auditable like ACP. Two variants for *where* the bridge terminates inside the pod:
  - **C₁ — via Kubernetes pod-exec.** api-server attaches a WS to the K8s API's `pods/exec` subresource. PTY allocation and the channel-multiplexed frame protocol come from kubelet for free, at the cost of `pods/exec` on the api-server SA — a real and permanent privilege bump.
  - **C₂ — via agent-runtime.** api-server proxies to a new WS route on agent-runtime, which allocates a PTY (`node-pty`) and spawns the harness inside the pod. Costs ~50 LoC of PTY plumbing and an agent-runtime-defined frame format; zero new RBAC privilege; reuses the exact relay path already used for ACP. tmux's detached-server model means an agent-runtime restart doesn't kill the harness — the tmux server reparents to PID 1, and the next connect re-attaches.

The POC on `poc/remote-terminal-claude-code` (dam-wn6) is a working demonstration of **option C₁** against a `claude-code` instance. It is **not** a chosen direction — its purpose is to make option C concrete enough to compare honestly against A and B. The POC took the C₁ path because pods/exec was the shortest route to proving the shape; that is *not* an argument for C₁ over C₂ when picking the real surface. Which option we ship is the headline open question, and equivalent shapes for A and B need to be drawn before this ADR can move out of DRAFT.

## Decision

*(Pending choice between options A, B, and C above. The shape below is what option C looks like as a real surface, derived from the POC. Equivalent shapes for A and B need to be drawn before a comparison is possible. Within C, **C₂ is the structurally cleaner default** — it avoids the permanent `pods/exec` privilege bump, terminates both relay routes at the same backend, and pays only ~50 LoC of one-time PTY plumbing for it.)*

**Option C shape — add a remote-terminal surface as a peer to the ACP relay: a WebSocket endpoint on the api-server that bridges a client TTY to a `tmux`-multiplexed harness process inside the agent pod.** A small `humr` CLI is the canonical client. The bridge terminates either at K8s pod-exec (C₁) or at agent-runtime (C₂); the rest of the shape — auth, ownership check, idle bookkeeping, tmux semantics — is identical.

## Consequences

- **Second relay surface on the api-server.** The api-server now mediates two WS protocols (ACP semantic + terminal byte stream). Both go through the same auth and ownership check, so the access-control story stays single-pointed; the throughput/bottleneck story from ADR-007 grows by one channel. Under C₂ both routes terminate at the same backend (agent-runtime), which keeps the relay topology even more uniform.
- **Privilege cost differs by variant.** C₁ requires `pods/exec` on the api-server SA — a real, permanent privilege bump, mitigated only by fixed-command exec, ownership check, and the existing NetworkPolicy. C₂ requires no new RBAC at all; the ~50 LoC of PTY plumbing in agent-runtime is the analog cost. This is the main axis on which the two variants diverge, and the reason C₂ is the preferred default.
- **Harness images grow tmux + a terminal command declaration.** Small footprint (`apt-get install tmux`); harnesses that don't ship a TUI cleanly opt out by leaving `AGENT_TERMINAL_COMMAND` unset.
- **No replay, no audit trail for terminal sessions.** Unlike ACP sessions ([ADR-026](026-session-log-replay.md)), terminal byte streams aren't persisted. Acceptable for an interactive surface; if compliance later needs auditability, asciicast capture at the relay is a localized addition.
- **tmux session lifetime ties to pod lifetime.** Hibernation kills the pod and the tmux session. Compatible with the single-use-Job target ([ADR-012](012-runtime-lifetime.md)) — terminal sessions are explicitly *not* a persistence primitive. Users keep work in the PVC, not in tmux state.
- **CLI becomes a maintained surface.** Versioning, distribution, and Keycloak device-code auth need ongoing support. Aligns with where the platform was already heading (programmatic clients beyond the UI).
- **Idle hibernation interacts cleanly.** `ensureReady` bumps `last-activity` on each connect; while attached, the WS being open means traffic flows on every keystroke, so the existing idle-checker keeps the pod warm without special-casing.
- **Two parallel session views per instance in v1.** The UI's ACP session and the CLI's tmux pane render independent state. Documented as a known limitation; convergence is follow-up work.
