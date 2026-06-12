# Agent lifecycle

Last verified: 2026-06-12

## Overview

An **Agent** is the durable, owned, runnable resource. A single `agent` ConfigMap holds both definition and runtime state, and its StatefulSet scales between zero and one replica as the Agent hibernates and wakes. **Sessions** live inside a running pod: each ACP session is a short-lived conversation that the pod's persistent agent process serves. The lifecycle is driven by three actors:

- **Users** drive both management and sessions, but along different paths. The **UI** is the only management surface — creating, configuring, hibernating, and deleting Agents all flow through tRPC on the api-server's public port, which is the sole writer of `spec.yaml`. Sessions can be driven from the UI **or** from a connected channel (Slack, Telegram). Channels never hit management endpoints; they dial the api-server's ACP relay only, with identity scoped to the individual messenger user driving the session. Channel internals live on [channels](channels.md).
- The **api-server's scheduler** fires triggers on RRULE occurrences, delivers them durably over the runtime channel's outbox, and pokes the Agent awake so a fire lands even on a hibernated Agent.
- The **controller's idle checker** hibernates running Agents that go quiet.

## Diagram

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant API as api-server
  participant C as controller
  participant K as K8s API
  participant P as agent pod<br/>(agent-runtime + harness)

  Note over U,K: Create — UI only
  U->>API: create agent
  API->>K: write spec.yaml<br/>(desiredState=hibernated)
  C->>K: reconcile<br/>Secret + StatefulSet(replicas=0) + Service + NetworkPolicy

  Note over U,P: Connect-driven wake — UI tab attach OR channel inbound message
  U->>API: ACP frame for session
  API->>K: scale StatefulSet → 1
  K-->>P: pod boots, agent-runtime ready
  API->>P: relay ACP frame

  Note over API,P: Schedule fire — RRULE match, not in quiet hours
  API->>API: insert trigger event into runtime outbox
  API->>K: poke activity — reconciler scales up a hibernated Agent
  API->>P: applyState — delivered only once pod is Ready
  Note over P: trigger handler opens in-process ACP session<br/>(session/new or session/resume),<br/>submits the task as a prompt
  Note over P: event settles on prompt submission;<br/>undelivered events expire after a TTL

  Note over C: idle checker probes pod,<br/>no active sessions/triggers
  C->>K: scale StatefulSet → 0
  Note over P: pod terminates,<br/>PVC + Secret + Service preserved

  Note over U,K: Delete — UI only
  U->>API: delete agent
  API->>K: delete agent ConfigMap
  C->>K: tear down owned resources
