# Agent lifecycle

Last verified: 2026-10-21

## Overview

An **Agent** is the durable, owned, runnable resource.
It is a custom resource whose `spec` the api-server owns and whose `status` the controller writes; its StatefulSet scales between zero and one replica as the Agent hibernates and wakes.
**Sessions** live inside a running pod: each ACP session is a short-lived conversation that the pod's persistent agent process serves.
The lifecycle is driven by three actors:

- **Users** drive both management and sessions, but along different paths.
  The **UI** is the only management surface a user has — creating, configuring, disabling, and deleting Agents all flow through tRPC on the api-server's public port, which is the sole writer of the Agent spec.
  An operator can start a runtime migration from the cluster alone, which no user can do; see [vm-runtime-migration](vm-runtime-migration.md).
  Sessions can be driven from the UI **or** from a connected channel (Slack, Telegram).
  Channels never hit management endpoints; they dial the api-server's ACP relay only, with identity scoped to the individual messenger user driving the session.
  Channel internals live on [channels](channels.md).
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

Creation is per-purpose: the plain create picks an image, and a [starter kit](starter-kits.md) apply is the entry for anything preconfigured.
The **Agent Kind** marker survives only on agents stamped before kits: a knowledge base is now a kit that declares one capability, and a marker the platform no longer knows reads as no kind at all.
A kit apply is the plain create with the kit's grants, followed by the kit's schedules and channel binding, compensated by delete on failure.
A new agent takes its template's size and the trusted egress preset — or, for a kit that declares either, the kit's — both editable afterwards, plus a Backend the template has no say in: a container, or a microVM, which has no size and shares its owner's [memory pool](vm-memory.md) instead.
The Backend follows the install rather than the caller: an install that can run microVMs creates every new agent it is not told otherwise about as one, an explicit ask for a container is refused there, and an install that cannot run one creates a container ([features](features.md)).
A plain create names neither a harness nor a provider, since each session picks both ([below](#session-inside-the-pod)): it boots the default Template on the install's default harness and grants one provider Connection of the caller's that the harness runs on: the first in the harness's provider order (its home provider first, then the shared alias order), the oldest of that alias.
One, not every fitting one, so the [default](harness-config.md#session-settings) its runtime saves at its first `hello` sits on that provider and is the model its image presets, and no call goes to a provider the owner never chose for this agent; the owner attaches more on its Providers page.
A custom-image Template names the harness it wraps, if any, and may list its providers.
A create that names a provider gets that one alone.
Only a template create gets default providers; a bare image and a [sub-agent](invocations.md) hold only what they name.
A first agent is often created before its owner has any provider, so connecting a provider gives it to each of the owner's agents that holds none, when it is the owner's first provider that agent's harness runs on.
An agent that holds none while an older such provider exists was detached on purpose, and stays so.
A create may also name a repository to seed into the work directory before the first session; it rides the runtime channel rather than the pod spec ([runtime delivery](runtime-delivery.md#event)).
See [knowledge-bases](knowledge-bases.md) for what a knowledge base adds on top of what follows.

The api-server writes a new Agent custom resource whose spec carries the Agent's image / mount declarations (copied from a Template at create time, if any), env, and secret refs.
There is no stored desired state — running-vs-hibernated is observed status the controller derives from activity.
The controller reconciles a paired set of owned resources: two StatefulSets (the agent and its gateway), two Services (the agent's headless ACP and the `<agent>-gateway` proxy), agent-egress and gateway-ingress NetworkPolicies, and a per-Agent Envoy bootstrap ConfigMap + leaf TLS Certificate.
On the `vm` Backend the agent StatefulSet and its workspace PVC are not rendered at all: the Agent's storage is one disk on the owner's [VM runner](vm-runner.md), holding `HOME` and the machine's root ([vm storage](vm-storage.md#the-disk)), and the agent Service selects that runner rather than a pod of its own.
With the [owner gateway](credential-gateway.md#owner-gateway) on, a moved `vm` Agent also has no gateway StatefulSet, bootstrap ConfigMap, leaf or gateway NetworkPolicies of its own: it keeps its `<agent>-gateway` Service, which selects the owner's gateway pod, and its ext-authz Service.

When the create request carries a private-registry credential, the api-server writes an agent-scoped `dockerconfigjson` pull Secret *before* the Agent CR and rolls it back if that write fails; the controller hands that Secret first, ahead of any install-wide default, to whatever pulls the image — the kubelet, or on the vm Backend the owner's runner.
It never enters the agent, and a bad one surfaces as a pull failure rather than a create-time error.
See [security-and-credentials](security-and-credentials.md#image-pull-credentials).

Every harness ships in one image; a workload's image adds its own files ([agent-images](agent-images.md)).
The platform contract is two fixed-path executables: a chat entrypoint (spawned as the ACP subprocess for chat-mode sessions) and a terminal entrypoint (spawned attached to a PTY for terminal-mode sessions, told which session to resume).
agent-runtime otherwise treats the harness as opaque.
It also reserves the loopback **Artifact API Port** for the Agent's own [Artifact API](artifact-library.md#interactive-pages): the platform never starts anything there, and a server left running on it does not keep the Agent awake.
The workspace PVC is provisioned on first wake and survives subsequent hibernations — unless the warm pool is enabled and a pre-provisioned spare matches the mount's size, in which case the controller claims that already-bound spare at create time so first start skips the provisioning wait.
See [persistence](persistence.md#warm-pvc-pool).

Pod env at start is composed by the controller from platform wiring only — last occurrence wins, with `PORT` server-enforced:

1. **platform envs** — proxy + auth wiring rendered by the controller (`HTTPS_PROXY`, harness URL, ext-authz routing, etc.).
2. **chart-level platform defaults** — any `env` the install declares as defaults.

Everything tied to an Agent's *configuration* rides the runtime channel as contributions instead, never the pod spec: connection-derived env (credential placeholders the gateway swaps on the wire; a provider Connection's in a layer of its own), user-typed env (the Environment editor), template env, and file contributions.
The api-server stores user-typed and template env in Postgres and delivers all configuration at the next idle turn with no pod roll, ordering user env ahead of connection/secret env so it wins on a name collision.
Template env is seeded at create time only, so editing a Template never re-flows into a running Agent.
See [connections](connections.md) and [runtime delivery](runtime-delivery.md).

### Template upgrade

Templates are captured at create time; an install upgrade reconfigures no existing Agent beyond its image.
The api-server reports an update when an Agent's image differs from its Template's current image, and [moves](agent-images.md#image-updates) the Agent there by itself, never during work, and back when the Agent cannot start or keep running on it — except for a start the node refused, which holds the move and leaves the upgrade waiting.
Retired per-harness templates resolve to the default Template even when an install retains their old definitions.
The upgrade preserves the Agent's chosen harness; when an older Agent has no explicit choice, its retired template identifies the harness to carry forward.

A user may apply an upgrade sooner, confirming the target image and restart cost; the api-server refuses a target that changed since confirmation.
A running pair or vm machine restarts; a hibernated Agent takes the image on its next wake.
No configuration is re-seeded: template env stays frozen to preserve user edits, and mount/storage changes still require recreating the Agent.
A runtime advertising kinds its predecessor did not is re-delivered the Contributions the old image refused, closing the capability gap ([runtime-delivery](runtime-delivery.md#capability-negotiation)).

### Wake

Every caller that sends work to a pod — the api-server's ACP relay, channel adapters, skills management — routes through a single reachability primitive in the api-server.
The primitive's contract: **the controller-published `Ready` condition is the authoritative answer to "can I call this pod?"** The primitive pokes activity by bumping the `agent-platform.ai/last-activity` annotation (the reconciler scales up any Agent with recent activity), single-flights concurrent waits per Agent, and bumps the same annotation on every successful call, so any caller implicitly keeps the pod warm.
Opening a sleeping Agent's chat in the web UI wakes it once per open, a stopped Agent included but not a disabled one or one held over its budget; an Agent that falls asleep while its chat stays open, or whose wake fails, shows a Start button until the next open.
The deliberate opt-outs never wake anything: a **passive** relay connection (`passive=1`) fails closed unless `Ready`, takes no pin and never bumps activity; the per-agent tRPC relay takes no pin, waits out a wake already asked for without stamping activity, and keeps the stamp fresh while a view is open.
The agent relays — ACP, per-agent tRPC, terminal, browser stream and SSH — do not wait for `Ready` alone when they hold a socket for a wake from hibernation.
`Ready` arrives only after the controller's next reconcile, so a relay whose hold began on a hibernated Agent also asks the agent's `/healthz` through its Service at a short interval, and opens its upstream on the first answer once the cached Agent shows `GatewayPodReady`.
That answer is weaker than `Ready`: it does not say which pod or machine revision answered.
It is trusted only on a wake from hibernation, because hibernation stops the agent's pod or machine, so what answers came up for this wake.
For that reason the controller publishes hibernation only once the runner has confirmed the machine stopped ([Hibernate](#hibernate)).
A running agent that is not `Ready` can be in a restart, and a vm machine keeps answering on its port until its restart stops it, so a hold on such an agent, or one that begins after the controller has started the wake, waits for `Ready`.
A stop or a runtime migration ends that polling, and a wake that fails still closes the socket with its cause.
Contributions are applied out-of-band by a single background worker (a pod's `hello` is presence-only — it just signals the worker to dispatch).
The worker dispatches **only to a Ready agent** — the same readiness gate the relay's `ensureReady` uses — so an apply never targets a pod that is down or rolling; when the agent isn't Ready the outbox row stays unsettled and the periodic sweep re-dispatches once it is.
Each apply runs every contribution to termination and records which drivers failed; a degraded agent (failed installs retrying in the background, capped) surfaces via its `contributionFailures` badge and never wedges.
Readiness itself does **not** wait on contributions — configuration applies in the background.

Three paths trigger a wake:

- **Connect-driven** — the api-server is about to forward an ACP frame to a hibernated Agent and ensures readiness before the relay completes.
  The frame can originate from a UI tab attaching to a session or from a channel worker (Slack / Telegram) routing an inbound message to its bound session.
- **Schedule-driven** — a schedule fire commits a `trigger` event to the runtime outbox, then pokes the Agent awake without waiting for readiness; the boot-time `hello` catch-up delivers the event once the pod is `Ready`, and the event's TTL bounds how stale a fire can land (see [Schedule fire](#schedule-fire)).
- **Skills-management-driven** — install / uninstall / private-source scan / publish all route through the same primitive before reaching the agent (scan and publish reach agent-runtime directly over the harness port; install/uninstall keep the pod warm so the apply worker dispatches the bumped outbox).
  See [skills](skills.md).

Wake is bounded — the primitive polls pod readiness with backoff and gives up after two minutes, and a per-replica watch releases each wait the moment the condition flips and backs a read cache.
A read bypasses that cache when its result decides a write — spec read-modify-write, the sleep flow's compare-and-clear — and while the watch is unsynced, when the cache cannot tell an absent Agent from an unseen one.
It does not wait out the two minutes for a start that cannot succeed: an over-budget refusal ([budgets](budgets.md#failure-semantics-upstream)), or a vm machine's start the runner refused because the owner's VM storage is full, the image is unavailable, the runner cannot reach its node's image cache, or the guest did not boot, or one on a node the cluster has lost, which no wait brings back.
Such a wake fails with that cause once it saw the refusal appear during its own poll, or once the refusal outlasted a ten-second grace, because its first polls can read the previous attempt's refusal.
A vm start refusal read while the Agent still shows hibernated does not count, since the controller has not acted on the wake yet.
An unschedulable runner and a machine still pulling or booting keep the wait, because both can still come up; a node the cluster has lost is the opposite case, and no wait brings it back.
So does a start waiting for the node to grant its runner the memory it needs ([vm-memory](vm-memory.md)): the Agent carries `AwaitingAllocation`, not `OverBudget`, and the next retry, seconds later, admits it or re-denies the wake.
On giving up it reads the controller's readiness conditions one final time and classifies the failure into a typed wake-failure cause — hibernation never acted on, a pod start failure (with the controller's termination cause, a full home volume named), pods still progressing, a gateway still coming up, a gateway failure it cannot outgrow, or a reconcile error — which callers receive and surface in their own idiom (channel reply copy, WS close reason, HTTP body, skills call error).
The classification distinguishes transient causes (progressing, worth waiting or retrying) from hard ones (needing intervention); the two gateway causes split along exactly that line.
A gateway wedged on a superseded configuration counts as hard even though the platform replaces such pods by itself ([security-and-credentials](security-and-credentials.md)): classification runs only once the budget is spent, so a repair that was going to land already had its chance.
The primitive also records wake begin/success/timeout with duration and the condition snapshot, so wake latency and failures are diagnosable from the log store.
Callers can additionally register for a cold-start signal, fired when a call enters (or joins) a wake wait, to tell their user a wake is underway.
The schedule-driven poke is the exception: it doesn't wait, so there is no bounded wait to fail.

The UI holds a start to the same budget: past it, it offers Restart and the controller's not-ready message, timed from when it first saw the Agent starting.
What the chat shows during the start depends on the Backend.
A vm Agent boots in seconds, so its chat stays usable: the composer takes a prompt and holds it until the Agent is ready, and the sessions list shows a placeholder.
A container Agent takes too long for that to make sense, so its chat sits behind an overlay while it starts, showing its avatar, a slow-start warning and any workspace failure.

### Schedule fire

A Schedule fire is the one wake nobody is waiting on: the api-server commits the fire durably, pokes the Agent awake without waiting for readiness, and the Agent decides on arrival what the fire becomes — including declining it outright when the Schedule carries a Precheck.
Arming, firing, the Precheck and the Session each fire opens are owned by [schedules](schedules.md).

### Session inside the pod

A running pod serves Sessions: the harness processes it leases to them, prompts, their delivery and queue, steering, rewriting a conversation, and the pod's own supervision of the harness.
That lives on [sessions](sessions.md).

### Hibernate

Hibernation scales an idle Agent's StatefulSets to zero to reclaim its pod's CPU and memory; the next activity wakes it (see [Wake](#wake)).
On the `vm` Backend the gateway scales the same way and the agent side is the machine on the VM runner, which stops on the way down and starts on the way up — a stopped machine keeps its disks, so a wake is a boot of the same guest.
A wake scales the gateway up before the agent side, because the gateway pod is the slower of the two to start.
A `vm` Agent whose last start the runner refused for lack of room, one waiting for the node to grant its runner that room, or one with no status yet, keeps the gateway after the runner's answer, so a parked Agent's retries do not start and stop a gateway pod.
When the status already holds the agent side ready and only the gateway was missing, the reconcile that sees the gateway pod ready publishes `Ready` right after it applies the gateway, before the runner call and the remaining applies.
Only the idle checker or [reclaim](vm-memory.md) hibernates it, not a lapsed timeout.
An unreachable runner does not hold the gateway up, but the Agent is published hibernated only once its runner has confirmed the machine stopped.
With the [owner gateway](credential-gateway.md#owner-gateway) on, a `vm` Agent has no gateway pod of its own once it is moved: whether it should be up is recorded on its gateway Service instead of a replica count, its listener stays configured while it sleeps, and hibernation stops only the machine, so a wake is ready when the guest answers.
Until then its readiness is down and it reads as starting, the Agent's next reconcile stops the machine once the runner answers, and the idle checker tries the hibernation again on each sweep.
A runner that took the stop answers before its guest has powered off, so while the machine is stopping its readiness is down too, but the Agent reads as pausing rather than starting, and its reconcile publishes hibernation once the runner reports the machine stopped.
Whether an Agent is "idle" is **derived from observed activity, never stored** — there is no desired-state flag — and the derivation is split across two independent checks.

**The decision.** The controller's idle checker scans Agents on a timer whose interval scales with the *shortest effective timeout it saw last sweep* — an Agent that chooses a window far below the cluster-wide default is swept inside its own window rather than at the default's pace, subject to a floor that keeps the sweep off the API server's back.
It runs even when the default is never-hibernate, for the Agents that opt in, and once at start-up, since a restart forgets the shortest window it saw.
It skips any Agent already at rest — pair observed at zero *and* hibernation published.
It also skips any machine a [runner roll](vm-runner-upgrades.md#rolls) is waiting on: the roll's `runner-awaiting` list names the machines that were ready before it, and a hibernated machine would never come back ready.
That check and the scale-down are taken together under the owner's lock, the one a roll start takes, so a roll that begins while the pod is being probed still sees its machine left up.
For the rest it hibernates only when *both* checks below agree it is quiet:

1. **Activity annotations** — the same `shouldRun` gate the reconciler uses to scale *up*, so scale-down and scale-up can never disagree.
   The Agent stays awake while `active-session` is set, or while `last-activity` falls within the idle timeout.
   The gate fails open — a missing or unparseable stamp keeps it running — so hibernation only ever follows a *positive* idle signal, never absent data.
2. **agent-runtime's live `idle` flag** — before scaling down, the checker probes the pod.
   The runtime is authoritative about its own idleness and reports one boolean; the controller reads nothing more into it.
   An unreachable pod counts as *not busy*, which permits hibernation.

**What counts as activity.** Those two checks rest on four signals, each catching something the others miss:

- **agent-runtime (`idle` flag).** Busy while a prompt turn is in flight, while the harness works on in an [Autonomous Turn](sessions.md#session-inside-the-pod) after it answered one, while prompts queue behind it, while a session setting change (mode or model) waits to be sent or answered, while an agent-initiated request (e.g. a permission prompt) awaits the client, while kept background work runs — a reported Harness Task or a marked Detached Process ([agent-processes](agent-processes.md#keeping-work)), or while a terminal (PTY) is live.
  A terminal is live while a viewer is attached, inside its detach grace, or while it printed within the idle window its reap uses ([sessions](sessions.md)).
  A detached, quiet terminal held open only for its background work counts only while that work is kept, as a chat session does: unkept work holds the terminal open and dies at hibernation.
  A chat is the exception to "open connection = busy": an attached chat with no turn running reads as `idle` here, since the flag tracks work, not watchers — such a chat stays awake via `active-session` below, not this probe.
  What the probe uniquely catches is in-flight work that no connection holds and `last-activity` no longer covers: a scheduled run outlasting the idle timeout, or a turn still running after its tab closed.
- **api-server (`active-session` annotation).** A refcount of open chat, terminal, SSH and browser connections — set on the first, cleared on the last.
  So a chat merely open in the UI keeps the Agent awake, as an open terminal does.
  Since the probe is blind to SSH, an SSH session leans on this annotation, which alone suffices while the connection is open.
  A half-dead connection is reclaimed by a WS ping/pong, and pins orphaned by a dead replica are swept by a periodic reconcile over per-replica Redis presence keys (the keys expire by TTL when their replica stops refreshing them).
- **api-server (`last-activity` annotation).** The one traffic-driven signal, and the clock the idle timeout measures against.
  Bumped, debounced, by any relay or proxied call as bytes flow, by an explicit wake, and by the scheduler on a fire.
  One path also *lowers* it: a fire whose Precheck declines puts the pre-fire value back ([schedules](schedules.md#precheck)), so a frequent check cannot hold an Agent awake on the strength of occurrences that did no work.
- **api-server (`invocations-active` annotation).** The [Invocation Pin](invocations.md#the-invocation-pin): the Agent drives a running Invocation.

None of this depends on *who* opened the session: the UI, a connected channel, and the CLI all dial the same relays, so a session's signals follow its **kind** — chat, terminal, SSH, browser — not its caller.
A CLI terminal is covered by both checks like a UI terminal; a CLI SSH session is seen only by the annotations, never the probe — like any other SSH.

**The blind spot — unkept work.** The signals above see sessions, connections, and [kept](agent-processes.md#keeping-work) background work: Harness Tasks a session reports, and Detached Processes the agent marked with `platform-keep` or the user chose to keep.
What none of them hold for is unkept work: a job detached with a plain `nohup`, anything a non-reporting harness leaves running.
It survives the user leaving, but for it `active-session` is clear, `last-activity` ages out, the runtime reports `idle`, both checks agree, and the controller hibernates the pod **mid-job, killing the work**.

**The per-agent hibernation timeout.** For work nobody keeps, the platform lets an operator *budget* instead.
Each Agent carries an optional timeout override: unset inherits the cluster-wide default, a positive value sets a per-agent idle window in minutes, and **`0` disables hibernation** so the Agent never scales down.
A Template can seed this override — a workload whose real work runs off-session ships *never-hibernate* — and a user's explicit choice at create still wins.
The controller resolves the effective value (override else default) and feeds it to the same `shouldRun` gate used for scale-up and scale-down.
The UI offers it as *Sleep after being idle for* a short list of windows or *Never* (`0`), shows a custom value that is not in the list as its own option, and shows the *effective* value; an Agent created without a pick keeps its Template's seed.
An Agent that never sleeps carries an *Always on* tag.
**A vm Agent reads the vm default.** It boots in seconds, so the chart carries a separate default for it, and the UI does not offer the setting on a vm Agent.
An override still counts where one exists — a Template or starter kit seed, or an Agent whose [Backend](vm-runtime-migration.md) moved — and it is read exactly as a container Agent's is, `0` included.
The override is a Go duration, and the api-server runs a port of Go's own parser rather than a lookalike: the whole grammar — a sign, a leading dot, an empty fraction, either microsecond spelling — the same float64 fraction step that makes `0.9999999999999999ns` one nanosecond, and the same int64 nanosecond overflow that rejects `2562048h`.
A nonpositive duration is never-hibernate for every reader, and a positive window under a minute shows as one minute where the platform counts minutes.
One golden document of real `time.ParseDuration` answers holds the controller and the api-server to the same acceptance and the same minutes.
A cold first boot can still outlast that timeout — an image no runner has cached, a fresh runner, a large nested guest — so for a vm Agent whose pair is awake the idle checker also counts the clock from the moment it turned `Ready`, and holds a boot still in progress: a machine not ready for no reason of its own, with no start failure reported — a machine the kernel, its seccomp filter or its runner's own OOM kill took down is booting again, and that reason says why the machine went down rather than that it is up to nothing.
The hold ends at the start failure report, and a boot that has not finished a quarter of an hour past the timeout is hibernated anyway.
A boot the runner reports as copying a disk, a conversion or a migration seed's restore, is held for as long as the runner says so, since the runner bounds it at six hours and a hibernation would start the copy again from nothing; reclaim counts it as booting for the same reason.
A running Agent with no session running but [kept background work](agent-processes.md#keeping-work) holding it awake shows *Background work* rather than *Idle*.

It's a blunt instrument: it keeps known off-session work alive without making it visible, and a long or disabled timeout holds CPU and memory until lowered by hand.

The pod terminates; the PVC, Secret, Service, and NetworkPolicy persist.
Workspace state survives — the git checkout, `node_modules`, `.venv`, mise cache, and `$HOME` are all on the PVC and rejoin on the next wake.
Anything written to the container's ephemeral filesystem (OS-level changes, tools installed outside `$HOME`) is lost; this is a deliberate constraint of the lifetime model.

**Sleep.** A scale-down on request, built to free [Reserved compute](budgets.md) without waiting for the idle checker — including reclaiming an Agent pinned awake by an open session.
The UI calls the state *Sleeping* but offers no Sleep action: an Agent the user wants down without waiting for the idle timeout is [disabled](#disable) instead, and the api-server keeps the sleep call for other clients.
The api-server stamps `agent-platform.ai/stop-requested`, clears the session and Invocation pins, and stales `last-activity`, so the Agent stays down once the stamp is gone; `shouldRun` treats the stamp as an overriding *negative* signal, and the reconciler scales the pair to zero immediately, bypassing the busy probe — sleep may interrupt work by design.
While the stamp stands, background activity (UI polling, relay reconnects, proxied calls) never clears it — `ensureReady` on such an Agent fails with a typed *stopped* error instead of bumping — so an open tab cannot resurrect the pair before it lands.
An explicit wake and a schedule fire clear it at any time, back through the budget gate.
The api-server clears the stamp itself once the Agent settles Hibernated (a settle-watcher polls for up to a minute; on failure the stamp stays — fail-safe strict, one wake recovers).
The clear is a **compare-and-clear** of the exact stamp the sleep wrote: a second sleep issued during the settle window carries a newer stamp and is not erased by the first one's watcher.
Staling the clock in the *initial* patch (never at settle time) is what keeps the watcher from ever clobbering a concurrent wake.
A sleeping Agent is afterwards a plain hibernated Agent: its next deliberate use wakes it.
A sleep is refused while a [runtime migration](vm-runtime-migration.md) holds the Agent, since every wake is refused then too.
A **never-hibernate** Agent (effective timeout `0`) runs regardless of activity; a direct sleep call still stamps it without the settle clear, the only stable sleep it can have.

### Disable

A **disabled** Agent is a sleeping Agent that nothing wakes until its owner enables it: no chat, terminal, SSH, Slack or Telegram message, schedule fire or Invocation outcome starts it.
The owner disables and enables it from the Agent's *General* page, or with `dam agent disable` and `dam agent enable` ([CLI](cli.md#agent-lifecycle)).
Disabling stamps `agent-platform.ai/disabled` together with the stop request, clears the session and Invocation pins, and stales `last-activity`, so the controller scales the pair to zero exactly as for a sleep; the controller never reads the disabled mark itself.
The settle-watcher never runs, so the stop request stands for as long as the Agent is disabled.
Every path that would clear the stop request — an explicit wake, a schedule poke, a workspace retry — first reads the disabled mark and writes nothing when it is set; the write names the version it read, so a disable landing in between makes it conflict and read again rather than undo the disable.
An explicit wake answers with a typed *disabled* error, and `ensureReady` fails with the *stopped* error, which carries whether the Agent is disabled so a channel can tell its sender to ask the owner to enable it.
A recurring schedule fire is held, reading `held: agent disabled`, and a one-time task due meanwhile is recorded missed ([schedules](schedules.md)).
Enabling clears both marks and leaves `last-activity` stale, so the Agent stays asleep until its next use wakes it.
Disabling is refused while a [runtime migration](vm-runtime-migration.md) holds the Agent, as a sleep is.
A sleep asked of a disabled Agent writes nothing, so its settle-watcher never runs and cannot clear the standing stop request.

**Early reclaim for a blocked start.** The one scale-down neither the user nor the idle timeout asks for: when the [budget gate](budgets.md#reclaiming-room-for-a-blocked-start) refuses a start, it may hibernate that same owner's *unattended idle* Agents ahead of their timeout to admit it, longest-idle first and only when the freed Sizes provably cover the shortfall.
Eligibility is deliberately narrower than the idle checker's, since reclaim takes down a pod whose own timeout still permits it to run: session and Invocation pins, sweepable Invocation targets, and never-hibernate Agents are all excluded, and survivors are probed more strictly: only an Agent whose runtime answers `idle` is reclaimed, and an unreachable pod is spared.
A reclaimed Agent is marked as having **spent** the activity stamp it was reclaimed under, so `shouldRun` keeps it down until a *newer* bump arrives — otherwise its own next reconcile, still inside its timeout, would reclaim the room right back.
It is otherwise an ordinary hibernated Agent: the mark self-clears when a deliberate touch outdates it, and the next use wakes it back through the gate.

### Delete

The api-server deletes the Agent custom resource.
The controller's reconciler tears down the owned StatefulSet, Service, NetworkPolicy, and Secret, and asks the VM runner to delete a vm Agent's machine and disk, from a retrying queue; the [orphan sweep](vm-runner.md#runner-lifecycle) collects what a down runner leaves.
Sessions are agent-owned files on the PVC (or the machine's disk) and disappear with it; an Invocation target's conversation is first copied, best effort and only if the root driver is up, to that root's volume.
The controller reclaims the agent's workspace PVCs explicitly.
In-flight Runs are owner-refed to the Agent CR, so Kubernetes garbage-collects them automatically.
The api-server owns none of this: it never touches PVCs, and only deletes the Secrets it wrote — the per-channel credential Secrets and, via a cleanup hook, the agent-scoped image-pull Secret (a label-scoped orphan sweep backstops a missed delete).

Agent-scoped Postgres rows go with it on any deletion path ([persistence](persistence.md#lifetime)).

## `dam-run` — local exec shim

The in-pod `dam-run` CLI is a compatibility shim: `dam-run <cmd>` runs the command as a local process in the same pod, inheriting stdio, cwd and env — no remote hop, no `Run` resource, no relay.
