# Agent lifecycle

Last verified: 2026-10-08

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

Creation is per-purpose: the plain create picks an image, and a [starter kit](starter-kits.md) apply is the entry for anything preconfigured. The **Agent Kind** marker survives only on agents stamped before kits: a knowledge base is now a kit that declares one capability, and a marker the platform no longer knows reads as no kind at all. A kit apply is the plain create with the kit's grants, followed by the kit's schedules and channel binding, compensated by delete on failure. A new agent takes its template's size and the trusted egress preset — or, for a kit that declares either, the kit's — both editable afterwards, plus a Backend the template has no say in: a container, or a microVM. What a Template may say is narrower than it was: the preconfigured category is gone, since a preconfigured agent is a kit, and a Template may list the providers its image can run on: create offers only those, refusing a kit whose list shares none. A create may also name a repository to seed into the work directory before the first session; it rides the runtime channel rather than the pod spec ([runtime delivery](runtime-delivery.md#event)). See [knowledge-bases](knowledge-bases.md) for what a knowledge base adds on top of what follows.

The api-server writes a new Agent custom resource whose spec carries the Agent's image / mount declarations (copied from a Template at create time, if any), env, and secret refs. There is no stored desired state — running-vs-hibernated is observed status the controller derives from activity. The controller reconciles a paired set of owned resources: two StatefulSets (the agent and its gateway), two Services (the agent's headless ACP and the `<agent>-gateway` proxy), agent-egress and gateway-ingress NetworkPolicies, and a per-Agent Envoy bootstrap ConfigMap + leaf TLS Certificate. On the `vm` Backend the agent StatefulSet and its workspace PVC are not rendered at all: the Agent's storage is one disk on the owner's [VM runner](vm-runner.md), holding HOME and nothing else ([persistence](persistence.md)), and the agent Service selects that runner rather than a pod of its own.

When the create request carries a private-registry credential, the api-server writes an agent-scoped `dockerconfigjson` pull Secret *before* the Agent CR and rolls it back if that write fails; the controller hands that Secret first, ahead of any install-wide default, to whatever pulls the image — the kubelet, or on the vm Backend the owner's runner. It never enters the agent, and a bad one surfaces as a pull failure rather than a create-time error. See [security-and-credentials](security-and-credentials.md#image-pull-credentials).

Every harness ships in one image; a workload's image adds its own files ([agent-images](agent-images.md)). The platform contract is two fixed-path executables: a chat entrypoint (spawned as the ACP subprocess for chat-mode sessions) and a terminal entrypoint (spawned attached to a PTY for terminal-mode sessions, told which session to resume). agent-runtime otherwise treats the harness as opaque. It also reserves the loopback **Artifact API Port** for the Agent's own [Artifact API](artifact-library.md#interactive-pages): the platform never starts anything there, and a server left running on it does not keep the Agent awake. The workspace PVC is provisioned on first wake and survives subsequent hibernations — unless the warm pool is enabled and a pre-provisioned spare matches the mount's size, in which case the controller claims that already-bound spare at create time so first start skips the provisioning wait. The choice is invisible after the fact: a claimed spare becomes an ordinary per-Agent PVC. See [persistence](persistence.md#warm-pvc-pool).

Pod env at start is composed by the controller from platform wiring only — last occurrence wins, with `PORT` server-enforced:

1. **platform envs** — proxy + auth wiring rendered by the controller (`HTTPS_PROXY`, harness URL, ext-authz routing, etc.).
2. **chart-level platform defaults** — any `env` the install declares as defaults.

Everything tied to an Agent's *configuration* rides the runtime channel as contributions instead, never the pod spec: connection-derived env (credential placeholders the gateway swaps on the wire), user-typed env (the Environment editor), template env, and file contributions. The api-server stores user-typed and template env in Postgres and delivers all configuration at the next idle turn with no pod roll, ordering user env ahead of connection/secret env so it wins on a name collision. Template env is seeded at create time only, so editing a Template never re-flows into a running Agent. See [connections](connections.md) and [runtime delivery](runtime-delivery.md).

### Template upgrade

Because a Template is captured at create time, a helm upgrade that advances a template (a newer agent image) never re-flows into existing Agents. The template-upgrade path is the sanctioned catch-up: on every Agent read the api-server compares the Agent's captured image against the current image of the template it came from — a template's resolved image reference doubles as its version identity — and surfaces a pending update on the Agent when they differ. Applying it is user-initiated, one Agent at a time or every behind Agent at once: a single Agent confirms against the exact image movement, a batch against the images it moves to and the restart it costs, and the api-server then re-points the Agent spec at the template's current image, and a running pair or vm machine restarts on it (a hibernated Agent just wakes on the new image). The upgrade is deliberately image-only: template env stays frozen (re-seeding would clobber user edits), and mount/storage changes cannot ride a spec patch (the StatefulSet's volume layout is immutable once created) — those still require recreating the Agent. What it does change is what the Agent can accept: a runtime advertising kinds its predecessor did not is re-delivered the Contributions the old image refused, so applying the update closes a capability gap rather than only reporting one ([runtime-delivery](runtime-delivery.md#capability-negotiation)).

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

A running pod serves Sessions: prompts, their delivery and queue, steering, rewriting a conversation, and the pod's own supervision of the harness. That lives on [sessions](sessions.md).

### Hibernate

Hibernation scales an idle Agent's StatefulSets to zero to reclaim its pod's CPU and memory; the next activity wakes it (see [Wake](#wake)). On the `vm` Backend the gateway scales the same way and the agent side is the machine on the VM runner, which stops on the way down and starts on the way up — a stopped machine keeps its disks, so a wake is a boot of the same guest. Only the idle checker or [reclaim](vm-memory.md) hibernates it, not a lapsed timeout. An unreachable runner does not hold the gateway up. Whether an Agent is "idle" is **derived from observed activity, never stored** — there is no desired-state flag — and the derivation is split across two independent checks.

**The decision.** The controller's idle checker scans Agents on a timer whose interval scales with the *shortest effective timeout it saw last sweep* — an Agent that chooses a window far below the cluster-wide default is swept inside its own window rather than at the default's pace, subject to a floor that keeps the sweep off the API server's back. It runs even when the default is never-hibernate, for the Agents that opt in, and once at start-up, since a restart forgets the shortest window it saw. It skips any Agent already at rest — pair observed at zero *and* hibernation published. For the rest it hibernates only when *both* checks below agree it is quiet:

1. **Activity annotations** — the same `shouldRun` gate the reconciler uses to scale *up*, so scale-down and scale-up can never disagree. The Agent stays awake while `active-session` is set, or while `last-activity` falls within the idle timeout. The gate fails open — a missing or unparseable stamp keeps it running — so hibernation only ever follows a *positive* idle signal, never absent data.
2. **agent-runtime's live `idle` flag** — before scaling down, the checker probes the pod. The runtime is authoritative about its own idleness and reports one boolean; the controller reads nothing more into it. An unreachable pod counts as *not busy*, which permits hibernation.

**What counts as activity.** Those two checks rest on four signals, each catching something the others miss:

- **agent-runtime (`idle` flag).** Busy while a prompt turn is in flight, while prompts queue behind it, while an agent-initiated request (e.g. a permission prompt) awaits the client, while a session reports background work still running ([above](sessions.md#session-inside-the-pod)), or while a terminal (PTY) is open — an open-but-idle terminal counts, because the open PTY *is* the signal. A chat is the exception to "open connection = busy": an attached chat with no turn running reads as `idle` here, since the flag tracks work, not watchers — such a chat stays awake via `active-session` below, not this probe. What the probe uniquely catches is in-flight work that no connection holds and `last-activity` no longer covers: a scheduled run outlasting the idle timeout, or a turn still running after its tab closed.
- **api-server (`active-session` annotation).** A refcount of open chat, terminal, SSH and browser connections — set on the first, cleared on the last. So a chat merely open in the UI keeps the Agent awake, as an open terminal does. Since the probe is blind to SSH, an SSH session leans on this annotation, which alone suffices while the connection is open. A half-dead connection is reclaimed by a WS ping/pong, and pins orphaned by a dead replica are swept by a periodic reconcile over per-replica Redis presence keys (the keys expire by TTL when their replica stops refreshing them).
- **api-server (`last-activity` annotation).** The one traffic-driven signal, and the clock the idle timeout measures against. Bumped, debounced, by any relay or proxied call as bytes flow, by an explicit wake, and by the scheduler on a fire. One path also *lowers* it: a fire whose Precheck declines puts the pre-fire value back ([schedules](schedules.md#precheck)), so a frequent check cannot hold an Agent awake on the strength of occurrences that did no work.
- **api-server (`invocations-active` annotation).** The [Invocation Pin](invocations.md#the-invocation-pin): the Agent drives a running Invocation.

None of this depends on *who* opened the session: the UI, a connected channel, and the CLI all dial the same relays, so a session's signals follow its **kind** — chat, terminal, SSH, browser — not its caller. A CLI terminal is covered by both checks like a UI terminal; a CLI SSH session is seen only by the annotations, never the probe — like any other SSH.

**The blind spot — unreported work.** The signals above see sessions, connections, and background work a session [reports](sessions.md#session-inside-the-pod). What none of them see is work nobody reports: a job the agent detached from its harness, anything a non-reporting harness leaves running. For that work `active-session` is clear, `last-activity` ages out, the runtime reports `idle`, both checks agree, and the controller hibernates the pod **mid-job, killing the work**.

**The per-agent hibernation timeout.** Since the platform can't *detect* that work, it lets an operator *budget* for it. Each Agent carries an optional timeout override: unset inherits the cluster-wide default, a positive value sets a per-agent idle window in minutes, and **`0` disables hibernation** so the Agent never scales down. A Template can seed this override, so every Agent created from it starts with a chosen default rather than the cluster-wide one — a workload image whose real work runs off-session (e.g. a Nous experimentation campaign) ships a *never-hibernate* default so the idle checker can't reclaim its pod mid-run; a user's explicit choice at create time still wins. The controller resolves the effective value (override else default) and feeds it to the same `shouldRun` gate used for scale-up and scale-down. The UI names the two outcomes rather than the number behind them: *Hibernate when idle*, carrying the minutes window, and *Always on* for `0`. Agent settings show the *effective* value, so an Agent with no override of its own presents the inherited one; the create screen offers the same choice, and an Agent created without an explicit pick keeps whatever default its Template seeded. An Always-on Agent is marked as such wherever its status shows, and a running Agent's status separates *Working* from *Idle* by whether a session is actually running — until that read resolves the status says only that the Agent runs, never that it sits idle. The startup screen offers the switch to Always on as well, for a user who would rather not wait through the next boot.

It's a blunt instrument, not a fix for the blind spot: a longer window (or `0`) on an Agent with known no-session work keeps it alive to finish, but doesn't make that work visible. The cost is real — there's no auto-reclaim, so a long or disabled timeout holds CPU, memory, and the harness open until lowered by hand.

The pod terminates; the PVC, Secret, Service, and NetworkPolicy persist. Workspace state survives — the git checkout, `node_modules`, `.venv`, mise cache, and `$HOME` are all on the PVC and rejoin on the next wake. Anything written to the container's ephemeral filesystem (OS-level changes, tools installed outside `$HOME`) is lost; this is a deliberate constraint of the lifetime model.

**The hard stop and pause.** The user-initiated scale-downs, built to free [Reserved compute](budgets.md) without waiting for the idle checker — including reclaiming an Agent pinned awake by an open session. The api-server stamps `agent-platform.ai/stop-requested` (and clears the session pin); `shouldRun` treats the stamp as an overriding *negative* signal, and the reconciler scales the pair to zero immediately, bypassing the busy probe — a hard stop may interrupt work by design. The stop is **sticky**: background activity (UI polling, relay reconnects, proxied calls) never clears it — `ensureReady` on a stopped Agent fails with a typed *stopped* error instead of bumping — so an open tab cannot resurrect it. Only deliberate paths clear the stamp and restart the Agent (back through the budget gate): an explicit wake, and a schedule fire — schedules override a stop by design, and the UI warns at stop time when the Agent has any. Once scaled down, a stopped Agent looks like any hibernated one.

**Pause** is the non-sticky sibling: the same stop stamp — plus a *staled* `last-activity`, so the Agent stays down once un-stuck — which the api-server clears itself once the Agent settles Hibernated (a settle-watcher polls for up to a minute; on failure the stop stays — fail-safe strict, one wake recovers). The clear is a **compare-and-clear** of the exact stamp the pause wrote: a stop (or second pause) issued during the settle window carries a newer stamp and stays sticky rather than being erased by the watcher. The transient stickiness during the descent is load-bearing — it is what keeps background polls from resurrecting the pair before it lands; staling the clock in the *initial* patch (never at settle time) is what keeps the watcher from ever clobbering a concurrent wake. A paused Agent is afterwards a plain hibernated Agent: its next deliberate use wakes it. One nuance: a **never-hibernate** Agent (effective timeout `0`) runs regardless of activity, so its pause degrades to the sticky stop — the only stable "paused" it can have.

**Early reclaim for a blocked start.** The one scale-down neither the user nor the idle timeout asks for: when the [budget gate](budgets.md#reclaiming-room-for-a-blocked-start) refuses a start, it may hibernate that same owner's *unattended idle* Agents ahead of their timeout to admit it, longest-idle first and only when the freed Sizes provably cover the shortfall. Eligibility is deliberately narrower than the idle checker's, since reclaim takes down a pod whose own timeout still permits it to run: session and Invocation pins, sweepable Invocation targets, and never-hibernate Agents are all excluded, and survivors are probed the same way. A reclaimed Agent is marked as having **spent** the activity stamp it was reclaimed under, so `shouldRun` keeps it down until a *newer* bump arrives — otherwise its own next reconcile, still inside its timeout, would reclaim the room right back. It is otherwise an ordinary hibernated Agent: the mark self-clears when a deliberate touch outdates it, and the next use wakes it back through the gate.

### Delete

The api-server deletes the Agent custom resource. The controller's reconciler tears down the owned StatefulSet, Service, NetworkPolicy, and Secret, and asks the VM runner to delete a vm Agent's machine and disk, from a retrying queue; the [orphan sweep](vm-runner.md#runner-lifecycle) collects what a down runner leaves. Sessions are agent-owned files on the PVC (or the machine's disk) and disappear with it; an Invocation target's conversation is first copied, best effort and only if the root driver is up, to that root's volume. The controller reclaims the agent's workspace PVCs explicitly. In-flight Runs are owner-refed to the Agent CR, so Kubernetes garbage-collects them automatically. The api-server owns none of this: it never touches PVCs, and only deletes the Secrets it wrote — the per-channel credential Secrets and, via a cleanup hook, the agent-scoped image-pull Secret (a label-scoped orphan sweep backstops a missed delete).

Agent-scoped Postgres rows go with it on any deletion path ([persistence](persistence.md#lifetime)).

## `dam-run` — local exec shim

The in-pod `dam-run` CLI is a compatibility shim: `dam-run <cmd>` runs the command as a regular local process in the same pod (stdio, cwd, and environment inherited), so scripts and prompts that call it keep working unchanged — no remote hop, no `Run` resource, no relay.