```

## Phases

### Create

The api-server writes a new `agent` ConfigMap with `spec.yaml` carrying the Agent's image / mount declarations (copied from a Template at create time, if any), env, secret refs, allowed users, and a `desiredState` of `running` or `hibernated`. The controller reconciles a paired set of owned resources: two StatefulSets (the agent and its paired gateway, each tracking `desiredState`), two headless Services (the agent's ACP and the gateway's `<agent>-gateway` proxy DNS), two role-scoped NetworkPolicies, and a per-Agent Envoy bootstrap ConfigMap + leaf TLS Certificate.

The pod image is built from `platform-base` plus a harness-specific layer. The platform contract is two executables at fixed paths: `/usr/local/bin/harness-chat` (spawned as the ACP subprocess for chat-mode sessions) and `/usr/local/bin/harness-terminal` (spawned attached to a PTY for terminal-mode sessions, with `HARNESS_SESSION_ID` exported so the harness can pick up the right resumable session). agent-runtime otherwise treats the harness as opaque. The workspace PVC is provisioned on first wake and survives subsequent hibernations — unless the warm pool is enabled and a pre-provisioned spare matches the mount's size, in which case the controller claims that already-bound spare at create time so first start skips the provisioning wait. The choice is invisible after the fact: a claimed spare becomes an ordinary per-Agent PVC. See [persistence](persistence.md#warm-pvc-pool).

Pod env at start is the composition of **three** layers — last occurrence wins, with `PORT` server-enforced:

1. **platform envs** — proxy + auth wiring rendered by the controller (`HTTPS_PROXY`, harness URL, ext-authz routing, etc.).
2. **`credentialEnvVars`** — env contributions derived from the Agent's mounted credential Secrets (e.g. `GH_TOKEN` from a GitHub PAT half).
3. **`agent.env`** — the single env list on the Agent's `spec.yaml`. The api-server is its sole writer.

Template env contributes at *create time only*: when an Agent is created from a Template, the api-server's `assembleSpecFromTemplate` step copies template env into `agent.env`. The controller never reads the Template again at pod start, so editing a Template never re-flows into a running Agent — there is no "template envs" runtime layer. Editing `agent.env` takes effect on the next pod restart.

Connector state that doesn't fit the env model (per-host CLI configs, allowlists, and similar) is materialized as files directly under HOME by `agent-runtime` itself, which holds an SSE connection to the api-server and merges declarative file fragments without restarting the pod. Image-baked content under the same paths participates in the merge — `agent-runtime` writes to the real PVC path, not a shadowing `emptyDir`.

### Wake

Every caller that sends work to a pod — the api-server's ACP relay, channel adapters, skills management — routes through a single reachability primitive in the api-server. The primitive's contract: **the controller-published `Ready` condition is the authoritative answer to "can I call this pod?"** The primitive pokes activity by bumping the `agent-platform.ai/last-activity` annotation (the reconciler scales up any Agent with recent activity), single-flights concurrent waits per Agent, and bumps the same annotation on every successful call, so any caller implicitly keeps the pod warm.
Contributions are applied out-of-band by a single background worker (a pod's `hello` is presence-only — it just signals the worker to dispatch). The worker dispatches **only to a Ready agent** — the same readiness gate the relay's `ensureReady` uses (the controller's `Ready` condition) — so an apply never targets a pod that is down or rolling; when the agent isn't Ready the outbox row stays unsettled and the periodic sweep re-dispatches once it is. Each apply runs every contribution to termination and records which drivers failed; a degraded agent (failed installs retrying in the background, capped) surfaces via its `contributionFailures` badge and never wedges. Readiness itself does **not** wait on contributions — configuration applies in the background.

Three paths trigger a wake:

- **Connect-driven** — the api-server is about to forward an ACP frame to a hibernated Agent and ensures readiness before the relay completes. The frame can originate from a UI tab attaching to a session or from a channel worker (Slack / Telegram) routing an inbound message to its bound session.
- **Schedule-driven** — a schedule fire commits a `trigger` event to the runtime outbox, then pokes the Agent awake without waiting for readiness; the boot-time `hello` catch-up delivers the event once the pod is `Ready`, and the event's TTL bounds how stale a fire can land (see [Trigger fire](#trigger-fire)).
- **Skills-management-driven** — install / uninstall / private-source scan / publish all route through the same primitive before reaching the agent (scan and publish reach agent-runtime directly over the harness port; install/uninstall keep the pod warm so the apply worker dispatches the bumped outbox). See [skills](skills.md).

Wake is bounded — the primitive polls pod readiness with backoff and gives up after two minutes, surfacing a loud error to its caller (WS close code, channel log, or skills call error). The schedule-driven poke is the exception: it doesn't wait, so there is no bounded wait to fail.

### Trigger fire

Schedules are Postgres rows owned by the api-server, each armed as a delayed job on a Redis-backed queue — one pending job per schedule, re-armed after every fire. The next occurrence is computed from the schedule's cron or RRULE expression in its timezone, skipping any occurrence that falls inside an enabled quiet-hours window. Suppressed fires are dropped, not deferred — quiet hours mean "skip these," not "queue for later" — and a schedule whose every occurrence is quiet is rejected at save time.

When a fire is due:

1. The api-server inserts a `trigger` event into the Agent's runtime outbox in the same transaction that bumps the Agent's version, then signals the delivery worker. The fire is durable from this point; the schedule re-arms for its next occurrence regardless of delivery outcome.
2. The api-server pokes the Agent's activity annotation so the reconciler scales a hibernated Agent up. The poke never waits on readiness; a poke that errors is recorded as a failed fire on the schedule's status, but the committed event still delivers if the Agent comes `Ready` within its TTL.
3. The delivery worker pushes the event over the runtime channel's `applyState` — only once the Agent is `Ready`. A waking Agent picks pending events up on its boot-time `hello` catch-up. Every event carries a TTL, so an Agent that stays down through several occurrences (error state, failed poke) doesn't replay a backlog of stale fires when it eventually wakes. Outbox mechanics — versioning, the sweep, expiry — are owned by [connections](connections.md#event-lifecycle).
4. agent-runtime's trigger handler opens an ACP session against the harness over an in-process channel and submits the task as a prompt. The event settles once the prompt is submitted; the turn itself runs asynchronously in the harness.

A failed or undelivered event stays pending in Postgres and is redelivered until it settles or expires. The agent keeps a last-fire timestamp per schedule on the PVC and skips any fire at or before it, so a redelivered or superseded fire never runs twice.

#### Session continuity per schedule

The session model differs by schedule mode:

- **Fresh schedule** — every fire creates a new session via `session/new`. The schedule accumulates a list of sessions over time, browseable under the schedules tab.
- **Continuous schedule** — the first fire creates a session via `session/new`; every subsequent fire calls `session/resume` against the same session id. One schedule, one session, history retained across fires.

The schedule↔session link is agent-owned: schedule sessions are typed (`schedule_cron`) through ACP session metadata, and the continuous binding is a per-schedule entry in a state file on the PVC. Resetting a continuous schedule rides the same outbox rail as fires — a `schedule-reset` event clears the binding on delivery, so the next fire starts fresh. Unlike a fire, a reset does not poke the Agent awake: a reset against an Agent that stays hibernated past the event's TTL expires undelivered, and the next fire resumes the old session. Within a continuous schedule fires serialize naturally: each fire resumes the same session and prompts queue at the runtime. Fresh fires each open their own session and may run concurrently.

### Session inside the pod

The harness child process runs for the pod's lifetime, not per-connection. Multiple ACP channels (UI tab WebSockets, the Slack worker, the in-process trigger handler) attach to the same runtime concurrently and engage with sessions implicitly through the `sessionId` they carry on each frame.

Each session is an append-only in-memory log (≤2 MB soft cap, with a truncation sentinel for older history). Every channel keeps a per-session cursor; new events are appended to the log and fanned out to engaged channels at or behind the new sequence number. `session/load` is served from the log on cache hit and falls through to the agent's on-disk store on cold start.

`session/resume` is mediated entirely by the runtime — the frame never reaches the harness. On the hot path (cached metadata) the runtime engages the channel, advances its cursor to the log tail, and returns a synthetic response with no replay. On the cold path (no metadata, e.g. after the pod restarts) the runtime parks the request as a waiter and issues its own `session/load` to rehydrate the harness; replay events populate the log without reaching any client, and on completion every parked resume waiter is served from memory. This shields the UI from per-harness capability differences (some harnesses, like `pi-agent`, don't implement `unstable_resumeSession` at all) and from the cold-subprocess problem on which even resume-capable harnesses would fail.

When a session goes idle — no engaged channel, no active or queued prompt, no agent-initiated request still pending — the runtime sends `session/close` to the harness. The per-session subprocess is reaped, freeing memory; the next attach respawns it. Permission requests with no engaged channel time out after ten minutes and the runtime responds to the agent with an error so the tool call aborts cleanly.

Terminal-mode sessions follow a different model from the chat path above. agent-runtime accepts at most one WebSocket per `sessionId` on `/api/terminal`, allocates a PTY, spawns `harness-terminal` attached to it, and pipes raw bytes both ways through a small binary frame protocol (`OP_INPUT` / `OP_OUTPUT` / `OP_RESIZE` / `OP_EXIT`). A headless xterm tracks scrollback so that a tab refresh within 30 seconds of disconnect reattaches to the same PTY and replays the serialized buffer; after the grace window, the PTY is killed. There is no append-only log, no fan-out, and no `session/resume` — terminal sessions belong to one viewer at a time, and the harness's own on-disk session store is the only durable record (e.g. `~/.claude/projects/.../<HARNESS_SESSION_ID>.jsonl`).

SSH sessions are unrelated to the session/mode machinery above — they carry no `sessionId`, no DB row, and no harness involvement. agent-runtime accepts a WebSocket on `/api/ssh`, spawns a per-connection OpenSSH `sshd -i` (inetd mode) as the agent user, and relays raw bytes verbatim between the socket and the child's stdio. SSH terminates at that sshd, which authenticates a CLI-registered public key (`ssh.authorizeKey`) and drops into a plain `/bin/bash` login shell; the api-server and CLI never parse the SSH wire. sshd resets the environment before that shell, so agent-runtime rebuilds `~/.ssh/environment` from the live injected env on each connection (with `PermitUserEnvironment yes`) — the SSH session gets the same proxy routing and credentials the harness has, rather than a bare env with no working egress, and picks up connection/credential changes injected since boot on the next reconnect. Concurrent SSH connections to one agent coexist (each its own `sshd`), and the endpoint exists only on images that ship `sshd`. Like the terminal and chat relays, an open SSH connection marks the agent `active-session`, so it will not hibernate while connected — close the editor/session to let it idle down. Two safety nets keep that pin honest: a WS ping/pong releases it if the connection half-dies, and the api-server clears stale pins at boot (a fresh process holds no connections, so any surviving pin is leaked).

Beyond per-session children, agent-runtime supervises at most one **pod
service** — an optional
background process the agent image provides at a well-known path, running for
the life of the pod. The runtime spawns it once the runtime-channel env is
first materialized (it typically consumes credentials/URLs from that env),
restarts crashes with capped backoff, and interprets a clean exit as
"nothing to do for this env" — the service then stays down until the env
next changes. When the env driver rewrites the env, the runtime refreshes a
well-known env snapshot file and sends SIGHUP: a service that handles it
reloads in place (in-flight work finishes, new work uses the fresh env); one
that doesn't dies by the signal's default action and is respawned with the
fresh env. Its output joins the pod log stream. The pod's
PID 1 is a minimal init (catatonit) wrapping agent-runtime, so descendants
the runtime did not spawn — processes orphaned by a dying harness or service
— are reaped rather than left as zombies. claude-code uses the hook to front
custom Anthropic-compatible upstreams with a local model gateway;
images without a pod service are unaffected.

Switching a session's mode (e.g. chat → terminal) is metadata-only: the switching client persists the new mode over ACP (`session/resume` carrying `_meta.platform.mode`), which the runtime merges into its session-metadata store. The running harness is unaffected — mode is a UI hint about which surface (chat vs. terminal PTY) to render. There is no cross-client notification; other clients reflect the change on their next `session/list`. The `--reset` / terminal-reset path is independent: it closes the terminal WebSocket and calls agent-runtime's `resetSession`, which sends `session/close` to the harness and clears the in-memory log and cursors.

Beyond ACP frames, agent-runtime also serves a Bearer-authenticated tRPC surface on the harness port for skill install / uninstall / scan / publish / listLocal. The api-server is the sole caller; the skills-*management* calls wake a hibernated pod through the reachability primitive (above) before reaching it, while the read paths (`state` / `listLocal`) degrade gracefully and never wake. Skill files land on the PVC under the configured Skill Paths and are picked up by the harness on the next session start (no hot-reload). See [skills](skills.md).

The **target** lifetime model is single-use Kubernetes Jobs per turn, with a Redis-backed read cache for lightweight queries and a two-tier PVC layout (per-session + shared). Migration is on a parallel track and not blocking. The current prototype uses the persistent runtime described above.

### Hibernate

The controller's idle checker periodically scans running Agents. For each, it probes agent-runtime's `/api/status` over the cluster network. The runtime is authoritative about its own idleness: it reports a single `idle` flag (false while a prompt turn is running, prompts are queued, an agent-initiated request awaits a client, or a terminal is open — connected viewers don't count), that flag is the endpoint's entire payload, and the controller derives nothing on its own. If the runtime reports idle for long enough (and the probe doesn't error), the checker hibernates the Agent by scaling its StatefulSets to zero.

The pod terminates; the PVC, Secret, Service, and NetworkPolicy persist. Workspace state survives — the git checkout, `node_modules`, `.venv`, mise cache, and `$HOME` are all on the PVC and rejoin on the next wake. Anything written to the container's ephemeral filesystem (OS-level changes, tools installed outside `$HOME`) is lost; this is a deliberate constraint of the lifetime model.

### Delete

The api-server deletes the `agent` ConfigMap. The controller's reconciler tears down the owned StatefulSet, Service, NetworkPolicy, and Secret. Sessions tied to this Agent in the DB are cleaned via cascade or periodic reconciliation. The controller reclaims the agent's workspace PVCs explicitly (StatefulSet `volumeClaimTemplate` PVCs are not cascade-deleted by K8s). In-flight per-turn forks are owner-refed to the Agent CR, so Kubernetes garbage-collects them automatically. The api-server owns none of this: it never touches PVCs, and only deletes the per-channel credential Secrets it wrote.

Schedules are independent Postgres rows and survive Agent deletion as orphans unless the deletion path explicitly cascades. The UI offers a checkbox to delete a schedule's accumulated sessions alongside the schedule itself.

## Forks

Forks are the third durable concept in the bounded context (alongside Template and Agent). An `agent-fork` ConfigMap runs a derivative of an existing Agent with credential and env overrides. Unlike Agents, forks reconcile to a **Kubernetes Job** rather than a StatefulSet — they run to completion and are not woken, hibernated, or kept warm. This already matches the run-to-completion shape the target lifetime model intends for Agents. The interesting machinery is which secrets the fork can see and how its identity propagates upstream; see [security-and-credentials](security-and-credentials.md).

