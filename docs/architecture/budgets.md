# Per-user resource budgets

Last verified: 2026-10-23

## Overview

A **Budget** is a per-user pool of the memory, CPU and storage that user's agents share: the limits of their [VM runner](vm-runner.md), on which every one of their agents is a machine.
The cluster has a fixed compute pool and all agents share one namespace, so without a pool per user the first users to spin up agents can starve everyone else.
Within their pool a user is free: deploy whatever they want, for as long as they want — the Budget constrains **starting** a machine, never running one, with one exception: a blocked start, and a pool near its limit, may **reclaim** room by hibernating that same owner's unattended idle agents early (see [Reclaiming room](#reclaiming-room-for-a-blocked-start)).
No owner's demand touches another owner's agents.
A Budget limits compute and storage only; model spend has its own per-user Spend Ceiling ([spend-limits](spend-limits.md#spend-ceiling)).

Enforcement lives in the **controller and the owner's runner, at the start of a machine**.
The reconciler is the single actuator that brings an agent's machine up, so every wake path — UI, ACP/terminal/SSH relays, channels, the scheduler, or a bare annotation stamp — converges on one admission that no api-server code path can bypass.
The api-server's role is legibility: it translates the controller's refusal into a typed, immediate error and serves the visibility surface.
(Kubernetes offers no native per-user primitive here: `ResourceQuota` is namespace-scoped and all agents share one namespace.)

## What is counted

An Agent has no size of its own: its machine draws on its owner's runner and may grow to half its memory ([vm-memory](vm-memory.md)), so the pool, not a sum of sizes, is what a Budget bounds.

- **Memory** is the runner's memory limit, and machines are counted by what they use rather than by their sizes, so an owner may run more machines than their sizes add up to; a start that does not fit is refused by the runner ([vm-memory](vm-memory.md)).
- **CPU** is the runner's CPU limit, which follows the machines that should be running up to the owner's CPU pool; it is never refused on, since a short CPU only slows agents down.
- **Storage** is the owner's claim, which every machine disk may grow into ([vm storage](vm-storage.md#the-owners-claim)); a create is refused once it is nearly full.

The budget endpoint carries the pool: the memory it holds and what it has committed, its storage used and usable, its CPU limit, how often that limit held it back and its CPU pressure — the share of the last minute its agents waited for a CPU — over the last minute, and each of the owner's agents' measured memory, CPU and disk share, read from the runner on demand and never stored.
Each pool carries a level, warning from 75% and critical from 90%, defined once so the home dashboard, the create refusal and the resource alerts agree; CPU's pressure is named as congestion instead — low, moderate from 20% (the warning level), high from 50% and severe from 75% (both critical) — with a fill that grows with the log of the slowdown and is full at four times slower.
**Deliberate exclusion:** each agent's gateway pod, a uniform per-agent platform overhead outside the runner that operators price into the install.

## The pool

Install-wide defaults live in `virtualization.runner`.
A **UserBudget** CR overrides them for one user:

```yaml
apiVersion: agent-platform.ai/v1
kind: UserBudget
metadata:
  name: budget-<keycloak-sub>   # pinned to spec.owner at admission (CEL)
  namespace: <agents-namespace>   # the chart's agent namespace (default platform-agents)
spec:
  owner: "<keycloak-sub>"        # exact plaintext sub, as on the agent owner label
  cpu: "16"
  memory: "32Gi"
  storage: "500Gi"               # their VM runner claim's size
```

Every field but `owner` is optional, and each falls back on its own: `memory` is their runner's memory limit, `cpu` caps its CPU limit and `storage` is their storage pool, which their claim is created at and grows to ([vm-memory](vm-memory.md), [vm storage](vm-storage.md#the-owners-claim)).

The name↔owner pin makes one-budget-per-user structural (a second budget is a name collision), and the schema validates quantities at admission, so a malformed pool is rejected rather than silently parsed to zero.
UserBudgets are operator-managed; there is no self-service path.
A platform operator ([security-and-credentials](security-and-credentials.md#identity)) lists, sets, changes and removes them in the Operator tab of Settings or with `dam budget`, with no cluster access; `kubectl` and GitOps still work.
The api-server writes the UserBudget for them, so the controller keeps reading the one resource it enforces.
A new budget names its user by email, which the api-server looks up in Keycloak; an existing one can also be named by the user's id, so a typo never creates a budget for nobody.
A change sets only the fields it names, a field taken back to the default is dropped from the spec, and a budget left with no field is deleted.
Each write records the operator and the time on the UserBudget's annotations (`agent-platform.ai/budget-set-by`, `agent-platform.ai/budget-updated-at`), and the api-server logs it with the sizes before and after (`budgets.user_budget_changed`); a budget written with `kubectl` has no such record and shows as set outside the platform.
The list is found, sorted and paged by the api-server, so the screen asks for one page at a time and the identity directory is asked for that page's emails alone; a search by part of an email asks Keycloak which users match.
Role-based budgets and approval flows are out of scope — when they arrive, richer policy in the api-server will *materialize* its results as UserBudget CRs, and the controller's contract stays a dumb numeric invariant.

## Enforcement

On each reconcile that wants an agent up (`shouldRun` true), the controller asks the owner's runner for the machine, and the runner admits it or refuses it for the owner's memory ([vm-memory](vm-memory.md)).
Admission cannot interleave for two same-owner agents because every agent of one owner is reconciled by the **same worker**, one at a time: the leader-elected instance runs a fixed eight workers, each with its own queue, and an agent's owner label picks its worker; a per-owner mutex backs it up.
Different owners' agents reconcile in parallel, so a VM runner that hangs holds up only the owners that share its worker, not the whole install.
The exception is a runner roll: its install-wide lock is held across runner calls while it decides, so during a release that rolls runners a hung runner can hold every worker that reaches the roll ([#4939](https://github.com/dam-agents/dam/issues/4939) narrows it).
A name the agent cache does not hold yet is not queued at all, so no agent is ever on two workers at once; the cache's own add for it queues it once it lands.
The owner label is set at create and never changes, which keeps an agent on one worker for its whole life.
Each worker orders its queue: a change a person is waiting on — a wake bumping last-activity, a new Agent, a spec or annotation edit, a pod or machine moving — goes ahead of background re-checks (the startup list after a controller restart, the drift sweep, the retry and memory ticks, the controller's own status writes echoing back), so a wake waits behind at most the reconcile its worker is already running, never behind the whole fleet.
What the workers share across owners is serialized where it is decided: the runner roll's place count takes one install-wide lock, and every worker draws on the one Kubernetes client rate limiter, so more workers add no API throughput.

A machine the runner refuses for the owner's memory (`MachineOutOfCapacity`) is **parked**: its gateway is scaled to zero and the Agent reads `Ready=False, reason=OverBudget`, carrying the controller's own sentence — how much of the owner's memory is in use and how much more this start needs.
`Reconciled` stays true — the render succeeded; the start was refused.
Before that refusal is published the owner's idle agents are hibernated to free the room ([below](#reclaiming-room-for-a-blocked-start)), and the parked retry starts it once their machines have stopped.
A consumer must treat the condition message as the explanation of `OverBudget`, not derive one from figures.

A machine the runner had room for but the node has not yet granted the runner pod (`MachineAwaitingAllocation`) is not published on this condition.
The pod's limit is the owner's whole pool, and what the node has allocated the pod follows the machines' use, so a start can wait a few seconds for the resize that covers it ([vm-memory](vm-memory.md)).
A start still waiting after a minute is published under `MachineAllocationUnreadable` instead, which names the node that never reported the grant and is retried at the parked tick; no budget is to blame, so the page says so rather than offering a bigger pool, and a wake fails on it at once rather than at its timeout.
It reads as a start in progress, not as a refusal: the Agent carries `AwaitingAllocation` on `Ready` instead, its sentence says the agent is waiting for the node and starts on its own once it does, no refusal is announced, and a wake waits for it the way it waits for any start in progress.
No idle agent is hibernated while the node is still enacting that resize: nothing the owner disables frees memory the node has not handed over, and the controller asks the node for it in the reconcile that saw the wait.
A deferred or refused resize lands on nothing, so from then on nothing is pending and the wait ends on its own the way an `OverBudget` park does: the owner's idle agents are hibernated for the room the node did grant, and the start is retried at the machine watch's few seconds with the parked tick under it, so one that outlasts the wait still comes back.

A runner that has just restarted is refused under a reason of its own instead: for ten minutes after the owner's runner pod started, a refusal for room is the machines the restart is bringing back holding the pool at their warm-up floors rather than the owner's memory being full ([vm-memory](vm-memory.md)).
The Agent then carries `AwaitingWarmUp` on `Ready`, its sentence names the wave, and the owner's idle agents are left alone until the window is over, which the 90% pass holds to as well.
Past the window it is an `OverBudget` refusal again, hibernating idle agents under the same rules as above.
A refusal that hibernated one of those agents is published as `AwaitingMemory` instead, and reads as a start in progress: the memory the agent it put to sleep holds frees within seconds, so the owner is told the platform is making room rather than asked to disable an agent.
A refusal that hibernated nobody is published that way for twenty seconds first, so a peer going idle a moment later is reclaimed rather than refused in the second the owner takes to read it; the grace is kept per start in the controller's memory and spent once, so a retry of the same refusal reads the refusal.
That wait lasts the minute after the last agent a reclaim hibernated for the start; past it the start is an `OverBudget` refusal with the message that says what frees it.

A parked agent **starts by itself** once room frees, whatever woke it, the Start button included: a runner roll, a controller restart or a schedule retry brings many of an owner's agents back at once with no fresh activity bump, the runner admits as many as the warm-up floor lets warm up together ([vm-memory](vm-memory.md)), and nobody presses Start again for the rest.
A dedicated retry tick re-enqueues parked agents every ~30 s, and starts the first ones that fit once others have warmed up or idle agents have been hibernated, as its message tells the owner.
A start waiting for the node is retried before the parked tick reaches it, so it comes back as soon as the node grants the room ([above](#enforcement)).
An over-budget Invocation spawn therefore simply queues until room frees (e.g. earlier invocations completing), bounded by the Invocation's own liveness deadline.
If a parked agent's activity window lapses, the idle checker's sweep restamps plain `Hibernated` and it becomes an ordinary sleeping agent.
Already-running machines are never re-checked by resyncs or pool changes: a pool that falls is the target of admission and reclaim, never an eviction ([vm-memory](vm-memory.md)).

Creates are refused only for storage, once the owner's claim passes its critical level ([vm storage](vm-storage.md#the-owners-claim)); a create the memory pool cannot start simply lands parked, and the UI's job is to make "free some room" obvious.
This also means the whole enforcement path is invisible on the happy path: users with room never touch it.

The home dashboard's resource card shows the pools: memory and storage as bars showing how much is used of how much, each agent's share a segment largest first, with what the pool counts beyond the agents' own shares — headroom for memory; for storage logs and system — as the last.
Its header carries the operator's budget-request link, or no link when the install names none.
Once storage reaches the warning level, or an agent reports its own disk full, a list under its bar says what fills it, largest first: each agent's disk, which only deleting the agent or having it delete files frees and which leads to that agent, and what is left.
An agent whose own disk is full says so on its row — its writes are failing while it keeps running — so the owner sees which agent to open where they go to free space.
CPU's bar is its congestion, with its word beside it, not a use against a limit, because the limit moves with the machines running and reaching it fails nothing.
The bar's colour and the meter's spoken value carry the level; at warning or critical a warning sign beside the pool's name says what to do — disable agents not in use, delete old ones or have them clean their disks, or, for CPU, which agents use the most — and at critical what the platform does: idle agents are put to sleep for memory, and new agents are refused for storage, plus, for a user who has not linked Slack where the install has it, how to link it to get these alerts there.
Each agent's row carries its own memory and storage, and the dashboard reads the figures again every 15 s while it is open.
A start the controller parks raises a dialog that names the cause and sends the user to the agent list on the home dashboard to free room.
First-time users with no agents see none of it.

## Reclaiming room for a blocked start

Before a refusal is published, the controller tries to make the room itself: it hibernates the owner's own **unattended idle** agents ahead of their idle timeout, longest-idle first, then asks the runner again.
The blocked start is usually blocked by room its owner has already finished with, sitting behind a timeout that hasn't lapsed — an hour on the chart default — and the alternative is asking the user to go stop something they thought they were done with.
Every start path gets this, including schedule fires and channel-driven wakes, which is where a manual "free some room" resolution is worst: nobody is present to perform it.
The same rules bound the passes that free memory on their own initiative — an owner whose counted memory passes 90% of the runner's limit, and a runner's pressure signal ([vm-memory](vm-memory.md)).

Four rules bound it:

- **Unattended only.** A session pin (`active-session`), an Invocation pin, or a sweepable Invocation target (whose driver is blocked on its result) is never a candidate, and neither is a **never-hibernate** agent — effective timeout `0` declares "always run", not a default to be overridden.
  The pins carry this weight because the runtime's own idle flag reads an attached-but-turnless chat as idle: probe alone would reclaim a machine somebody is watching.
  Candidates are then probed as an ordinary hibernation probes, so declared in-flight work is spared, but only a candidate whose status says it is idle is reclaimed.
  Hibernation takes a silent agent as idle, so one that is down still sleeps; a reclaim does not, since an agent deep in a long turn with its guest saturated, or whose address just moved, is silent too.
- **An idle floor** (3 minutes) beneath which nothing is reclaimed, for the passes that free room on their own initiative.
  The reclaim a blocked start asks for is the owner asking for a machine now, so its floor is half a minute, and none at all for a peer whose machine began holding memory inside that half minute: a machine woken to answer one request and left idle is the room it holds, while a readiness that recovered from a failed request is no wake and keeps the half minute.
  What makes reclaim **non-recursive** is not the floor but the state a reclaim leaves: the agent it took is down, its gateway at zero and its activity stamp spent, by a stamp written to the sub-second precision the activity carries, so a reclaim in the activity's own second still outdates it; it is then neither up as a candidate nor holding anything, and the start that displaced it holds nothing while it waits.
  That is what stops A-evicting-B-evicting-A from cycling, and a start whose machine is booting is not a victim either.
- **Provably sufficient, or nothing.** The candidates' counted memory must cover the shortfall before any of them is touched, so no agent is ever hibernated for a start that was going to be refused regardless.
  The one exception is a runner's own memory pressure signal, which hibernates what it can rather than nothing, since an OOM kill would take a machine down ([vm-memory](vm-memory.md)).
- **A reclaimed agent stays down.** Its activity stamp is still inside its own timeout — that is the premise of reclaiming it early — so it is marked as having *spent* that stamp and only a **newer** activity bump revives it, back through admission like any other start.
  Without that, the victim's own next reconcile would take the room straight back.
  The mark is self-clearing: a deliberate touch outdates it.

Each victim is read again immediately before it is put to sleep, because the idle probe takes time and the api-server writes pins and activity without taking the controller's owner lock.
A victim that gained a pin, fresh activity or a stop request since it was chosen is left running, and the reclaim stamp is written only onto the version of the Agent that read saw, so a write landing between that read and the stamp fails it and spares the victim too.
The floor that read is held to is the one that chose the victim, so a peer freed for a blocked start is still judged by the half minute.
The other victims are still reclaimed, since the room the start needs is freed by whichever of them holds it.
A victim left running counts nothing as room made: only the machines a reclaim actually put to sleep earn the start its wait.

Reclaiming is **announced, not asked**.
The eligibility rules confine it to agents with no attached viewer, and the outcome — hibernated somewhat sooner than its own timer said — is one the agent's settings already sanction, so nobody is asked first.
The victim lands in ordinary `Hibernated` state, but while its reclaim mark stands the api-server reads it off the Agent and the agent says it was put to sleep automatically to free memory for the owner's other agents ([vm-memory](vm-memory.md)) — in its unavailable view and its row, with a one-time notice in an open web app.
A deliberate touch outdates the mark, and the message with it.
A Sleep removes the mark, since it stales last activity behind it, so an agent its user put to sleep never reads as put to sleep automatically; disabling an agent clears the mark outright.
The exposure this adds is hibernation's existing blind spot (unreported work, which no signal sees) arriving earlier than advertised; the floor bounds it and the escape is unchanged: disable hibernation on agents whose real work runs off-session.

## Failure semantics upstream

The api-server classifies the `OverBudget` condition reason into a typed wake-failure (non-transient, fail-fast — a denied wake errors in about a reconcile round-trip, not a wake-timeout), so the UI, relays and scheduler all inherit the same message, and that message is the producer's own.
For a machine the runner refused for the owner's memory (`MachineOutOfCapacity`) it is the controller's sentence, giving in GiB how much of the pool is in use out of the same total Home shows and how much more the start needs, when the controller can read them, rather than the runner's accounting.
A machine the node has not granted yet (`MachineAwaitingAllocation`) is not a denial at all: the controller publishes it under its own `AwaitingAllocation` reason, which the api-server reads as a start in progress, so a wake waits for it rather than failing, no scheduled fire is recorded as failed, and a channel reply says nothing about the owner's room.
Its message names no figures: the pool has room, and the wait ends when the node enacts the resize, or when the room the node did grant is freed from the owner's idle agents.
A channel reply goes to whoever wrote in, who need not be the owner, so it says only that the owner's agents are using all their room, never the owner's figures or what the owner should do.
A scheduled fire on an over-budget agent records a failed fire; the trigger event is already durably committed to the outbox, so it redelivers once room frees, or expires when the schedule's next occurrence supersedes it.

The fail-fast is a **heuristic**, not a raw condition read: a parked agent keeps its `OverBudget` condition standing, and the condition doesn't say which wake attempt it applies to — so a fresh wake's first poll would otherwise see the *previous* attempt's denial and fail a start that room now permits.
The wake therefore treats `OverBudget` as its own denial only when it *observed the condition appear* during its own poll (the controller ruled on this attempt), or once a short grace window (~10s, comfortably above the informer-driven reconcile latency) passes with the refusal still standing.
A stale denial inside the grace rides through to the reconcile of the wake's activity bump, which admits or re-denies well within the window.
Deliberately local to the api-server: the alternative — echoing the denied activity value through the Agent status — buys exactness at the price of a CRD schema field and a cross-component contract, which this failure mode doesn't warrant.

## Freeing room

Users free capacity by [disabling](agent-lifecycle.md#disable) an agent they aren't using or letting it hibernate — and, for a start they are blocked on, the controller frees it for them where it can ([above](#reclaiming-room-for-a-blocked-start)).
Storage is freed only by deleting an agent or having it delete files, since a stopped machine keeps its disk.

## Resource alerts

An owner hears about a severe resource problem even when nobody is looking at the web app: the platform sends them a Slack direct message ([channels](channels.md)) when their agents' shared storage passes 90% — no new agent can be created — or 95% — writes are failing ([vm storage](vm-storage.md#the-owners-claim)), and when their runner was killed for running out of memory ([vm-memory](vm-memory.md)).
Each message gives the figures or the agents affected, and what to do.
Lower levels show only in the web app.

The api-server evaluates them unattended, on one replica at a time.
Storage is read every five minutes from each owner's runner, through the same read-only usage read the create refusal uses, ten runners at a time so a pass over many unreachable runners still ends well inside its interval; a runner it cannot read changes nothing, and one owner's failed evaluation is logged without stopping the others.
An out-of-memory kill is seen on the agents the controller marks with it, collected over a short window so one message names every affected agent.

Messages are limited so an owner near a threshold is not messaged at every reading:

- **Storage** sends once per rise past the level last told, at most once a day, except one escalation from 90% to 95% inside the day; the level holds between 80% and 90%, and a reading under 80% re-arms it.
- **Out of memory** sends once per episode, which ends when no agent carries the mark, and again only six hours after the last message, so a runner killed in a loop sends one.

Each alert's state is a Postgres row per owner and kind.
A message goes out only after a compare-and-set write of the next state wins, so two evaluations racing, or a lease handover, never send it twice; a send that then fails is lost rather than repeated.
A user who never linked Slack (`/platform login`) gets no message; there is no opt-out, and a reply to one is not handled.
