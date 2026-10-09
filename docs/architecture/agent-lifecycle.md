# Agent lifecycle

Last verified: 2026-10-09

## Overview

An **Agent** is the durable, owned, runnable resource. It is a custom resource whose `spec` the api-server owns and whose `status` the controller writes; its StatefulSet scales between zero and one replica as the Agent hibernates and wakes. **Sessions** live inside a running pod: each ACP session is a short-lived conversation that the pod's persistent agent process serves. The lifecycle is driven by three actors:

- **Users** drive both management and sessions, but along different paths. The **UI** is the only management surface — creating, configuring, hibernating, and deleting Agents all flow through tRPC on the api-server's public port, which is the sole writer of the Agent spec. Sessions can be driven from the UI **or** from a connected channel (Slack, Telegram). Channels never hit management endpoints; they dial the api-server's ACP relay only, with identity scoped to the individual messenger user driving the session. Channel internals live on [channels](channels.md).
- The **api-server's scheduler** fires triggers on RRULE occurrences, delivers them durably over the runtime channel's outbox, and pokes the Agent awake so a fire lands even on a hibernated Agent ([schedules](schedules.md)).
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
  Note over P: a fire with a Precheck settles on acceptance<br/>and decides afterwards; one without settles<br/>once the prompt is submitted
  P->>API: report the Precheck verdict, whichever it was
  Note over P: then opens an in-process ACP session<br/>(session/new or session/resume),<br/>submits the task as a prompt<br/>— unless the Precheck declined
  Note over P: undelivered events expire after a TTL

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

