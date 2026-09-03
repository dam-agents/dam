# Agent lifecycle

Last verified: 2026-09-03

## Overview

An **Agent** is the durable, owned, runnable resource. It is a custom resource whose `spec` the api-server owns and whose `status` the controller writes; its StatefulSet scales between zero and one replica as the Agent hibernates and wakes. **Sessions** live inside a running pod: each ACP session is a short-lived conversation that the pod's persistent agent process serves. The lifecycle is driven by three actors:

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

Creation is per-purpose: each kind of thing a user can create has its own setup form, asking only what that kind needs. Experiment agents and knowledge bases are **Agent Kinds** — the flow stamps a marker and pins a harness image the user never sees — so their forms dispatch to the owning module's create rather than the plain agent create, which is what guarantees a marked agent gets its Install Command. Any other agent picks an image and takes the plain path. A new agent takes its template's size and the trusted egress preset, both editable on the agent afterwards. See [knowledge-bases](knowledge-bases.md) and [experiments](experiments.md) for what each Kind's create adds on top of what follows.

The api-server writes a new Agent custom resource whose spec carries the Agent's image / mount declarations (copied from a Template at create time, if any), env, and secret refs. There is no stored desired state — running-vs-hibernated is observed status the controller derives from activity. The controller reconciles a paired set of owned resources: two StatefulSets (the agent and its paired gateway), two headless Services (the agent's ACP and the gateway's `<agent>-gateway` proxy DNS), an agent-egress NetworkPolicy, and a per-Agent Envoy bootstrap ConfigMap + leaf TLS Certificate.

When the create request carries a private-registry credential, the api-server writes an agent-scoped `dockerconfigjson` pull Secret *before* the Agent CR and rolls it back if that write fails; the controller then lists that Secret first on the pod's `imagePullSecrets`, ahead of any install-wide default. The kubelet consumes it to pull the image — it never enters the pod, and a stuck pull surfaces as an image-pull failure on the pod rather than a create-time error. See [security-and-credentials](security-and-credentials.md#image-pull-credentials).

The pod image is built from `platform-base` plus a harness-specific layer. The platform contract is two executables at fixed paths: `/usr/local/bin/harness-chat` (spawned as the ACP subprocess for chat-mode sessions) and `/usr/local/bin/harness-terminal` (spawned attached to a PTY for terminal-mode sessions, with `HARNESS_SESSION_ID` exported so the harness can pick up the right resumable session). agent-runtime otherwise treats the harness as opaque. The workspace PVC is provisioned on first wake and survives subsequent hibernations — unless the warm pool is enabled and a pre-provisioned spare matches the mount's size, in which case the controller claims that already-bound spare at create time so first start skips the provisioning wait. The choice is invisible after the fact: a claimed spare becomes an ordinary per-Agent PVC. See [persistence](persistence.md#warm-pvc-pool).

Pod env at start is composed by the controller from platform wiring only — last occurrence wins, with `PORT` server-enforced:

1. **platform envs** — proxy + auth wiring rendered by the controller (`HTTPS_PROXY`, harness URL, ext-authz routing, etc.).
2. **chart-level platform defaults** — any `env` the install declares as defaults.

Everything tied to an Agent's *configuration* rides the runtime channel as `env`-kind contributions instead, never the pod spec: connection-derived env (credential placeholders the gateway swaps on the wire), user-typed env (the Environment editor), and template env. The api-server stores user-typed and template env in Postgres `agent_env` and delivers all of it at the next idle turn with no pod roll, ordering user env ahead of connection/secret env so it wins on a name collision. Template env is seeded into `agent_env` at create time only, so editing a Template never re-flows into a running Agent. The Agent CR's `spec.env` field is retained but no longer read. See [connections](connections.md).

Connector state that doesn't fit the env model (per-host CLI configs, allowlists, and similar) is materialized as files directly under HOME by `agent-runtime` itself, which holds an SSE connection to the api-server and merges declarative file fragments without restarting the pod. Image-baked content under the same paths participates in the merge — `agent-runtime` writes to the real PVC path, not a shadowing `emptyDir`.

### Template upgrade

