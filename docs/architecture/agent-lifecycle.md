# Agent lifecycle

Last verified: 2026-07-01

## Overview

An **Agent** is the durable, owned, runnable resource. A single `agent` ConfigMap holds both definition and runtime state, and its StatefulSet scales between zero and one replica as the Agent hibernates and wakes. **Sessions** live inside a running pod: each ACP session is a short-lived conversation that the pod's persistent agent process serves. The lifecycle is driven by three actors:

- **Users** drive both management and sessions, but along different paths. The **UI** is the only management surface — creating, configuring, hibernating, and deleting Agents all flow through tRPC on the api-server's public port, which is the sole writer of the Agent spec. Sessions can be driven from the UI **or** from a connected channel (Slack, Telegram). Channels never hit management endpoints; they dial the api-server's ACP relay only, with identity scoped to the individual messenger user driving the session. Channel internals live on [channels](channels.md).
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
  API->>K: write pull Secret<br/>(if registry credential)
  API->>K: write Agent CR (spec)
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
  API->>K: delete Agent CR
  C->>K: tear down owned resources
```

## Phases

### Create

The api-server writes a new Agent custom resource whose spec carries the Agent's image / mount declarations (copied from a Template at create time, if any), env, secret refs, and allowed users. There is no stored desired state — running-vs-hibernated is observed status the controller derives from activity. The controller reconciles a paired set of owned resources: two StatefulSets (the agent and its paired gateway), two headless Services (the agent's ACP and the gateway's `<agent>-gateway` proxy DNS), an agent-egress NetworkPolicy, and a per-Agent Envoy bootstrap ConfigMap + leaf TLS Certificate.

When the create request carries a private-registry credential, the api-server writes an agent-scoped `dockerconfigjson` pull Secret *before* the Agent CR and rolls it back if that write fails; the controller then lists that Secret first on the pod's `imagePullSecrets`, ahead of any install-wide default. The kubelet consumes it to pull the image — it never enters the pod, and a stuck pull surfaces as an image-pull failure on the pod rather than a create-time error. See [security-and-credentials](security-and-credentials.md#image-pull-credentials).

The pod image is built from `platform-base` plus a harness-specific layer. The platform contract is two executables at fixed paths: `/usr/local/bin/harness-chat` (spawned as the ACP subprocess for chat-mode sessions) and `/usr/local/bin/harness-terminal` (spawned attached to a PTY for terminal-mode sessions, with `HARNESS_SESSION_ID` exported so the harness can pick up the right resumable session). agent-runtime otherwise treats the harness as opaque. The workspace PVC is provisioned on first wake and survives subsequent hibernations — unless the warm pool is enabled and a pre-provisioned spare matches the mount's size, in which case the controller claims that already-bound spare at create time so first start skips the provisioning wait. The choice is invisible after the fact: a claimed spare becomes an ordinary per-Agent PVC. See [persistence](persistence.md#warm-pvc-pool).

Pod env at start is composed by the controller from platform wiring only — last occurrence wins, with `PORT` server-enforced:

1. **platform envs** — proxy + auth wiring rendered by the controller (`HTTPS_PROXY`, harness URL, ext-authz routing, etc.).
2. **chart-level platform defaults** — any `env` the install declares as defaults.

Everything tied to an Agent's *configuration* rides the runtime channel as `env`-kind contributions instead, never the pod spec: connection-derived env (credential placeholders the gateway swaps on the wire), user-typed env (the Environment editor), and template env. The api-server stores user-typed and template env in Postgres `agent_env` and delivers all of it at the next idle turn with no pod roll, ordering user env ahead of connection/secret env so it wins on a name collision. Template env is seeded into `agent_env` at create time only, so editing a Template never re-flows into a running Agent. The Agent CR's `spec.env` field is retained but no longer read. See [connections](connections.md).

Connector state that doesn't fit the env model (per-host CLI configs, allowlists, and similar) is materialized as files directly under HOME by `agent-runtime` itself, which holds an SSE connection to the api-server and merges declarative file fragments without restarting the pod. Image-baked content under the same paths participates in the merge — `agent-runtime` writes to the real PVC path, not a shadowing `emptyDir`.

### Wake

Every caller that sends work to a pod — the api-server's ACP relay, channel adapters, skills management — routes through a single reachability primitive in the api-server. The primitive's contract: **the controller-published `Ready` condition is the authoritative answer to "can I call this pod?"** The primitive pokes activity by bumping the `agent-platform.ai/last-activity` annotation (the reconciler scales up any Agent with recent activity), single-flights concurrent waits per Agent, and bumps the same annotation on every successful call, so any caller implicitly keeps the pod warm.
Contributions are applied out-of-band by a single background worker (a pod's `hello` is presence-only — it just signals the worker to dispatch). The worker dispatches **only to a Ready agent** — the same readiness gate the relay's `ensureReady` uses (the controller's `Ready` condition) — so an apply never targets a pod that is down or rolling; when the agent isn't Ready the outbox row stays unsettled and the periodic sweep re-dispatches once it is. Each apply runs every contribution to termination and records which drivers failed; a degraded agent (failed installs retrying in the background, capped) surfaces via its `contributionFailures` badge and never wedges. Readiness itself does **not** wait on contributions — configuration applies in the background.

Four paths trigger a wake:

- **Connect-driven** — the api-server is about to forward an ACP frame to a hibernated Agent and ensures readiness before the relay completes. The frame can originate from a UI tab attaching to a session or from a channel worker (Slack / Telegram) routing an inbound message to its bound session.
- **Schedule-driven** — a schedule fire commits a `trigger` event to the runtime outbox, then pokes the Agent awake without waiting for readiness; the boot-time `hello` catch-up delivers the event once the pod is `Ready`, and the event's TTL bounds how stale a fire can land (see [Trigger fire](#trigger-fire)).
- **Experiment-driven** — starting an Experiment pokes each Arm's Agent awake the same way, committing an `experiment-trigger` event that opens the Arm's Trial session on delivery. See [experiments](experiments.md).
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

Hibernation scales an idle Agent's StatefulSets to zero to reclaim its pod's CPU and memory; the next activity wakes it (see [Wake](#wake)). Whether an Agent is "idle" is **derived from observed activity, never stored** — there is no desired-state flag — and the derivation is deliberately split across two independent checks that must agree before a pod is scaled down.

**The decision.** The controller's idle checker scans running Agents on a timer (the interval scales with the timeout, clamped to 30 s–5 min). It hibernates an Agent only when *both* checks below agree it is quiet:

1. **Activity annotations** — the same `shouldRun` gate the reconciler uses to scale *up*, so scale-down and scale-up can never disagree. The Agent stays awake while `active-session` is set, or while `last-activity` falls within the idle timeout. The gate fails open — a missing or unparseable stamp keeps it running — so hibernation only ever follows a *positive* idle signal, never absent data.
2. **agent-runtime's live `idle` flag** — before scaling down, the checker probes the pod. The runtime is authoritative about its own idleness and reports one boolean; the controller reads nothing more into it. An unreachable pod counts as *not busy*, which permits hibernation.

**What counts as activity.** Those two checks rest on three signals, each catching something the others miss:

- **agent-runtime (`idle` flag).** Busy while a prompt turn is in flight, while prompts queue behind it, while an agent-initiated request (e.g. a permission prompt) awaits the client, or while a terminal (PTY) is open — an open-but-idle terminal counts, because the open PTY *is* the signal. It does **not** see SSH, which runs as its own `sshd` outside the runtime's PTY tracking. A chat is the exception to "open connection = busy": an attached chat with no turn running reads as `idle` here, since the flag tracks work, not watchers — such a chat stays awake via `active-session` below, not this probe. What the probe uniquely catches is in-flight work that no connection holds and `last-activity` no longer covers: a scheduled run outlasting the idle timeout, or a turn still running after its tab closed.
- **api-server (`active-session` annotation).** A refcount of open chat, terminal, and SSH connections — set on the first, cleared on the last, regardless of traffic. So a chat merely open in the UI keeps the Agent awake, exactly as an open terminal does. Since the probe is blind to SSH, an SSH session leans on this annotation, which alone suffices while the connection is open. A half-dead connection is reclaimed by a WS ping/pong, and the api-server clears stale pins at boot (a fresh process holds no connections).
- **api-server (`last-activity` annotation).** The one traffic-driven signal, and the clock the idle timeout measures against. Bumped (debounced ~30 s) by the chat, terminal, and SSH relays as bytes flow, by every proxied call, by an explicit wake, and by the scheduler on a fire.

None of this depends on *who* opened the session: the UI, a connected channel, and the CLI all dial the same three relays, so a session's signals follow its **kind** — chat, terminal, or SSH — not its caller. A CLI terminal is covered by both checks like a UI terminal; a CLI SSH session is seen only by the annotations, never the probe — like any other SSH.

**The blind spot — background work.** Every signal above tracks sessions and connections, never the processes behind them. Work detached from a session — a background job outliving the terminal that launched it, an async task the agent or a tool kicked off, a batch pipeline with no chat open — moves none of them: `active-session` is clear, `last-activity` ages out, the runtime reports `idle`, both checks agree, and the controller hibernates the pod **mid-job, killing the work**.

This is deliberate, not a gap to close. The platform *can* see that processes are running in the pod — what it can't do is tell *what* they are: a working batch job looks no different from an always-on model gateway, a language server, or an orphan a dead session left behind. A process-based keep-awake signal inherits that ambiguity — it would pin the pod open forever on idle infrastructure, or let one leaked process defeat hibernation outright. So the platform keys only on sessions and connections, which it *can* attribute, and accepts the blind spot as the cost.

**The per-agent hibernation timeout.** Since the platform can't *detect* this work, it lets an operator *budget* for it. Each Agent carries an optional timeout override: unset inherits the cluster-wide default, a positive value sets a per-agent idle window in minutes, and **`0` disables hibernation** so the Agent never scales down. The controller resolves the effective value (override else default) and feeds it to the same `shouldRun` gate used for scale-up and scale-down. The sandbox settings expose it as a minutes field showing that *effective* value, so an Agent with no override displays the inherited default, not a blank.

It's a blunt instrument, not a fix for the blind spot: a longer window (or `0`) on an Agent with known no-session work keeps it alive to finish, but doesn't make that work visible. The cost is real — there's no auto-reclaim, so a long or disabled timeout holds CPU, memory, and the harness open until lowered by hand; on an interactive Agent it just forfeits scale-to-zero for nothing.

The pod terminates; the PVC, Secret, Service, and NetworkPolicy persist. Workspace state survives — the git checkout, `node_modules`, `.venv`, mise cache, and `$HOME` are all on the PVC and rejoin on the next wake. Anything written to the container's ephemeral filesystem (OS-level changes, tools installed outside `$HOME`) is lost; this is a deliberate constraint of the lifetime model.

### Delete

The api-server deletes the Agent custom resource. The controller's reconciler tears down the owned StatefulSet, Service, NetworkPolicy, and Secret. Sessions are agent-owned files on the PVC and disappear with it. The controller reclaims the agent's workspace PVCs explicitly (StatefulSet `volumeClaimTemplate` PVCs are not cascade-deleted by K8s). In-flight per-turn forks are owner-refed to the Agent CR, so Kubernetes garbage-collects them automatically. The api-server owns none of this: it never touches PVCs, and only deletes the Secrets it wrote — the per-channel credential Secrets and, via a cleanup hook, the agent-scoped image-pull Secret (a label-scoped orphan sweep backstops a missed delete).

Schedules are independent Postgres rows and survive Agent deletion as orphans unless the deletion path explicitly cascades.

## Forks

Forks are the third durable concept in the bounded context (alongside Template and Agent). An `agent-fork` ConfigMap runs a derivative of an existing Agent with credential and env overrides. Unlike Agents, forks reconcile to a **Kubernetes Job** rather than a StatefulSet — they run to completion and are not woken, hibernated, or kept warm. This already matches the run-to-completion shape the target lifetime model intends for Agents. The interesting machinery is which secrets the fork can see and how its identity propagates upstream; see [security-and-credentials](security-and-credentials.md). A fork's Job inherits the parent Agent's image-pull Secret, so the kubelet pulls a private parent image without the fork ever seeing the credential.

## Run executors (`dam-run`)

A **Run** is an ephemeral, single-command executor behind the in-pod `dam-run` CLI: `dam-run <cmd>` runs the command in a *separate* sandbox pod that shares the calling pod's image, configuration, and RWX workspace, with stdio streamed through a PTY so it reads as a local invocation. The executor stands up no infrastructure of its own — just a bare Pod plus one egress NetworkPolicy admitting it to the parent's existing gateway, whose credentials and egress boundary it borrows wholesale (see [security-and-credentials](security-and-credentials.md#dam-run-executor-pods)). Its pod boots agent-runtime in **exec-only mode** — an exec endpoint plus health, no runtime-channel hello.

The flow is synchronous over one WebSocket: `dam-run` dials the api-server harness port, which writes a `Run` CR, waits for the controller-published pod IP, then relays terminal-protocol frames both ways. When the stream closes (command exits, or `dam-run` dies) the api-server deletes the `Run`, and K8s GC reaps the owner-refed executor pod + NetworkPolicy. The `Run` is itself owner-refed to the parent Agent, so deleting the Agent cascade-deletes any in-flight `Run`. Two backstops cover a `Run` the api-server never cleaned up (e.g. a crash mid-stream): a controller hard-lifetime reaper and a harness-boot sweep that deletes any `Run` a fresh process holds no live relay for.
