# Schedules

Last verified: 2026-10-27

## Overview

A **Schedule** is a task attached to an Agent that fires on its own: a cron or RRULE recurrence — or a single moment, a **one-time schedule** — a task prompt, and for a recurrence an optional **Precheck** that decides each occurrence before any model is woken.
Schedules are the one way work starts on an Agent with nobody watching, which is why they own three things no other caller needs — arming the next occurrence durably, waking a hibernated Agent to receive a fire, and deciding whether a fire is worth a turn at all.

The subsystem straddles two components.
The api-server owns the schedule rows, the queue that arms them, and the decision to fire; agent-runtime owns what a fire *becomes* — the Session it opens, the Precheck it runs first, and the verdict it reports back.
Everything between the two — the outbox, the delivery worker, the event's TTL — belongs to [runtime delivery](runtime-delivery.md) and is not restated here.
Waking and hibernating the Agent a fire lands on belong to [agent-lifecycle](agent-lifecycle.md).

Schedules are authored per Agent, but they are also read across them: one owner-scoped list, narrowed to the Agents an API key is bound to, gives the owner every schedule that runs on their behalf in one place.
It matters most for the schedules an Agent set up for itself in chat, which otherwise surface only in that Agent's own panel and keep spending until someone notices them.

Pausing and resuming a schedule names the state the caller wants rather than flipping it, so a request re-sent after its answer was lost, or the same switch flipped from two stale tabs, lands where the caller meant.
A request that names no state still flips, so a CLI older than the server keeps working ([cli](cli.md#compatibility-negotiation)).

## Fire

Schedules are Postgres rows owned by the api-server, each armed as a delayed job on a Redis-backed queue — one pending job per schedule, re-armed after every fire.
Fires are idempotent per occurrence, so at-least-once delivery cannot run one twice and a boot cannot swallow one that is due; a periodic reconcile re-arms any schedule whose queue job vanished.
The next occurrence is computed from the schedule's cron or RRULE expression in its timezone, skipping any occurrence that falls inside an enabled quiet-hours window.
Suppressed fires are dropped, not deferred — quiet hours mean "skip these," not "queue for later" — and a schedule whose every occurrence is quiet is rejected at save time.
Every RRULE counts its steps from one fixed start — midnight on 1 January 2001 in the schedule's timezone, a Monday and the first of a month — so its occurrences never depend on when they are computed and stay put across restarts and re-arms: an unanchored rule defaults to midnight, weekly to Monday, monthly to the 1st.
`COUNT` is rejected, because counted from that start it would be spent, and so is `FREQ=SECONDLY`, because schedules fire at minute granularity.
A rule with no future occurrence is rejected at save time; the occurrence search runs on the api-server's event loop, so every search is capped in the periods and candidate times it may examine, and a rule that can never fire answers at once instead of blocking it.
An occurrence inside quiet hours resumes the search at the end of that window, and a rule still quiet after 64 windows counts as covered.
Rules longer than 1,000 characters, with an `INTERVAL` above 10,000, or with a `BY*` value out of range (`BYHOUR` 0–23, `BYMINUTE` and `BYSECOND` 0–59 with no leap second, `BYMONTH` 1–12, `BYMONTHDAY` ±1–31, and so on) are rejected; the RRULE parser would otherwise drop such a value and fire more often than the rule says.
The schedule form runs the same check as the save call, so it shows a refused rule's reason inline instead of a preview.
A cron expression always fires in UTC, and a cron schedule has no timezone and no quiet hours.
A user edits a cron schedule they created as cron, or converts it to an RRULE to get both.
The conversion keeps the cron fields' values and reads them in a timezone the user picks — UTC by default, so the schedule fires at the same moments — and it shows the next runs before and after.
An expression with no exact RRULE match is not converted and stays a cron schedule: one that names both days of the month and days of the week, which cron matches as either, or one that uses `L`, `W`, `#`, `H` or seconds.
A local time erased by the spring-forward jump is skipped, as RFC 5545 requires.
An enabled schedule with no next run shows why — a refused rule, one that never fires or has run out, or quiet hours that cover every remaining occurrence — worked out when the schedule is read, so it clears the moment an edit re-arms it.

When a fire is due:

1. The api-server inserts a `trigger` event into the Agent's runtime outbox in the same transaction that bumps the Agent's version, then signals the delivery worker.
   The fire is durable from this point; a recurring schedule re-arms once the commit succeeds; a failed commit is retried by the queue, then by the reconcile.
2. The api-server pokes the Agent's activity annotation so the reconciler scales a hibernated Agent up.
   The poke never waits on readiness; a poke that errors is recorded as a failed fire on the schedule's status (a [one-time schedule](#one-time-schedules) excepted), but the committed event still delivers if the Agent comes `Ready` within its TTL.
3. The delivery worker pushes the event over the runtime channel's `applyState` — only once the Agent is `Ready`.
   A waking Agent picks pending events up on its boot-time `hello` catch-up.
   Every event carries a TTL, so an Agent that stays down through several occurrences (error state, failed poke) doesn't replay a backlog of stale fires when it eventually wakes.
   Outbox mechanics — versioning, the sweep, expiry — are owned by [runtime delivery](runtime-delivery.md#event-lifecycle).
4. agent-runtime's trigger handler opens an ACP session against the harness over an in-process channel and submits the task as a prompt.
   The turn itself runs asynchronously in the harness, and the event settles once the prompt is submitted.
   **A fire carrying a Precheck settles earlier — the moment the handler accepts it** — and decides afterwards: the handler runs inside the delivery call, and a check may run for minutes ([runtime delivery](runtime-delivery.md#event-lifecycle)).

A fire on an Agent created from a [starter kit](starter-kits.md#concepts) whose onboarding is still pending is **held** before step 1: no event is inserted, the next occurrence is computed and armed as usual, and the schedule's last result reads `held: onboarding not complete`, which the schedules page shows as held rather than failed.
The hold reads the Agent's onboarding annotation and lifts the moment the mark lands.
A fire on a [disabled](agent-lifecycle.md#disable) Agent is held too, reading `held: agent disabled`, and a one-time task due while it is disabled is recorded missed rather than left to wait for an enable.
A fire whose payer is at a [spend limit or the Spend Ceiling](spend-limits.md#unattended-work) is held the same way, reading `held: spend limit reached for today` or `held: spend ceiling reached for today`.
That check runs once the fire's provider Connection is chosen, so a limit on that Connection counts as well.

A fire refused before step 1 — the schedule's own choices no longer hold, or no granted provider can run its harness — starts nothing, and unlike a hold it gets no closer to running: it records the reason and arms the next occurrence, and the last-run stamp keeps the last fire that actually ran.
That stamp is what a Precheck measures "anything new since last time?"
from, so a fire that never happened must not move it.
The refusal comes back at every occurrence until the schedule's choices or the Agent's granted providers change.

An event that is never delivered stays pending in Postgres and is redelivered until it settles or expires, and the agent keeps a last-fire timestamp per schedule on its home disk, so a redelivered or superseded fire never runs twice.
That safety net ends where a fire is settled.
For an ordinary fire it covers everything up to the prompt; for a prechecked one it stops at acceptance, so a check that never finishes reaches only the machine's log; a session that then fails to open is reported as a failed run.
Losing an occurrence that way is the price of not holding the channel open, and for a recurring check the next occurrence pays it back.

## One-time schedules

A task meant to happen once — a check-back, a retry after a transient failure, a hand-off to a session of its own — is a Schedule whose recurrence is a single moment, held in the timezone it was given in.
It is a Schedule rather than a concept of its own because it needs exactly what a recurring fire needs: an arm that survives a restart, a wake for a hibernated Agent, and the outbox rail.
Handing over a task *now* is the same thing with the moment omitted; it fires at creation, so everything that ran unattended is listed in one place whether a user or the agent started it.
The moment is always absolute — a relative delay is not accepted, and the resolved instant is echoed back to the caller, which is how an agent that miscounted the current time finds out.

What a single occurrence changes follows from it having **no next occurrence to make up for a lost one**:

- **It never re-arms.** Completion is derived from the row — it fired and has no next run — rather than stored, so it cannot disagree with the fire that produced it.
  A completed one leaves the list of what will still happen and stays as history beside the Session it opened, then is pruned 30 days after it fired, a failed fire included.
  Cancelling is deleting; it can be edited only until it fires; deleting one already on its way does not recall the event.
- **Its result is recorded by delivery, not by commit.** A recurring fire writes its result when the event commits, and a fire lost after that is paid back by the next one.
  A one-time fire has no next one, so it writes *delivering* in the transaction that commits its event — a settle can never land before it — and reads it until its event settles on the machine (then *success*) or expires undelivered (then *missed*).
  A wake that fails after that commit leaves it *delivering* rather than recording the failure, since the event is already on its way; the fire's retry finds it committed and only pokes the Agent again.
  Both transitions come from runtime delivery's per-kind listeners, notified on the api-server once the settle or the drop has committed — no report from the machine, so a runtime too old to know the kind still resolves.
  The fire's own outcome — the one the audit log, the activity feed and usage count — comes from that same transition, so no surface reports a one-time task as succeeded before the machine has it.
  One fire reports one outcome, from that transition alone: a poke that fails after the commit says nothing, since the event it already committed settles or expires on its own.
  Delivery is not the run: a one-time fire's first turn can still end in failure, and no next occurrence corrects it.
  So the Session that fire opened carries the fire's event, and a turn of it that ends in an error reports the fire failed with its reason over the same event report a refused run uses — the schedule then reads failed instead of succeeded.
  The report lands after the fire settled, which is why the settle replaces *delivering* only: a result the machine has since corrected is never overwritten by the delivery that preceded it.
  Only a one-time fire's Session carries that event, and its first turn's end forgets it, so a turn a person sends into that Session later cannot fail the schedule for work that did happen; a recurring fire and a person's chat report nothing, since a failed turn there is theirs.
- **Its delivery window is a day, not an hour.** The event expires 24 hours after the moment, and a queue job that runs late inside that window still fires — an Agent in error state or out of budget for a while still gets the task, where a recurring fire would rather skip to the next occurrence.
  One whose window passed before it could be fired at all is recorded *missed* by the reconcile.
- **Nothing may skip it.** It takes no Precheck, since a decline would mean *never* rather than *not this time*, and no quiet hours, since its moment was chosen deliberately.
  Neither the onboarding hold nor the disabled hold applies — a hold guards a cadence, and skipping a single occurrence would lose the task outright; a task due while its Agent is disabled waits out the enable inside its delivery window.
  A [spend limit or the Spend Ceiling](spend-limits.md#unattended-work) only delays it the same way: the fire records nothing and re-arms for the next UTC midnight, when the limit starts again, and the owner setting or continuing a limit re-arms it at once.
  A sleep's stop stamp is overridden exactly as a recurring fire overrides it.
- **It opens a fresh Session** unless tied to the one that scheduled it (below), typed as a one-time schedule's so the surfaces group it with scheduled work.
  That session can run on a **model of its own** rather than the default — a routine check-back on a cheap model, a hard one-off on a strong one — where the harness can switch a session's model ([harness-config](harness-config.md)); the choice is refused at creation where it cannot, and a harness that still refuses the switch when the task fires fails the task with its reason rather than running it on a model nobody chose.
  A task that continues its scheduling session keeps that session's model.

An agent may also tie one to **the session that scheduled it**: *continue* makes the task a new turn in that session when it is due, so a check-back keeps the context it was asked in; *report* runs it in a fresh session and, when that turn ends, hands its text back to the scheduling session as a new turn.
Either way the scheduling session must be known for certain, and the platform tool has no session of its own — the MCP endpoint is one per agent.
So agent-runtime gives every session a reference of its own and hands the harness, for each session it opens or loads, its own copy of the platform MCP entry carrying that reference; the tool records it, and the runtime resolves it back when the fire lands.
A harness that does not honour a per-session entry sends no reference, and the tool refuses to tie the task to a session rather than guess.
Codex's ACP adapter drops a session's entry whose name its `config.toml` already holds, and the platform entry is there for the terminal's `codex`, so Codex chat processes run with that filtering off and the session's own entry wins.
Pi's adapter takes no HTTP servers, so the reference reaches Pi another way: the image's patch of the adapter starts each session's Pi process with the reference its session carried, and the platform entry in Pi's own file names it in its header, which Pi fills in per process.
Bob takes a session's entry too, but keeps one server per name and lets its own settings file's entry outrank it, and the platform entry is in that file for the terminal's `bob chat`; so Bob's chat process alone runs with a preload that hides the file's platform entry from what Bob reads and restores it in what Bob writes, and the session's own entry wins.
A session the runtime opens for a rewind or a fork gets the entry the same way: a fork with a reference of its own, a rewind with the original's, since it takes the original's place.
The turn that lands in the scheduling session runs **unattended**, as a scheduled fire does, even in a person's chat with no tab open — a permission request in it waits on Home for a verdict the way a detached run's does, and expires only when nobody answers it in time ([cli](cli.md#headless-runs)).
If that session is gone by then, *continue* runs the task in a fresh session instead, so it is not lost; *report* drops the result, since there is nobody left to tell.

An agent creates one through a platform tool of its own — kept apart from the recurring one so a model reaching for "once" is not steered through recurrence and Precheck options that do not apply.
Since an agent may create one from any Session, a scheduled one included (a retry, the next check-back), a buggy task could schedule itself without end; agent-created one-time schedules are therefore bounded by how many may wait at once and how many may be created in an hour, both deployment settings.
Users are not bound by them.
A starter kit cannot declare one: an absolute moment means nothing in a kit applied at any time.

## Precheck

A schedule carries an optional shell command that decides its own fires.
Most fires of a periodic check — "did a new PR land?", "is the queue backing up?"
— find nothing to do, and reaching that answer through a model is the most expensive way to ask a question a timestamp comparison could settle.
The Precheck moves the question out of the turn.

It runs in the machine, in the workspace directory, under `bash -lc` with the runtime process's own environment — so `HTTPS_PROXY` still points at the paired gateway and a check may reach GitHub or an API with the same injected credentials the agent gets ([security-and-credentials](security-and-credentials.md)).
Running it there is the point: the inputs a real check needs — the workspace, the checkout, credentialed network access — are already present, with no new plumbing to feed them anywhere else.
The schedule's id, the occurrence being decided, and the time of the last fire that actually started a run arrive as environment variables, so "anything new since last time?"
needs no bookkeeping of its own.

The exit code is the verdict, split the way `grep` splits it: `0` allows the run, `1` declines this occurrence, and every other way the command can end — a higher code, the two-minute deadline, a command that will not spawn — means the Precheck itself broke.
A broken Precheck **allows** the run and records the reason, because an optimization that breaks should degrade to the unoptimized behaviour rather than silently stop the work; the opposite default would let one typo exiting `127` silence a schedule for weeks while looking exactly like "nothing changed".
A runtime image too old to know the field ignores it and runs, which is the same fail-open.
Whatever the command prints on stdout is appended to the task prompt (byte-capped), so the expensive turn does not re-derive what the cheap check just found; stderr does not, except that a broken Precheck's recorded reason carries the tail of it — so the reason reaches the owner's panel and the CLI too, and a check that prints secrets to stderr will show them there.
A broken Precheck still contributes that block, carrying what it managed to print marked as unverified, or saying there is none — a task written as "process the items listed below" must never be followed by nothing, or the run acts on a reference it cannot resolve.

Only the machine knows the verdict, so it reports each one back over the runtime channel's generic **event report**, naming the fire by its own event id ([runtime delivery](runtime-delivery.md#event-report--agent--api-server)); the api-server checks that the event belongs to the calling Agent, routes on its kind, and records the verdict on the schedule.
The Precheck does not hold the fire's delivery open while it runs — the trigger settles when the machine accepts it, or a two-minute check would stop every other change reaching that Agent.
**A schedule with a Precheck records its outcome only once the verdict exists**: the fire itself arms the next occurrence and clears a failure result left standing from before, and the report that follows writes one of two things — the last-run pair (allowed, and a broken Precheck that ran anyway), or a **declined fire** (`declined`), which clears that failure too.
The decline count is *since the last run*, not a lifetime total — a run resets it — so what the panel shows is how many fires the Precheck has saved since work last actually happened, which is the number that says whether the check is still finding anything (an [on-demand run](#on-demand-run) the Precheck declines counts here too, which is why the unit is fires rather than occurrences).
That is what keeps the three states apart in the row the user reads, and it is what makes the last-run stamp mean *the last fire that actually ran* — the meaning the Precheck's own environment depends on.
A schedule with no Precheck is unchanged: nothing will report, so the fire records its own delivery as before.
The consequence for a runtime image too old to know the field is cosmetic and self-correcting — it runs the task but never reports, so the panel keeps showing the previous run until the image catches up.

A broken Precheck is recorded beside the run it allowed and counted with it.
Two things clear that record — the next verdict that isn't a failure, and **editing or removing the Precheck**, since an error recorded against one command says nothing about another.
A third case is not cleared but **dropped**: a verdict that describes a Precheck the schedule no longer runs.
The check is detached, so an owner can swap the command while one is in flight; writing that verdict would attribute it to a command that never produced it, and clearing on it would wipe what the new command had already recorded.
The fire's payload carries the command that ran, which is what lets the report be matched to it.

A report can also simply never arrive — the machine can stop mid-check.
Then the fire leaves no verdict behind: the only write is the failure result it cleared when it committed, and the last-run stamp keeps its earlier value, so the next Precheck is told work happened longer ago than it did.
The direction is deliberate.
An older stamp makes a check find *more* than it should and run again, where a newer one would make it skip an interval's work silently, and the next report that lands corrects it.
Its count is consecutive — since the script last ran and returned a verdict at all, allow or decline alike — because a run cannot clear it the way a run clears the decline count: a broken Precheck is what let that run happen, so counting from the last run would read *one* forever and never say that a check has been failing all week.
Every report also announces the schedule as changed, so an open UI re-reads rather than waiting for an incidental refresh — which is what puts a broken Precheck in front of its owner on the home surface instead of only in the schedule's own panel.

The declined report also undoes the fire's own cost.
The poke in step 2 stamps `last-activity`, which is what keeps a woken Agent from hibernating; a Precheck firing more often than the idle timeout would therefore hold its Agent awake permanently and spend more compute than the turns it saved.
So the api-server stashes the stamp it wrote — keyed by occurrence, on a short expiry of its own, and consumed by the first report that claims it — and on a declined report restores the value that preceded it, compare-and-restore against its own stamp, the same shape the [sleep flow](agent-lifecycle.md#hibernate) uses, so activity that arrived during the check keeps the Agent warm.
What it does not undo is the cleared stop stamp: a fire overrides a sleep by design, and a declined one leaves the Agent started rather than racing a user who may have started it by hand meanwhile.

The honest limit: this keeps the prompt, the context and the cache out of a declined path, but the Agent still wakes to run the check.
Deciding without waking it at all would mean running user code with credentials outside today's boundary, and is not attempted here.

## Session continuity

The session model differs by schedule mode (a one-time schedule is fresh, or lands in the session that scheduled it):

- **Fresh schedule** — every fire creates a new session via `session/new`.
  The schedule accumulates a list of sessions over time, browseable under the schedules tab.
- **Continuous schedule** — the first fire creates a session via `session/new`; every subsequent fire calls `session/resume` against the same session id.
  One schedule, one session, history retained across fires.
  A schedule that names no choices of its own runs that session on the scheduled default, and the session follows it from its next fire ([sessions](sessions.md#session-inside-the-machine)).

The schedule↔session link is agent-owned: schedule sessions are typed (`schedule_cron`, or `schedule_once` for a one-time schedule) through ACP session metadata, and the continuous binding is a per-schedule entry in a state file on the agent's home disk.
A one-time task that continues its scheduling session opens no session of its own, so the session it continued records the schedule on itself, and a schedule's sessions are the ones it opened plus the ones it continued.
That is how the schedules tab reaches the chat a check-back ran in.
The list is not the session's `scheduleId`: a chat continued by several tasks belongs to each of them, and stays a chat.
Boot recovery moves that binding when it re-runs a continuous schedule's cut first turn in a fresh session, so the next fire continues the session that holds the work instead of one it retired.
Resetting a continuous schedule rides the same outbox rail as fires — a `schedule-reset` event clears the binding on delivery, so the next fire starts fresh.
Unlike a fire, a reset does not poke the Agent awake: one that stays hibernated past the event's TTL expires undelivered, and the next fire resumes the old session.
Within a continuous schedule fires serialize naturally — each resumes the same session, prompts queuing at the runtime — while fresh fires each open their own session and may run concurrently.

A schedule may carry a **session title**, which the runtime stamps on each session a fire opens, in place of the title the harness derives from the task.
It names a session only when the session is opened: a continuous schedule names its one session at the first fire, so a later edit, or a rename by the user or the agent, is never overwritten by the next fire.
A one-time task that continues the session that scheduled it takes no title, since that session already has one.
Every run of a fresh schedule gets the same title.
How the title reaches the session list belongs to [platform topology](platform-topology.md).

## Session choices

A schedule, recurring or [one-time](#one-time-schedules), carries the same choices as a session: the **harness** its sessions run on, their **model** as a qualified name (`<alias>/<model id>`, [harness configuration](harness-config.md#the-model-router)) and the harness's per-session **settings** (an effort level, a reasoning mode), which include the session's platform sub-agent settings ([session settings](harness-config.md#session-settings)).
A schedule's choices live on its sessions alone.
Each choice is optional; an unset one takes the agent's scheduled default, which is the chat default unless the owner saved one for schedules ([harness configuration](harness-config.md#session-settings)), and its settings.
The schedule tools tell the agent that the owner sets that default and that a schedule names choices of its own only for a reason the task gives.
The scheduled section of the agent's Providers page lists every schedule that names a harness, model or settings of its own, except a one-time task that continues its session, and moves one or all of them to the scheduled default by clearing those choices; moving all asks first, listing each change.
With no default model saved, a fire fails with that reason on its first attempt, with no retry, and Run Now refuses with it.
On a runtime that takes no model per session, a fire drops a schedule model that names the agent's own model setting (the copy the upgrade made) and runs as before; one that names another model is refused.

**Checked twice, the same way.** The choices are checked at save and at each fire with one rule: the harness is one the agent's image carries; the model's provider is granted and accepted by the harness, and the model is on the list the harness last reported; the settings are ones the harness offers, valid for that model, and the platform sub-agent settings are ones the chosen sub-agent harness offers.
A save that fails names the reason.
A fire whose choices no longer hold, because a provider was revoked or a model left the list, is refused with that reason rather than running on a substitute.
A one-time task that continues its scheduling session keeps that session's choices.
An agent creating a schedule names the same choices through its tools.

Each fire opens its session on the schedule's choices, or pins a resumed session to the model before the resume, so a continuous schedule picks up an edited choice at its next fire; the model and settings reach the harness per turn ([agent-lifecycle](sessions.md#session-inside-the-machine)).
The provider follows the model's name: a schedule on `openai/gpt-5.5` fires on the agent's OpenAI Connection whatever its default for the harness.

On a runtime with one harness process ([harness configuration](harness-config.md)) the pre-router rule stands: a schedule names no harness or settings, and its model must be one of the runtime's listed choices.
There a schedule with no model runs on the harness's **default**, never on the model the Agent is set to; where the harness has no default, it follows the Agent's model.

**Migration.** A schedule saved with a bare model was qualified with the alias of the agent's one provider; with several, its model was cleared and the schedule carries `migrationNote` until its owner picks a model again.
The one-shot SQL migration carries its dry-run count query in its comment.

**A refused fire records its reason, and, on a recurring schedule, the last-run stamp stays put.** The last result names the reason, the schedule's card in the panel shows it in the failure colour, and the stamp keeps the last fire that actually ran, since a Precheck measures "anything new since last time?"
from it.
A one-time schedule is the exception: its stamp is the flag that says the task already fired, so a refused one-time fire writes it (and records its reason as the task's result).
The reason clears itself when the schedule works again — a fire that commits, or a Precheck that declines, replaces the failure.
A held fire records its reason the same way and leaves the stamp too: nothing ran, and the hold lifts on its own.
A refusal the api-server reaches before it commits the trigger — a saved choice that no longer holds, or no granted provider that can run the harness — delivers nothing and wakes nothing: the fire writes the reason and arms the next occurrence.
A refusal the runtime reaches instead — a harness that refuses the session's model at fire time — settles as a failed *run*, a stage distinct from a broken Precheck, so it is not redelivered, and leaves the unprompted session behind, empty.
Follow-up turns keep the session's model as far as the harness restores it on reload.

In a session with scheduled runs, each reply shows the model that answered it in a muted line, as the harness reports it: Claude Code only today, and the main conversation's model, never a subagent's.
The runtime carries it on the turn's end-of-turn signal; the history reader stamps replies it replays from disk.

## On-demand run

A schedule can also be fired from outside its recurrence: the owner asks for one run, now.
Authoring a schedule is iterative — the task gets reworded, the Precheck tweaked — and with cadences hours apart, waiting for the next occurrence is as slow a feedback loop as the cadence itself.

It is deliberately *the same fire*, so what it shows is what an occurrence does: the same event kind on the same rail, carrying the same task, session mode and Precheck, decided by the Precheck as usual and reported back the same way.
The runtime cannot tell the two apart, which is the point — a check that allows here allows there.
What it does not do is behave like an occurrence:

- **The cadence is untouched.** No next occurrence is computed and none is armed, so trying a schedule out never shifts when it next fires — and the fire carries an identity of its own rather than an occurrence's, so the Agent's per-fire dedup cannot conflate it with the occurrence it lands beside.
- **Quiet hours do not suppress it, and neither does being disabled.** Both govern *occurrences*; this run was asked for by hand.
  A paused schedule is also the one most likely to be under construction, and enabling it just to try it would move its next occurrence — the thing the action exists to avoid.
- **A run that happens stamps the last-run pair** like any other, because that stamp means *the last fire that actually ran* and is what the next Precheck's "anything new since last time?"
  measures from — a manual run that did the work must not leave the next check to find it again.
  The boundary is the **outbox commit**, not the whole send: once the event is committed the task will run when the Agent is `Ready`, so any step that fails after it — the delivery enqueue or the wake poke — stamps the pair and records that failure as the result.
  Only a fire that never committed is not a run, and that one leaves the previous record standing.
- **Its expiry is its own.** An occurrence's fire expires at the next occurrence so a stale backlog cannot replay; an on-demand fire has no successor to be superseded by, and capping it at an occurrence minutes away would expire a run somebody is waiting for.
  It expires on the trigger TTL alone.

Two consequences reach what the owner reads.
A **declined on-demand run counts toward the decline count** like a declined occurrence — the count is still "since the last run", but it no longer counts *occurrences* only, and leaving it uncounted would make a run the owner just asked for show nothing at all.
And **usage counts an on-demand run as a fire of that schedule**, which is what it is: compute spent on that schedule's task.

The rest is inherited rather than re-decided.
A hibernated Agent is poked awake and picks the fire up on its catch-up; a stopped one is started, since a fire overrides a stop by design.
A continuous schedule resumes its own session, a declined verdict restores the activity stamp the poke wrote, and the session appears under the schedule's sessions like every other run.
Two cases refuse outright.
A one-time schedule has no cadence to try out, and a run beside its own would do the task twice.
And an Agent from a [starter kit](starter-kits.md#concepts) whose onboarding is still pending: a scheduled fire is *held* there because nobody is watching; here somebody is, so the refusal is reported rather than the fire quietly vanishing.
An Agent at a spend limit or the Spend Ceiling is refused the same way, with the reason.
A schedule whose saved choices no longer hold is refused with the reason a fire would fail with, so the owner reads what to fix instead of a generic failure.
A schedule with no granted provider that can run its harness is refused with that reason.