Creation is per-purpose: the plain create picks an image, and a [starter kit](starter-kits.md) apply is the entry for anything preconfigured. The **Agent Kind** marker survives only on agents stamped before kits: a knowledge base is now a kit that declares one capability, and a marker the platform no longer knows reads as no kind at all. A kit apply is the plain create with the kit's grants, followed by the kit's schedules and channel binding, compensated by delete on failure. A new agent takes its template's size and the trusted egress preset — or, for a kit that declares either, the kit's — both editable afterwards, plus a Backend the template has no say in: a container, or a microVM. A plain create names neither a harness nor a provider, since each session picks both ([below](#session-inside-the-pod)): it boots the default Template on the install's default harness and grants the caller's IBM LiteLLM provider Connection, else their earliest-created one, that the harness runs on. A custom-image Template names the harness it wraps, if any, and may list its providers. Only a template create gets a default provider; a bare image and a [sub-agent](invocations.md) hold only what they name. A create may also name a repository to seed into the work directory before the first session; it rides the runtime channel rather than the pod spec ([runtime delivery](runtime-delivery.md#event)). See [knowledge-bases](knowledge-bases.md) for what a knowledge base adds on top of what follows.

The api-server writes a new Agent custom resource whose spec carries the Agent's image / mount declarations (copied from a Template at create time, if any), env, and secret refs. There is no stored desired state — running-vs-hibernated is observed status the controller derives from activity. The controller reconciles a paired set of owned resources: two StatefulSets (the agent and its gateway), two Services (the agent's headless ACP and the `<agent>-gateway` proxy), agent-egress and gateway-ingress NetworkPolicies, and a per-Agent Envoy bootstrap ConfigMap + leaf TLS Certificate. On the `vm` Backend the agent StatefulSet and its workspace PVC are not rendered at all: the Agent's storage is one disk on the owner's [VM runner](vm-runner.md), holding HOME and nothing else ([persistence](persistence.md)), and the agent Service selects that runner rather than a pod of its own.

When the create request carries a private-registry credential, the api-server writes an agent-scoped `dockerconfigjson` pull Secret *before* the Agent CR and rolls it back if that write fails; the controller hands that Secret first, ahead of any install-wide default, to whatever pulls the image — the kubelet, or on the vm Backend the owner's runner. It never enters the agent, and a bad one surfaces as a pull failure rather than a create-time error. See [security-and-credentials](security-and-credentials.md#image-pull-credentials).

Every harness ships in one image; a workload's image adds its own files ([agent-images](agent-images.md)). The platform contract is two fixed-path executables: a chat entrypoint (spawned as the ACP subprocess for chat-mode sessions) and a terminal entrypoint (spawned attached to a PTY for terminal-mode sessions, told which session to resume). agent-runtime otherwise treats the harness as opaque. It also reserves the loopback **Artifact API Port** for the Agent's own [Artifact API](artifact-library.md#interactive-pages): the platform never starts anything there, and a server left running on it does not keep the Agent awake. The workspace PVC is provisioned on first wake and survives subsequent hibernations — unless the warm pool is enabled and a pre-provisioned spare matches the mount's size, in which case the controller claims that already-bound spare at create time so first start skips the provisioning wait. See [persistence](persistence.md#warm-pvc-pool).

Pod env at start is composed by the controller from platform wiring only — last occurrence wins, with `PORT` server-enforced:

1. **platform envs** — proxy + auth wiring rendered by the controller (`HTTPS_PROXY`, harness URL, ext-authz routing, etc.).
2. **chart-level platform defaults** — any `env` the install declares as defaults.

Everything tied to an Agent's *configuration* rides the runtime channel as contributions instead, never the pod spec: connection-derived env (credential placeholders the gateway swaps on the wire; a provider Connection's in a layer of its own), user-typed env (the Environment editor), template env, and file contributions. The api-server stores user-typed and template env in Postgres and delivers all configuration at the next idle turn with no pod roll, ordering user env ahead of connection/secret env so it wins on a name collision. Template env is seeded at create time only, so editing a Template never re-flows into a running Agent. See [connections](connections.md) and [runtime delivery](runtime-delivery.md).

### Template upgrade

Templates are captured at create time; an install upgrade does not reconfigure existing Agents. The api-server reports an update when an Agent's image differs from its Template's current image. Retired per-harness templates resolve to the default Template even when an install retains their old definitions, so their Agents move to the coding image. The upgrade preserves the Agent's chosen harness; when an older Agent has no explicit choice, its retired template identifies the harness to carry forward.

Users apply upgrades individually or in a batch, confirming the target images and restart cost. The api-server refuses a target that changed since confirmation. A running pair or vm machine restarts; a hibernated Agent takes the image on its next wake. No configuration is re-seeded: template env stays frozen to preserve user edits, and mount/storage changes still require recreating the Agent. A runtime advertising kinds its predecessor did not is re-delivered the Contributions the old image refused, closing the capability gap ([runtime-delivery](runtime-delivery.md#capability-negotiation)).

### Wake

Every caller that sends work to a pod — the api-server's ACP relay, channel adapters, skills management — routes through a single reachability primitive in the api-server. The primitive's contract: **the controller-published `Ready` condition is the authoritative answer to "can I call this pod?"** The primitive pokes activity by bumping the `agent-platform.ai/last-activity` annotation (the reconciler scales up any Agent with recent activity), single-flights concurrent waits per Agent, and bumps the same annotation on every successful call, so any caller implicitly keeps the pod warm. The deliberate opt-outs both check the same `Ready` condition without waking anything and fail closed when the pod isn't up: a **passive** relay connection (`passive=1`) takes no pin and never bumps activity, and the per-agent tRPC relay takes no pin but keeps the stamp fresh while a view is open.
Contributions are applied out-of-band by a single background worker (a pod's `hello` is presence-only — it just signals the worker to dispatch). The worker dispatches **only to a Ready agent** — the same readiness gate the relay's `ensureReady` uses — so an apply never targets a pod that is down or rolling; when the agent isn't Ready the outbox row stays unsettled and the periodic sweep re-dispatches once it is. Each apply runs every contribution to termination and records which drivers failed; a degraded agent (failed installs retrying in the background, capped) surfaces via its `contributionFailures` badge and never wedges. Readiness itself does **not** wait on contributions — configuration applies in the background.

Three paths trigger a wake:

- **Connect-driven** — the api-server is about to forward an ACP frame to a hibernated Agent and ensures readiness before the relay completes. The frame can originate from a UI tab attaching to a session or from a channel worker (Slack / Telegram) routing an inbound message to its bound session.
- **Schedule-driven** — a schedule fire commits a `trigger` event to the runtime outbox, then pokes the Agent awake without waiting for readiness; the boot-time `hello` catch-up delivers the event once the pod is `Ready`, and the event's TTL bounds how stale a fire can land (see [Schedule fire](#schedule-fire)).
- **Skills-management-driven** — install / uninstall / private-source scan / publish all route through the same primitive before reaching the agent (scan and publish reach agent-runtime directly over the harness port; install/uninstall keep the pod warm so the apply worker dispatches the bumped outbox). See [skills](skills.md).

Wake is bounded — the primitive polls pod readiness with backoff and gives up after two minutes, and a per-replica watch releases each wait the moment the condition flips and backs a read cache. A read bypasses that cache when its result decides a write — spec read-modify-write, the pause flow's compare-and-clear — and while the watch is unsynced, when the cache cannot tell an absent Agent from an unseen one. On giving up it reads the controller's readiness conditions one final time and classifies the failure into a typed wake-failure cause — hibernation never acted on, a pod start failure (with the controller's termination cause), pods still progressing, a gateway still coming up, a gateway failure it cannot outgrow, or a reconcile error — which callers receive and surface in their own idiom (channel reply copy, WS close reason, HTTP body, skills call error). The classification distinguishes transient causes (progressing, worth waiting or retrying) from hard ones (needing intervention); the two gateway causes split along exactly that line. A gateway wedged on a superseded configuration counts as hard even though the platform replaces such pods by itself ([security-and-credentials](security-and-credentials.md)): classification runs only once the budget is spent, so a repair that was going to land already had its chance. The primitive also records wake begin/success/timeout with duration and the condition snapshot, so wake latency and failures are diagnosable from the log store. Callers can additionally register for a cold-start signal, fired when a call enters (or joins) a wake wait, to tell their user a wake is underway. The schedule-driven poke is the exception: it doesn't wait, so there is no bounded wait to fail.

The UI holds a start to the same budget: past it, it offers Restart and the controller's not-ready message, timed from when it first saw the Agent starting.

### Schedule fire

A Schedule fire is the one wake nobody is waiting on: the api-server commits the fire durably, pokes the Agent awake without waiting for readiness, and the Agent decides on arrival what the fire becomes — including declining it outright when the Schedule carries a Precheck. Arming, firing, the Precheck and the Session each fire opens are owned by [schedules](schedules.md).

### Session inside the pod

agent-runtime holds one harness process, a **Harness Lease**, per harness, provider Connection and model its sessions ask for: the model reaches the harness as its process env, never as a switch inside a live session, and changing a session's model moves its next turn to that model's lease. A lease outlives connections. ACP channels attach concurrently and engage sessions by the `sessionId` each frame carries.

Each lease is the unchanged ACP runtime this section describes, behind a **lease router**. `session/new` names the session's harness, provider and model; the runtime persists that pair in its session-metadata store, so later frames, and a load or resume after a restart, route back to the same lease. A session naming none runs on the default harness and first granted provider, and keeps that pair. Leases spawn lazily, each told about the client as the first was, and an agent's question is answered to the lease that asked. The default lease stays; any other shuts down once it holds no session, and one whose harness crashes is dropped for the next session to respawn. The session list draws on the metadata store too, so a harness not running still lists its sessions.

A lease spawns with the agent-wide env, its own provider's layer and its harness's layer ([connections](connections.md#contribution-fan-out)), then the pod's process env, then its harness, provider and model. Revoking a provider recycles only the leases on it; a prompt or setting sent to a session on a removed provider fails with a structured *provider removed* error naming it, and granting it again resumes the session.

Each session is an append-only in-memory log (≤2 MB soft cap; inline image and audio bytes give way to a placeholder before any entry is evicted). Every channel keeps a per-session cursor; new events append to the log and fan out to engaged channels that have not yet seen them. Every entry the runtime appends live carries the wall-clock time it was written, as platform metadata on the frame; an entry filled in from a replay carries only what its source supplied, never a time the runtime invented. From a session-history provider that source can also supply the harness's own name for the prompt a reply answered — the prompt id by which [agent-telemetry](agent-telemetry.md#progressive-disclosure) joins a reply to its Turn once the Session is loaded.

The runtime also tells engaged viewers when a scheduled fire begins its turn, and a load hands back the fire start times the session still holds — the newest, under a bound [persistence](persistence.md) owns. A thread draws each of those beside the prompt that opens its run, so a run boundary survives a reopen. A start whose prompt is not in view — older than the loaded tail — sits above the first message after it, and only the newest such start draws there, since one message opens one run; a start with no timed message to sit beside at all draws nothing.

A `session/load` that opts in replays **only the newest tail** of the log, bounding the open cost at any length; without the opt-in the whole log replays, per ACP. The response reports any cut, with a cursor when the older range is still in the log; a load presenting that cursor is paged the older range, down to the eviction floor (cut without cursor). Cursors die with the log: a stale one is refused and the client reloads. Replay shares the connection with live fan-out, so replayed frames are tagged to their load for exact attribution.

Both verbs are runtime-mediated: a hot `session/resume` engages the channel and answers synthetically with no replay. A cold request parks as a waiter. An image may declare a **session-history provider**: it fills the log with no harness process, and the first prompt rehydrates the harness silently, replay dropped — with `session/resume` where the harness advertises that session capability, `session/load` otherwise. Resume is the better fit: the log already holds the history, so a harness that streams its replay only after answering the load would otherwise duplicate it. Otherwise, or on provider failure, the runtime's own `session/load` fills the log, reaching no client. Waiters are then served from the log, shielding the UI from per-harness gaps and the cold-subprocess problem.

#### Prompt delivery

A session runs one turn at a time, and one scheduler is the only place a prompt waits. A prompt is **queued** rather than refused or forwarded whenever its session cannot take it — a turn already running, no channel engaged to read the answer, or the harness not yet holding the session — and promoted the moment that clears — a scheduled fire is **unattended**, its sender gone once the prompt is accepted and nobody reading the turn live, so it waits on the harness alone and never on a channel; a queue at capacity rejects further prompts with an error whose cause a sender can tell from any other refusal. So a prompt has three fates its sender cares about — **accepted** (the runtime has it), **queued** (waiting for its session to be able to take it), and **started** (handed to the agent, where delivery becomes real) — and only the runtime can tell them apart.

The runtime therefore reports them, over the same channel extension as the end-of-turn signal — which is logged and replayed, and names the ending turn's prompt id and stop reason: one notification on acceptance (and whether the prompt queued), one when it starts. Both ride a sender-minted prompt id as platform metadata, stripped before the agent sees it and used to group the prompt's echo in the log; a sender that mints none — channel workers, older clients — gets no notifications and behaves as before. Both are **sender-only and ephemeral** — never logged or replayed, since they describe one send's fate, not the conversation. Field-level contract: [`packages/api-server-api/`](../../packages/api-server-api/).

This makes **the server authoritative about delivery**, which is the point: watching for content cannot separate "parked behind a running turn" from "never arrived". A client fails a prompt on evidence instead:

- **No acceptance within a bounded wait** — the true delivery check, normally a matter of milliseconds. Unacknowledged this long means it never arrived, and the failure carries the socket's stated cause when it gave one.
- **Waiting is unbounded.** A queued prompt is never failed for waiting, however long the turn ahead of it runs. The user is told it is waiting, which is true.

A connection that drops while its prompt is still queued raises nothing on the client, because the queue survives the departure: queued prompts belong to the conversation, not to the channel that sent them, so the last channel leaving **parks** the queue for a grace window, and a client engaging again within it resumes it. A queue holding only unattended fires is never parked: nobody is coming back for it, and it needs nobody. A queue leaves the scheduler by four routes — the window expiring, the session forgotten, the scheduler cleared when the harness goes down, or a session the harness cannot load back refusing its queue — and all but the refusal record the queue's prompts as **undelivered** in a durable document on the pod, whole, inline images capped; the refusal errors each sender instead. Each session load hands the records back, marked on the conversation to send again or delete, and says whether a turn is still running; a record sent again or deleted is **retired** so its earlier echo drops from the replay rather than doubling. Recovery is always a send the user initiates: an automatic resend cannot know whether a prompt was dropped before or after the agent saw it, so it risks running it twice. A prompt already *handed to the harness* is the other side of that split: losing the channel costs the sender only its live view — the turn runs to completion and its output lands in the log for any later viewer. Every honest delivery report depends on this split ([channel-turns](channel-turns.md) states it for its surface).

One failure is deliberately **not** detected: an agent alive but permanently stuck emits nothing and is indistinguishable from one thinking hard, so a prompt waits indefinitely. Silence after acceptance is timed nowhere — a deadline there fails healthy turns whose first word is merely slow — and telling wedged from slow is a separate problem from delivery.

**Surviving memory pressure.** The harness and its tool processes share one memory ceiling, so a runaway command would take the whole agent down with it. Which ceiling depends on how the agent runs: a container is capped by its cgroup, while a machine on the `vm` Backend has no cgroup limit at all and is bounded by its own memory, read from the kernel's headroom estimate so that reclaimable cache is not mistaken for consumption. A container that carries no cgroup limit is left unwatched rather than measured against the node it shares, whose memory a neighbour moves. agent-runtime pushes back first: nearing the limit it kills the largest tool process, sparing every harness and the conversation processes any carried harness's manifest names, so the agent recovers mid-turn; only when those are the hog does the kernel's kill land. A turn that dies anyway is recovered from an [active-turns marker](persistence.md) surviving to the next boot: it resumes on its own, up to five times, with a notice to pick the task back up. The marker is written only after the harness *took* the prompt, so resuming continues a turn the agent already saw — not the [no-auto-resend](#session-inside-the-pod) of a prompt it never got.

When a session goes idle — no engaged channel, no prompt active or queued, no agent request pending — the runtime sends `session/close` to the harness; a parked queue counts as queued work, holding the release back until its window passes. The per-session subprocess is reaped; the next attach respawns it. Permission requests with no engaged channel time out after ten minutes, answered to the agent as an error so the tool call aborts cleanly. A harness that leaves a cold re-attach unanswered — whichever verb it advertised for one — is wedged: that request's frames are suppressed and the process is recycled when work drains.

One further condition holds that reap back: **background work the session
reports**. Closing a session kills the background jobs a harness supervises, and
ACP carries no signal to consult — `session/close` is specified to cancel ongoing
work — so the platform asks instead of inferring. A session reports its
**complete in-flight set** to the runtime's in-pod surface, as a level rather
than edges, and while it is non-empty the runtime neither closes the session nor
reports itself idle, so the [idle checker](#hibernate) cannot hibernate the pod
underneath the work. Reporting is optional, and what is held is published on the
runtime's status surface.

Only work a harness *supervises* reaches its report; a job detached from it is
invisible. Nothing times a hold out, so only a [hard stop or pause](#hibernate)
reclaims the pod early, and an install can refuse holds outright.

Terminal-mode sessions follow a different model from the chat path above. agent-runtime accepts at most one connection per terminal session, runs the terminal entrypoint in a PTY with the env of the harness and provider its WebSocket names, and pipes raw bytes both ways. A session on a removed provider or an unknown harness closes with the reason. Scrollback is tracked so that reattaching while the PTY lives replays it. A detached PTY is reaped on idleness, not on viewer loss: after a short detach grace it is killed only once the harness has also gone quiet. Liveness keys on harness output rather than viewer presence, so in-flight work (a running build, a streaming response) survives switching away and can be reattached live, while an abandoned idle prompt is cleaned up. There is no append-only log, no fan-out, and no `session/resume` — terminal sessions belong to one viewer at a time, and the harness's own on-disk session store is the only durable record.

SSH sessions are unrelated to the session machinery above: they carry no session identity, no metadata entry, and no harness involvement — a per-connection in-pod OpenSSH the platform relays bytes to, with its own authentication and its own shell, several coexisting per agent. The transport and its auth belong to the CLI surface that uses it ([cli](cli.md#ssh-access)) and to agent-runtime's relay duties ([platform-topology](platform-topology.md)). For lifecycle an SSH connection matters only as a pin: while it is open the Agent will not hibernate, and the runtime's own idleness probe cannot see it ([Hibernate](#hibernate) states which signal carries it and how a lost connection's pin is reclaimed).

Beyond per-session children, agent-runtime supervises at most one **pod
service** — an optional
background process the agent image provides at a well-known path, running for
the life of the pod. The runtime spawns it once the runtime-channel env is
first materialized, restarts crashes with capped backoff, and reads a clean
exit as "nothing to do for this env" until the env next changes. An env
rewrite refreshes a well-known env snapshot file and sends SIGHUP: a service
reloads in place, or dies by the signal and is respawned with the fresh env. Its output joins the pod log stream. The pod's
PID 1 is a minimal init (catatonit) wrapping agent-runtime, so descendants
the runtime did not spawn — processes orphaned by a dying harness or service
— are reaped rather than left as zombies. claude-code uses the hook to front
custom Anthropic-compatible upstreams with a local model gateway, each provider apart;
images without a pod service are unaffected.

Switching a session's mode (e.g. chat → terminal) is metadata-only: the switching client persists the new mode over ACP, which the runtime merges into its session-metadata store. The running harness is unaffected — mode is a UI hint about which surface (chat vs. terminal PTY) to render. The metadata write raises a session-watch notice, so other clients re-read and follow. The `--reset` / terminal-reset path is independent: it closes the terminal WebSocket and resets the runtime session, dropping everything the runtime held for that session id.

Beyond ACP frames, agent-runtime also serves a tRPC surface on the harness port for skill management and skill reads. The api-server is the sole caller; management calls wake a hibernated pod through the reachability primitive (above) before reaching it, while reads degrade gracefully and never wake. Skill files land on the PVC under the configured Skill Paths and are picked up by the harness on the next session start (no hot-reload). See [agent-skills](agent-skills.md).

### Hibernate

Hibernation scales an idle Agent's StatefulSets to zero to reclaim its pod's CPU and memory; the next activity wakes it (see [Wake](#wake)). On the `vm` Backend the gateway scales the same way and the agent side is the machine on the VM runner, which stops on the way down and starts on the way up — a stopped machine keeps its disks, so a wake is a boot of the same guest. Only the idle checker or [reclaim](vm-memory.md) hibernates it, not a lapsed timeout. An unreachable runner does not hold the gateway up. Whether an Agent is "idle" is **derived from observed activity, never stored** — there is no desired-state flag — and the derivation is split across two independent checks.

**The decision.** The controller's idle checker scans Agents on a timer whose interval scales with the *shortest effective timeout it saw last sweep* — an Agent that chooses a window far below the cluster-wide default is swept inside its own window rather than at the default's pace, subject to a floor that keeps the sweep off the API server's back. It runs even when the default is never-hibernate, for the Agents that opt in, and once at start-up, since a restart forgets the shortest window it saw. It skips any Agent already at rest — pair observed at zero *and* hibernation published. For the rest it hibernates only when *both* checks below agree it is quiet:

1. **Activity annotations** — the same `shouldRun` gate the reconciler uses to scale *up*, so scale-down and scale-up can never disagree. The Agent stays awake while `active-session` is set, or while `last-activity` falls within the idle timeout. The gate fails open — a missing or unparseable stamp keeps it running — so hibernation only ever follows a *positive* idle signal, never absent data.
2. **agent-runtime's live `idle` flag** — before scaling down, the checker probes the pod. The runtime is authoritative about its own idleness and reports one boolean; the controller reads nothing more into it. An unreachable pod counts as *not busy*, which permits hibernation.

**What counts as activity.** Those two checks rest on four signals, each catching something the others miss:

- **agent-runtime (`idle` flag).** Busy while a prompt turn is in flight, while prompts queue behind it, while an agent-initiated request (e.g. a permission prompt) awaits the client, while a session reports background work still running ([above](#session-inside-the-pod)), or while a terminal (PTY) is open — an open-but-idle terminal counts, because the open PTY *is* the signal. A chat is the exception to "open connection = busy": an attached chat with no turn running reads as `idle` here, since the flag tracks work, not watchers — such a chat stays awake via `active-session` below, not this probe. What the probe uniquely catches is in-flight work that no connection holds and `last-activity` no longer covers: a scheduled run outlasting the idle timeout, or a turn still running after its tab closed.
- **api-server (`active-session` annotation).** A refcount of open chat, terminal, SSH and browser connections — set on the first, cleared on the last. So a chat merely open in the UI keeps the Agent awake, as an open terminal does. Since the probe is blind to SSH, an SSH session leans on this annotation, which alone suffices while the connection is open. A half-dead connection is reclaimed by a WS ping/pong, and pins orphaned by a dead replica are swept by a periodic reconcile over per-replica Redis presence keys (the keys expire by TTL when their replica stops refreshing them).
- **api-server (`last-activity` annotation).** The one traffic-driven signal, and the clock the idle timeout measures against. Bumped, debounced, by any relay or proxied call as bytes flow, by an explicit wake, and by the scheduler on a fire. One path also *lowers* it: a fire whose Precheck declines puts the pre-fire value back ([schedules](schedules.md#precheck)), so a frequent check cannot hold an Agent awake on the strength of occurrences that did no work.
- **api-server (`invocations-active` annotation).** The [Invocation Pin](invocations.md#the-invocation-pin): the Agent drives a running Invocation.

None of this depends on *who* opened the session: the UI, a connected channel, and the CLI all dial the same relays, so a session's signals follow its **kind** — chat, terminal, SSH, browser — not its caller. A CLI terminal is covered by both checks like a UI terminal; a CLI SSH session is seen only by the annotations, never the probe — like any other SSH.

**The blind spot — unreported work.** The signals above see sessions, connections, and background work a session [reports](#session-inside-the-pod). What none of them see is work nobody reports: a job the agent detached from its harness, anything a non-reporting harness leaves running. For that work `active-session` is clear, `last-activity` ages out, the runtime reports `idle`, both checks agree, and the controller hibernates the pod **mid-job, killing the work**.

**The per-agent hibernation timeout.** Since the platform can't *detect* that work, it lets an operator *budget* for it. Each Agent carries an optional timeout override: unset inherits the cluster-wide default, a positive value sets a per-agent idle window in minutes, and **`0` disables hibernation** so the Agent never scales down. A Template can seed this override — a workload whose real work runs off-session ships *never-hibernate* — and a user's explicit choice at create still wins. The controller resolves the effective value (override else default) and feeds it to the same `shouldRun` gate used for scale-up and scale-down. The UI names the two outcomes, *Hibernate when idle* (a minutes window) and *Always on* (`0`), and shows the *effective* value; an Agent created without a pick keeps its Template's seed.

It's a blunt instrument: it keeps known off-session work alive without making it visible, and a long or disabled timeout holds CPU and memory until lowered by hand.

The pod terminates; the PVC, Secret, Service, and NetworkPolicy persist. Workspace state survives — the git checkout, `node_modules`, `.venv`, mise cache, and `$HOME` are all on the PVC and rejoin on the next wake. Anything written to the container's ephemeral filesystem (OS-level changes, tools installed outside `$HOME`) is lost; this is a deliberate constraint of the lifetime model.

**The hard stop and pause.** The user-initiated scale-downs, built to free [Reserved compute](budgets.md) without waiting for the idle checker — including reclaiming an Agent pinned awake by an open session. The api-server stamps `agent-platform.ai/stop-requested` (and clears the session pin); `shouldRun` treats the stamp as an overriding *negative* signal, and the reconciler scales the pair to zero immediately, bypassing the busy probe — a hard stop may interrupt work by design. The stop is **sticky**: background activity (UI polling, relay reconnects, proxied calls) never clears it — `ensureReady` on a stopped Agent fails with a typed *stopped* error instead of bumping — so an open tab cannot resurrect it. Only deliberate paths clear the stamp and restart the Agent (back through the budget gate): an explicit wake, and a schedule fire — schedules override a stop by design, and the UI warns at stop time when the Agent has any. Once scaled down, a stopped Agent looks like any hibernated one.

**Pause** is the non-sticky sibling: the same stop stamp — plus a *staled* `last-activity`, so the Agent stays down once un-stuck — which the api-server clears itself once the Agent settles Hibernated (a settle-watcher polls for up to a minute; on failure the stop stays — fail-safe strict, one wake recovers). The clear is a **compare-and-clear** of the exact stamp the pause wrote: a stop (or second pause) issued during the settle window carries a newer stamp and stays sticky rather than being erased by the watcher. The transient stickiness during the descent is load-bearing — it is what keeps background polls from resurrecting the pair before it lands; staling the clock in the *initial* patch (never at settle time) is what keeps the watcher from ever clobbering a concurrent wake. A paused Agent is afterwards a plain hibernated Agent: its next deliberate use wakes it. One nuance: a **never-hibernate** Agent (effective timeout `0`) runs regardless of activity, so its pause degrades to the sticky stop — the only stable "paused" it can have.

**Early reclaim for a blocked start.** The one scale-down neither the user nor the idle timeout asks for: when the [budget gate](budgets.md#reclaiming-room-for-a-blocked-start) refuses a start, it may hibernate that same owner's *unattended idle* Agents ahead of their timeout to admit it, longest-idle first and only when the freed Sizes provably cover the shortfall. Eligibility is deliberately narrower than the idle checker's, since reclaim takes down a pod whose own timeout still permits it to run: session and Invocation pins, sweepable Invocation targets, and never-hibernate Agents are all excluded, and survivors are probed the same way. A reclaimed Agent is marked as having **spent** the activity stamp it was reclaimed under, so `shouldRun` keeps it down until a *newer* bump arrives — otherwise its own next reconcile, still inside its timeout, would reclaim the room right back. It is otherwise an ordinary hibernated Agent: the mark self-clears when a deliberate touch outdates it, and the next use wakes it back through the gate.

### Delete

The api-server deletes the Agent custom resource. The controller's reconciler tears down the owned StatefulSet, Service, NetworkPolicy, and Secret, and asks the VM runner to delete a vm Agent's machine and disk, from a retrying queue; the [orphan sweep](vm-runner.md#runner-lifecycle) collects what a down runner leaves. Sessions are agent-owned files on the PVC (or the machine's disk) and disappear with it; an Invocation target's conversation is first copied, best effort and only if the root driver is up, to that root's volume. The controller reclaims the agent's workspace PVCs explicitly. In-flight Runs are owner-refed to the Agent CR, so Kubernetes garbage-collects them automatically. The api-server owns none of this: it never touches PVCs, and only deletes the Secrets it wrote — the per-channel credential Secrets and, via a cleanup hook, the agent-scoped image-pull Secret (a label-scoped orphan sweep backstops a missed delete).

Agent-scoped Postgres rows go with it on any deletion path ([persistence](persistence.md#lifetime)).

## `dam-run` — local exec shim

The in-pod `dam-run` CLI is a compatibility shim: `dam-run <cmd>` runs the command as a local process in the same pod, inheriting stdio, cwd and env — no remote hop, no `Run` resource, no relay.