Because a Template is captured at create time, a helm upgrade that advances a template (a newer agent image) never re-flows into existing Agents. The template-upgrade path (#1077) is the sanctioned catch-up: on every Agent read the api-server compares the Agent's captured image against the current image of the template it came from — a template's resolved image reference doubles as its version identity — and surfaces a pending update on the Agent when they differ. Applying it is user-initiated, one Agent at a time or every behind Agent at once: a single Agent confirms against the exact image movement, a batch against the images it moves to and the restart it costs, and the api-server then re-points the Agent spec at the template's current image, and the reconciler rolls a running pair onto it (a hibernated Agent just wakes on the new image). The upgrade is deliberately image-only: template env stays frozen in `agent_env` (re-seeding would clobber user edits), and mount/storage changes cannot ride a spec patch (the StatefulSet's volume layout is immutable once created) — those still require recreating the Agent.

### Wake

Every caller that sends work to a pod — the api-server's ACP relay, channel adapters, skills management — routes through a single reachability primitive in the api-server. The primitive's contract: **the controller-published `Ready` condition is the authoritative answer to "can I call this pod?"** The primitive pokes activity by bumping the `agent-platform.ai/last-activity` annotation (the reconciler scales up any Agent with recent activity), single-flights concurrent waits per Agent, and bumps the same annotation on every successful call, so any caller implicitly keeps the pod warm. The deliberate opt-outs both check the same `Ready` condition without waking anything and fail closed when the pod isn't up: a **passive** relay connection (`passive=1`) takes no pin and never bumps activity, and the per-agent tRPC relay takes no pin but keeps the stamp fresh while a view is open.
Contributions are applied out-of-band by a single background worker (a pod's `hello` is presence-only — it just signals the worker to dispatch). The worker dispatches **only to a Ready agent** — the same readiness gate the relay's `ensureReady` uses (the controller's `Ready` condition) — so an apply never targets a pod that is down or rolling; when the agent isn't Ready the outbox row stays unsettled and the periodic sweep re-dispatches once it is. Each apply runs every contribution to termination and records which drivers failed; a degraded agent (failed installs retrying in the background, capped) surfaces via its `contributionFailures` badge and never wedges. Readiness itself does **not** wait on contributions — configuration applies in the background.

Three paths trigger a wake:

- **Connect-driven** — the api-server is about to forward an ACP frame to a hibernated Agent and ensures readiness before the relay completes. The frame can originate from a UI tab attaching to a session or from a channel worker (Slack / Telegram) routing an inbound message to its bound session.
- **Schedule-driven** — a schedule fire commits a `trigger` event to the runtime outbox, then pokes the Agent awake without waiting for readiness; the boot-time `hello` catch-up delivers the event once the pod is `Ready`, and the event's TTL bounds how stale a fire can land (see [Trigger fire](#trigger-fire)).
- **Skills-management-driven** — install / uninstall / private-source scan / publish all route through the same primitive before reaching the agent (scan and publish reach agent-runtime directly over the harness port; install/uninstall keep the pod warm so the apply worker dispatches the bumped outbox). See [skills](skills.md).

Wake is bounded — the primitive polls pod readiness with backoff and gives up after two minutes, and a per-replica watch releases each wait the moment the condition flips and backs a read cache. A read bypasses that cache when its result decides a write — spec read-modify-write, the pause flow's compare-and-clear — and while the watch is unsynced, when the cache cannot tell an absent Agent from an unseen one. On giving up it reads the controller's readiness conditions one final time and classifies the failure into a typed wake-failure cause — hibernation never acted on, a pod start failure (with the controller's termination cause), pods still progressing, a gateway still coming up, a gateway failure it cannot outgrow, or a reconcile error — which callers receive and surface in their own idiom (channel reply copy, WS close reason, HTTP body, skills call error). The classification distinguishes transient causes (progressing, worth waiting or retrying) from hard ones (needing intervention); the two gateway causes split along exactly that line. A gateway wedged on a superseded configuration counts as hard even though the platform replaces such pods by itself ([security-and-credentials](security-and-credentials.md)): classification runs only once the budget is spent, so a repair that was going to land already had its chance — still seeing it means the repair itself is not working. The primitive also records wake begin/success/timeout with duration and the condition snapshot, so wake latency and failures are diagnosable from the log store. Callers can additionally register for a cold-start signal, fired when a call enters (or joins) a wake wait, to tell their user a wake is underway. The schedule-driven poke is the exception: it doesn't wait, so there is no bounded wait to fail.

### Trigger fire

Schedules are Postgres rows owned by the api-server, each armed as a delayed job on a Redis-backed queue — one pending job per schedule, re-armed after every fire. Fires are idempotent per occurrence, so at-least-once delivery cannot run one twice and a boot cannot swallow one that is due; a periodic reconcile re-arms any schedule whose queue job vanished. The next occurrence is computed from the schedule's cron or RRULE expression in its timezone, skipping any occurrence that falls inside an enabled quiet-hours window. Suppressed fires are dropped, not deferred — quiet hours mean "skip these," not "queue for later" — and a schedule whose every occurrence is quiet is rejected at save time.

When a fire is due:

1. The api-server inserts a `trigger` event into the Agent's runtime outbox in the same transaction that bumps the Agent's version, then signals the delivery worker. The fire is durable from this point; the schedule re-arms once the commit succeeds; a failed commit is retried by the queue, then by the reconcile.
2. The api-server pokes the Agent's activity annotation so the reconciler scales a hibernated Agent up. The poke never waits on readiness; a poke that errors is recorded as a failed fire on the schedule's status, but the committed event still delivers if the Agent comes `Ready` within its TTL.
3. The delivery worker pushes the event over the runtime channel's `applyState` — only once the Agent is `Ready`. A waking Agent picks pending events up on its boot-time `hello` catch-up. Every event carries a TTL, so an Agent that stays down through several occurrences (error state, failed poke) doesn't replay a backlog of stale fires when it eventually wakes. Outbox mechanics — versioning, the sweep, expiry — are owned by [runtime delivery](runtime-delivery.md#event-lifecycle).
4. agent-runtime's trigger handler opens an ACP session against the harness over an in-process channel and submits the task as a prompt. The event settles once the prompt is submitted; the turn itself runs asynchronously in the harness.

A failed or undelivered event stays pending in Postgres and is redelivered until it settles or expires. The agent keeps a last-fire timestamp per schedule on the PVC and skips any fire at or before it, so a redelivered or superseded fire never runs twice.

#### Session continuity per schedule

The session model differs by schedule mode:

- **Fresh schedule** — every fire creates a new session via `session/new`. The schedule accumulates a list of sessions over time, browseable under the schedules tab.
- **Continuous schedule** — the first fire creates a session via `session/new`; every subsequent fire calls `session/resume` against the same session id. One schedule, one session, history retained across fires.

The schedule↔session link is agent-owned: schedule sessions are typed (`schedule_cron`) through ACP session metadata, and the continuous binding is a per-schedule entry in a state file on the PVC. Resetting a continuous schedule rides the same outbox rail as fires — a `schedule-reset` event clears the binding on delivery, so the next fire starts fresh. Unlike a fire, a reset does not poke the Agent awake: a reset against an Agent that stays hibernated past the event's TTL expires undelivered, and the next fire resumes the old session. Within a continuous schedule fires serialize naturally: each fire resumes the same session and prompts queue at the runtime. Fresh fires each open their own session and may run concurrently.

### Session inside the pod

The harness child process runs for the pod's lifetime, not per-connection. Multiple ACP channels (UI tab WebSockets, the Slack worker, the in-process trigger handler) attach to the same runtime concurrently and engage with sessions implicitly through the `sessionId` they carry on each frame.

Each session is an append-only in-memory log (≤2 MB soft cap). Every channel keeps a per-session cursor; new events append to the log and fan out to engaged channels that have not yet seen them.

A `session/load` that opts in replays **only the newest tail** of the log, bounding the open cost at any length; without the opt-in the whole log replays, per ACP. The response reports any cut, with a cursor when the older range is still in the log; a load presenting that cursor is paged the older range, down to the eviction floor (cut without cursor). Cursors die with the log: a stale one is refused and the client reloads. Replay shares the connection with live fan-out, so replayed frames are tagged to their load for exact attribution.

Both verbs are runtime-mediated: a hot `session/resume` engages the channel and answers synthetically with no replay. A cold request parks as a waiter. An image may declare a **session-history provider**: it fills the log with no harness process, and the first prompt rehydrates the harness (a silent `session/load`, replay dropped). Otherwise, or on provider failure, the runtime's own `session/load` fills the log, reaching no client. Waiters are then served from the log, shielding the UI from per-harness gaps and the cold-subprocess problem.

#### Prompt delivery

A session runs one turn at a time. A prompt arriving while a turn is in flight is **queued** rather than refused or forwarded, then promoted when the turn ahead of it ends; a queue already at capacity rejects further prompts as an error on the send that names its cause structurally, so a sender can tell a full queue from any other refusal and say so in the user's own terms rather than the runtime's. So a prompt has three fates its sender cares about — **accepted** (the runtime has it), **queued** (parked behind an earlier turn), and **started** (handed to the agent, where delivery becomes real) — and only the runtime can tell them apart.

The runtime therefore reports them, over the same channel extension as the end-of-turn signal: one notification announcing acceptance and whether the prompt was queued, one announcing that it has started. Both carry a sender-minted prompt identifier, so a sender knows which of its prompts is meant; the identifier rides as platform metadata on the prompt and is stripped before the agent sees it, leaving the agent's view unchanged. A sender that mints none — the CLI, channel workers, an older client — gets no notifications and behaves as it always did. Both notifications are **sender-only and ephemeral**: addressed to the originating channel, never logged and never replayed, because they describe the fate of one send rather than anything that happened in the conversation. Field-level contract: [`packages/api-server-api/`](../../packages/api-server-api/).

This makes **the server authoritative about delivery**, which is the point: watching for content cannot separate "parked behind a running turn" from "never arrived", since a legitimately queued prompt produces nothing for as long as the turn ahead of it runs. Inferring failure from silence is what made the delivery indicator claim a prompt was lost when it was only waiting. A client fails a prompt on evidence instead:

- **No acceptance within a bounded wait** — the true delivery check, normally a matter of milliseconds. Unacknowledged this long means it never arrived. A drop before acceptance carries the socket's stated cause when it gave one, unattributed: the relay writes that text as often as the runtime does.
- **Waiting is unbounded.** A queued prompt is never failed for waiting, however long the turn ahead of it runs. The user is told it is waiting, which is true.
- **The sender's connection drops while its prompt is still queued.** The one loss the runtime cannot report, since reporting it needs the channel that just went away — so the sender raises it locally and keeps it raised across the reconnect that follows. That reconnect replays the log, which misleads here: the dropped prompt's echo is in it, and no reply ever will be.

That last rule covers ordinary loss, not a corner case, because **the queue is lossy by design**: queued prompts belong to the channel that sent them and are discarded when it detaches, and go with the session when the pod recycles or the agent exits. It is a scheduling convenience, not a durable buffer — nothing survives to re-deliver, which is why the loss is surfaced to the person who can act on it. Recovery is always a fresh send the user initiates: an automatic resend cannot know whether the prompt was dropped before or after the agent saw it, so it risks running the prompt twice. A prompt already *handed to the harness* is the other side of that split: losing the channel then costs the sender its live view and nothing else — the turn runs to completion and its output is appended to the log, so any later viewer replays it in full. Every client that reports delivery honestly depends on this split ([channels](channels.md) states it for its own surface).

One failure is deliberately **not** detected: an agent alive but permanently stuck emits nothing and is indistinguishable from one thinking hard, so a prompt waits indefinitely — parked behind a stuck turn, or already handed to the agent. Silence after acceptance is timed nowhere: a deadline there fails healthy turns whose first word is merely slow, and a red failure beside a working turn teaches the user to distrust the indicator. It waits *honestly* — the indicator still says waiting, which stays true — and telling wedged from slow is a separate problem from delivery.

When a session goes idle — no engaged channel, no prompt active or queued, no agent request pending — the runtime sends `session/close` to the harness. The per-session subprocess is reaped; the next attach respawns it. Permission requests with no engaged channel time out after ten minutes, answered to the agent as an error so the tool call aborts cleanly. A harness that leaves a session load unanswered is wedged: that load's frames are suppressed (its replay carries no request correlation, so a second load is indistinguishable) and the process is recycled when work drains.

One further condition holds that reap back: **background work the session
reports**. Closing a session tears down the harness's per-session subprocess, and
a harness that supervises background jobs kills them as it goes, so a job an agent
left running would die seconds after the last tab closed. ACP carries no signal to
consult — a session emits nothing between turns, and `session/close` is specified
to cancel any ongoing work — so the platform asks instead of inferring. A session
reports its **complete in-flight set** to the runtime's in-pod surface, as a level
rather than start/stop edges, and while that set is non-empty the runtime will not
close the session and reports itself busy, so the [idle checker](#hibernate)
cannot hibernate the pod underneath the work. An empty report ends both. Reporting
is optional: a harness that never reports behaves exactly as it did before the
contract. What is held is published on the runtime's status surface, so an agent
that stays awake can be explained by the work holding it.

Only work a harness *supervises* reaches its report, which bounds what the
contract promises. A job the agent detached from the harness is invisible to it,
and what is reported can be adjacent to the real work — a detached loop whose
progress a supervised log tail watches holds the session for the tail. Nothing
times a hold out, so an agent with reported work does not scale to zero until
that work ends; a [hard stop or pause](#hibernate) reclaims it regardless, and an
install can refuse holds outright.

Terminal-mode sessions follow a different model from the chat path above. agent-runtime accepts at most one WebSocket per `sessionId` on `/api/terminal`, allocates a PTY, spawns `harness-terminal` attached to it, and pipes raw bytes both ways. Scrollback is tracked so that reattaching while the PTY lives replays it. A detached PTY is reaped on idleness, not on viewer loss: after a short detach grace it is killed only once the harness has also gone quiet. Liveness keys on harness output rather than viewer presence, so in-flight work (a running build, a streaming response) survives switching away and can be reattached live, while an abandoned idle prompt is cleaned up. There is no append-only log, no fan-out, and no `session/resume` — terminal sessions belong to one viewer at a time, and the harness's own on-disk session store is the only durable record.

SSH sessions are unrelated to the session/mode machinery above — they carry no `sessionId`, no DB row, and no harness involvement. agent-runtime accepts a WebSocket on `/api/ssh`, spawns a per-connection OpenSSH `sshd -i` (inetd mode) as the agent user, and relays raw bytes verbatim between the socket and the child's stdio. SSH terminates at that sshd, which authenticates a CLI-registered public key (`ssh.authorizeKey`) and drops into a plain `/bin/bash` login shell; the api-server and CLI never parse the SSH wire. sshd resets the environment before that shell, so agent-runtime rebuilds `~/.ssh/environment` from the live injected env on each connection — the SSH session gets the same proxy routing and credentials the harness has, rather than a bare env with no working egress, and picks up connection/credential changes injected since boot on the next reconnect. Concurrent SSH connections to one agent coexist (each its own `sshd`), and the endpoint exists only on images that ship `sshd`. Like the terminal and chat relays (passive connections excepted — they take no pin), an open SSH connection marks the agent `active-session`, so it will not hibernate while connected — close the editor/session to let it idle down. Two safety nets keep that pin honest: a WS ping/pong releases it if the connection half-dies, and pins orphaned by a replica that died holding sessions are swept by a periodic reconcile — each replica refreshes a short-TTL Redis presence key per agent it holds sessions for, and the reconcile clears the annotation once no replica's key remains.

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

Switching a session's mode (e.g. chat → terminal) is metadata-only: the switching client persists the new mode over ACP, which the runtime merges into its session-metadata store. The running harness is unaffected — mode is a UI hint about which surface (chat vs. terminal PTY) to render. The metadata write raises a session-watch notice, so other clients re-read and follow. The `--reset` / terminal-reset path is independent: it closes the terminal WebSocket and resets the runtime session, dropping everything the runtime held for that session id.

Beyond ACP frames, agent-runtime also serves a tRPC surface on the harness port for skill install / uninstall / scan / publish / listLocal. The api-server is the sole caller; the skills-*management* calls wake a hibernated pod through the reachability primitive (above) before reaching it, while the read paths (`state` / `listLocal`) degrade gracefully and never wake. Skill files land on the PVC under the configured Skill Paths and are picked up by the harness on the next session start (no hot-reload). See [agent-skills](agent-skills.md).

The **target** lifetime model is single-use Kubernetes Jobs per turn, with a Redis-backed read cache for lightweight queries and a two-tier PVC layout (per-session + shared). Migration is on a parallel track and not blocking. The current prototype uses the persistent runtime described above.

### Hibernate

Hibernation scales an idle Agent's StatefulSets to zero to reclaim its pod's CPU and memory; the next activity wakes it (see [Wake](#wake)). Whether an Agent is "idle" is **derived from observed activity, never stored** — there is no desired-state flag — and the derivation is split across two independent checks.

**The decision.** The controller's idle checker scans Agents on a timer whose interval scales with the timeout, skipping any already at rest — pair observed at zero *and* hibernation published. For the rest it hibernates only when *both* checks below agree it is quiet:

1. **Activity annotations** — the same `shouldRun` gate the reconciler uses to scale *up*, so scale-down and scale-up can never disagree. The Agent stays awake while `active-session` is set, or while `last-activity` falls within the idle timeout. The gate fails open — a missing or unparseable stamp keeps it running — so hibernation only ever follows a *positive* idle signal, never absent data.
2. **agent-runtime's live `idle` flag** — before scaling down, the checker probes the pod. The runtime is authoritative about its own idleness and reports one boolean; the controller reads nothing more into it. An unreachable pod counts as *not busy*, which permits hibernation.

**What counts as activity.** Those two checks rest on three signals, each catching something the others miss:

- **agent-runtime (`idle` flag).** Busy while a prompt turn is in flight, while prompts queue behind it, while an agent-initiated request (e.g. a permission prompt) awaits the client, while a session reports background work still running ([above](#session-inside-the-pod)), or while a terminal (PTY) is open — an open-but-idle terminal counts, because the open PTY *is* the signal. It does **not** see SSH, which runs as its own `sshd` outside the runtime's PTY tracking. A chat is the exception to "open connection = busy": an attached chat with no turn running reads as `idle` here, since the flag tracks work, not watchers — such a chat stays awake via `active-session` below, not this probe. What the probe uniquely catches is in-flight work that no connection holds and `last-activity` no longer covers: a scheduled run outlasting the idle timeout, or a turn still running after its tab closed.
- **api-server (`active-session` annotation).** A refcount of open chat, terminal, and SSH connections — set on the first, cleared on the last, regardless of traffic. So a chat merely open in the UI keeps the Agent awake, exactly as an open terminal does. Since the probe is blind to SSH, an SSH session leans on this annotation, which alone suffices while the connection is open. A half-dead connection is reclaimed by a WS ping/pong, and pins orphaned by a dead replica are swept by a periodic reconcile over per-replica Redis presence keys (the keys expire by TTL when their replica stops refreshing them).
- **api-server (`last-activity` annotation).** The one traffic-driven signal, and the clock the idle timeout measures against. Bumped, debounced, by any relay or proxied call as bytes flow, by an explicit wake, and by the scheduler on a fire.

None of this depends on *who* opened the session: the UI, a connected channel, and the CLI all dial the same three relays, so a session's signals follow its **kind** — chat, terminal, or SSH — not its caller. A CLI terminal is covered by both checks like a UI terminal; a CLI SSH session is seen only by the annotations, never the probe — like any other SSH.

**The blind spot — unreported work.** The signals above see sessions, connections, and background work a session [reports](#session-inside-the-pod). What none of them see is work nobody reports: a job the agent detached from its harness, anything a non-reporting harness leaves running, a batch pipeline with no session behind it. For that work `active-session` is clear, `last-activity` ages out, the runtime reports `idle`, both checks agree, and the controller hibernates the pod **mid-job, killing the work**.

That remainder is deliberate. The platform *can* see that processes are running in the pod — what it cannot do is tell what they *are*: a working batch job looks no different from an always-on model gateway, a language server, or an orphan a dead session left behind. Keying on mere existence inherits that ambiguity, pinning the pod open forever on idle infrastructure or letting one leaked process defeat hibernation outright. Reported work escapes the ambiguity because something that knows declared it; unreported work offers nothing to stand on. The session reap is no threat to it either — work its harness doesn't supervise survives `session/close` precisely because nothing kills it there — so hibernation is its only killer.

**The per-agent hibernation timeout.** Since the platform can't *detect* that work, it lets an operator *budget* for it. Each Agent carries an optional timeout override: unset inherits the cluster-wide default, a positive value sets a per-agent idle window in minutes, and **`0` disables hibernation** so the Agent never scales down. A Template can seed this override, so every Agent created from it starts with a chosen default rather than the cluster-wide one — a workload image whose real work runs off-session (e.g. a Nous experimentation campaign) ships a *never-hibernate* default so the idle checker can't reclaim its pod mid-run; a user's explicit choice at create time still wins. The controller resolves the effective value (override else default) and feeds it to the same `shouldRun` gate used for scale-up and scale-down. The agent settings expose it as a minutes field showing that *effective* value, so an Agent with no override displays the inherited default, not a blank.

It's a blunt instrument, not a fix for the blind spot: a longer window (or `0`) on an Agent with known no-session work keeps it alive to finish, but doesn't make that work visible. The cost is real — there's no auto-reclaim, so a long or disabled timeout holds CPU, memory, and the harness open until lowered by hand; on an interactive Agent it just forfeits scale-to-zero for nothing.

The pod terminates; the PVC, Secret, Service, and NetworkPolicy persist. Workspace state survives — the git checkout, `node_modules`, `.venv`, mise cache, and `$HOME` are all on the PVC and rejoin on the next wake. Anything written to the container's ephemeral filesystem (OS-level changes, tools installed outside `$HOME`) is lost; this is a deliberate constraint of the lifetime model.

**The hard stop and pause (#1900).** The user-initiated scale-downs, built to free [Reserved compute](budgets.md) without waiting for the idle checker — including reclaiming an Agent pinned awake by an open session. The api-server stamps `agent-platform.ai/stop-requested` (and clears the session pin); `shouldRun` treats the stamp as an overriding *negative* signal, and the reconciler scales the pair to zero immediately, bypassing the busy probe — a hard stop may interrupt work by design. The stop is **sticky**: background activity (UI polling, relay reconnects, proxied calls) never clears it — `ensureReady` on a stopped Agent fails with a typed *stopped* error instead of bumping — so an open tab cannot resurrect it. Only deliberate paths clear the stamp and restart the Agent (back through the budget gate): an explicit wake, and a schedule fire — schedules override a stop by design, and the UI warns at stop time when the Agent has any. Once scaled down, a stopped Agent looks like any hibernated one.

**Pause** is the non-sticky sibling: the same stop stamp — plus a *staled* `last-activity`, so the Agent stays down once un-stuck — which the api-server clears itself once the Agent settles Hibernated (a settle-watcher polls for up to a minute; on failure the stop stays — fail-safe strict, one wake recovers). The clear is a **compare-and-clear** of the exact stamp the pause wrote: a stop (or second pause) issued during the settle window carries a newer stamp and stays sticky rather than being erased by the watcher. The transient stickiness during the descent is load-bearing — it is what keeps background polls from resurrecting the pair before it lands; staling the clock in the *initial* patch (never at settle time) is what keeps the watcher from ever clobbering a concurrent wake. A paused Agent is afterwards a plain hibernated Agent: its next deliberate use wakes it. One nuance: a **never-hibernate** Agent (effective timeout `0`) runs regardless of activity, so its pause degrades to the sticky stop — the only stable "paused" it can have.

**Early reclaim for a blocked start (#3184).** The one scale-down neither the user nor the idle timeout asks for: when the [budget gate](budgets.md#reclaiming-room-for-a-blocked-start) refuses a start, it may hibernate that same owner's *unattended idle* Agents ahead of their timeout to admit it, longest-idle first and only when the freed Sizes provably cover the shortfall. Eligibility is deliberately narrower than the idle checker's, since reclaim takes down a pod whose own timeout still permits it to run: session and Experiment pins, sweepable Invocation targets, and never-hibernate Agents are all excluded, and survivors are probed the same way. A reclaimed Agent is marked as having **spent** the activity stamp it was reclaimed under, so `shouldRun` keeps it down until a *newer* bump arrives — otherwise its own next reconcile, still inside its timeout, would reclaim the room right back. It is otherwise an ordinary hibernated Agent: the mark self-clears when a deliberate touch outdates it, and the next use wakes it back through the gate.

### Delete

The api-server deletes the Agent custom resource. The controller's reconciler tears down the owned StatefulSet, Service, NetworkPolicy, and Secret. Sessions are agent-owned files on the PVC and disappear with it. The controller reclaims the agent's workspace PVCs explicitly (StatefulSet `volumeClaimTemplate` PVCs are not cascade-deleted by K8s). In-flight Runs are owner-refed to the Agent CR, so Kubernetes garbage-collects them automatically. The api-server owns none of this: it never touches PVCs, and only deletes the Secrets it wrote — the per-channel credential Secrets and, via a cleanup hook, the agent-scoped image-pull Secret (a label-scoped orphan sweep backstops a missed delete).

Schedules are independent Postgres rows and survive Agent deletion as orphans unless the deletion path explicitly cascades.

## `dam-run` — local exec shim

The in-pod `dam-run` CLI is a compatibility shim: `dam-run <cmd>` now simply runs the command as a regular local process in the same pod, inheriting stdio, cwd, and environment. Scripts and harness prompts that call it keep working unchanged; there is no remote hop, no `Run` resource, and no relay.
