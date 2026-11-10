# Invocations

Last verified: 2026-11-10

## Overview

An **Invocation** is a run-once request from one Agent to another: a **Driver** asks a **target** to do one piece of work and return one result that matches a JSON Schema the Driver supplied, or, for a script, the script's exit code and output.
The common case pairs it with a freshly spawned, Sweepable target — a *temporary agent* in the interface — that exists for that one task and is reaped soon after the Invocation goes terminal ([Outcomes](#outcomes)).

A Driver reaches Invocations two ways.
A script — a loop an agent wrote that fans work out and gathers the results — speaks over the per-agent HTTP surface on the harness port through the [Driver SDK](#driver-sdk).
An agent handing off one piece of work mid-task uses the [sub-agent tools](#sub-agent-tools) on its platform MCP server instead, without writing code.
Either way the caller is the waypoint-authenticated agent in the path; no request body ever names the Driver, and both surfaces resolve a spawn through the same code, so it means the same on either.
On either surface, a spawn can hand the target a shell command instead of a prompt, so deterministic work runs with no model turn ([script runs](#script-runs)).

```mermaid
sequenceDiagram
  participant D as driver script
  participant API as api-server
  participant T as target agent-runtime
  D->>API: spawn (prompt, result schema, setup, connections)
  API->>API: resolve target, provider, admission
  API->>T: create Agent, queue seed → config → install → task
  T->>T: seed, install, open one fresh session
  T->>API: report_result
  API->>API: validate against the schema, reap the target
  D->>API: poll until done or failed
```

## Spawning

**A target is set up like a kit-created Agent.** The spawn carries an **Agent Setup** — the part of a [starter kit](starter-kits.md) that decides what an Agent is and has: a repository to seed, an install command, env, disk, external skills.
A target holds no CPU or memory size of its own: it shares its owner's [pool](vm-memory.md).
Kits and spawns share the one definition, so a setup option added for kits reaches spawns in the same change, or is deliberately kit-only.
What a kit carries about discovery or about outliving one task — catalog display, schedules, channels, knowledge-base shares, a hibernation override — has no meaning for a target and is not accepted.
The spawn's prompt plays the role a kit's onboarding plays: it is the target's first and only turn.

**A spawn names a harness.** A harness in the install's harness catalog runs on the default Template — its image, env and mounts — with the target's own harness set to it, exactly as an Agent created there would; a harness only a custom Template declares still resolves to that Template.
A harness the install does not carry is refused, naming the ones it does; the catalogue the Driver reads lists each harness with the models it carries.
A spawn may bring its own image instead, the way a kit with its own image does: the target is then created from that image with the install's defaults, and the harness, when named, only says what runs inside it.
Either way the harness catalog, or the custom Template, states the providers the harness can run on, which is what Provider Inheritance checks.
The trigger that opens the target's first session names its harness, the inherited provider and the model; a model a spawn names is a qualified name (`ibm/gpt-5.5`), and a bare one is refused before anything is created.
The trigger also marks the run as an Invocation, so the target types that session as an Invocation run, which its session list and its spend by session type show as a run, not as a scheduled one; a target on a runtime from before that mark still types it as a scheduled run.

**A spawn may choose the model.** It can name the target's model, mode and harness settings — the choices the target's harness configuration offers — so one harness serves every model it runs, and a Driver can put one task to two models or a cheap model on a mechanical step.
The choice is written into the target's own harness configuration in a delivery of its own, ahead of the task, so the one session already runs on it ([harness configuration](harness-config.md)).
The `spawn_subagent` tool also refuses a model the driver's catalog does not list for the named harness.
It resolves each choice in one order: the calling Session's **platform sub-agent settings**, then the spawn's own choice, then, on the Session's own harness, the Session's model and settings, then the harness defaults.
The model has no harness default: a spawn onto a routed provider that ends with no model is refused at once, telling the agent to name one, since the target's runtime refuses a turn without a model ([harness configuration](harness-config.md)); a spawn of an image alone and one on Bedrock keep their own choices.
The Session's settings follow only its model: once the settings or the spawn name a model, they stay behind, since they may not hold for it.
A set harness binds: a spawn naming another is refused, and a spawn naming neither harness nor image gets it; a set model, mode or config option outranks the spawn's, and the result names what the settings set.
With no set harness, a `spawn_subagent` call naming neither harness nor image runs on the agent's own harness, since models read the harness as optional and leave it out; a driver script's spawn still names one.
The Session's harness supplies its model and each setting its harness binds, except model-valued ones, ones for the harness's own subagents, and a choice its catalog marks as waiting for a person's approval, since nobody is there to give one.
A spawn on an image alone keeps its own choices, and a script spawn reads no Session's settings, so neither binds nor inherits.
A script spawn that names no model takes the Driver's chat default instead, when that default runs on the harness the spawn names: the saved model, or the automatic model with none saved, so the sub-agent runs on it rather than being refused.
A spawn on another harness, or from a Driver with no model to run on, is still refused, telling the script to name a model.
A Session whose settings cannot be read refuses the spawn rather than run it without them; a Session the runtime does not track has none.
The driver SDK's spawn route takes the same provider-qualified names, folds Claude Code's `claude/` spelling, and refuses a bare or tier name as a bad request.
The sub-agent inherits the driver's Connection of the provider its model names, or the first in its harness's home order when it names none.
A Driver REST spawn checks only that the name is qualified, so a Driver comparing models reads which model the target ran.
Mode and settings are checked when the target applies them.
The delegation view shows its user the same: each target's card names the model its recorded calls ran and, when the spawn named one, the requested model beside it, marked when the two differ, so a silent substitution is visible without opening the conversation.

**A spawn carries a label.** It names the target, so the Driver's own vocabulary for the work — not an opaque identifier — is what shows up wherever agents are listed.
The delegation card and the root Driver's spend rows show the label, else the first line of the prompt.
The minted name keeps the target's prefix and its entropy either way, because that shape is how a target is still recognised as one after it is deleted and only spend rows remain ([observability](observability.md)).

**The order is the workspace-event order.** The seed is queued with the create; the install is queued in a bump of its own ahead of the task's, so the harness opens its session on a workspace that is already seeded and bootstrapped.
One bump would not do: its events share a version and reach the runtime in no set order ([runtime-delivery](runtime-delivery.md#applystate--state-and-events-delivery-server--agent)).
External skills are applied the way kit apply applies them, after the target is woken.

**Provider Inheritance.** A target runs on one of its Driver's model providers; a spawn never names one.
The platform takes the provider connections granted to the Driver and gives the target the one its model names, else the first in its harness's home order that its harness can run on.
A harness whose providers none of the Driver's match is refused before anything is created, since the target could not make its first model call and the Driver would get a failed run instead of a refused spawn.
The refusal names the providers that would do, by their Settings names, and the fix: pick a profile that runs on one the owner already holds, which grants it on the agent's Providers section, else connect one in Settings first.
`list_harnesses` tells the same ahead of a spawn, by the same rule: each harness with the provider a spawn naming no model runs on there, or the refusal a spawn there would get.
An image target declares nothing, so nothing is narrowed.

**The driver can enter its target.** A target accepts the [Environment Link](environments.md#the-environment-link) from its driver alone (`linkFrom`, set at spawn), so the driver reaches the target's machine over SSH, while the target still dials Environments of its own; nothing in a target reaches its driver, and no other agent, the driver's own driver included, reaches the target.

**Connections from the Driver.** A spawn says which of the Driver's connections its target holds, recorded once, at launch, in what the target inherits: `parent` gives it all of them and keeps them in step with the Driver's own for as long as the target lives, a grant or a revoke on the Driver reaching the target, and through it the target's own mirroring children, once the Driver's change commits; a list copies those connections once, each already granted to the Driver; `none`, the default, leaves it only its provider, and is the only choice for a target whose egress is open.
Network reach needs no grant of its own: by default a target has no egress identity and runs under its Driver's rules, unless the spawn gives it egress of its own, open or scoped ([detached egress](security-and-credentials.md)), though its own provider Connections' hosts pass over them ([Egress Aliasing](security-and-credentials.md)); its spend is attributed to its root Driver ([observability](observability.md)).
An *open* child follows only the rules its Driver sets and is denied anything else without a prompt, except that a wildcard allow rule (`*`, `*.example.com`) waits for the owner's approval.
A *scoped* child starts with a copy of its parent's rules for the hosts named; anything else waits for the user's approval, shown on the parent, which widens the child alone.

**Admission.** A target is not sized against its owner's [budget](budgets.md#the-pool): it shares the owner's memory pool with their other machines, so a start that does not fit waits for room and starts when it frees ([vm memory](vm-memory.md)).
The wait does not count against its deadline (see [Deadline](#outcomes)), and while it lasts the Driver reads why it waits: the Invocation's view, await_subagents and the SDKs carry the controller's sentence, and the Driver's chat shows the target as waiting for room with the same sentence.
A spawn whose root Driver is at a [spend limit or the Spend Ceiling](spend-limits.md#unattended-work) is refused before anything is created, with a reason of its own that says which one and when it lifts, because the target could only fail its first model call.

## Outcomes

**One result, validated structurally.** The target calls the `report_result` platform tool; the api-server validates the value against the stored schema — shape only, never truth — and flips the Invocation to done.
The harness still sends the accepted answer back to the model, which costs one more model call; the answer tells the target to end its turn at once, so that call stays short.
**A reported target goes once its model calls have ended.** The target is reaped when the gateway meter shows no open model call of it on two checks five seconds apart, the first ten seconds after the report, so the closing reply and the last telemetry it exported land before its machine goes.
A delete that cut the closing call would leave the meter no usage, and the spend ledger would count the call as an estimate ([spend-limits](spend-limits.md#estimates)).
A call counts as open while the gateway still sends its records, every two seconds, so a call whose gateway went away stops counting ten seconds after its last record.
A call that never ends does not keep the target: it is reaped 90 seconds after the report whatever still runs, since a finished target still holds its share of the owner's memory.
When the meter cannot be read, the target is reaped 30 seconds after the report.
The liveness sweep reaps a reported target that no wait holds any more, as after an api-server restart: from 30 seconds after the report when one read finds no open call, else at the 90-second limit.
The schema lives on the Invocation record and never on a Kubernetes resource.

Clean slates, kept targets and a child's own egress come with the Environments [feature](features.md): an owner without it gets no such options or tools, and no Kept sub-agents group in the UI; a spawn that passes them anyway runs without them and says which it ignored.
`ssh sub-<id>` to a sub-agent that was removed after its result, or is not the agent's, says so rather than the runner's bare refusal.

**A clean slate runs nothing until told.** A spawn with neither prompt nor script boots its target with its setup and runs no turn: its Invocation is `idle`, its Driver enters it over the link (`ssh sub-<id>`, `scp`), and `run_subagent` starts a run in it, a prompt with its schema or a script, on the same machine with its files.
A clean slate is created not sweepable, so the Agent Sweep never takes it asleep with the files its Driver put in; one with no run is reaped once its spawn's time limit passes, or a kept one at its keep expiry, so a forgotten clean slate does not stay.

**Every task is a run.** An Invocation is its target, and each task or script in it is a run of its own record: the spawn's, and each `run_subagent` started in a clean slate or a kept target.
A run is known by the id of its task's event, which its start, a failed-run outcome, a script's upload or report and `report_result` (through the reporting session) name, so nothing of one run lands on another; a run from before runs had records carries its target's id.
Each run has its own time limit, timed from its first delivery, its own result, which goes to whoever started it (the Session that called `run_subagent`, or the script), and, for a script, its own output in the object store.
A task run is refused for what refuses a spawn: a model not named as `<provider>/<model id>`, one no provider the target holds can run, and a root over its spend limit.
The Driver reads a run by its run id, or the target's latest run by the target's id; the view, `await_subagents` and the SDKs name the run and its session.

**A kept target stays, and runs in parallel.** A spawn with `keep` leaves its target asleep with its disk after the result, until its keep expiry (`keep_until`, wall-clock, a day by default and at most as long as an Environment may live), so the Driver can enter it again over the link or run more work in it; `update_subagent` moves the expiry, for the Driver alone.
A kept target takes several runs at once, as an agent runs several sessions, and is reaped only once none runs.
A prompt run continues the target's conversation: by default the session of its latest prompt run, else a session an earlier result named, or a new one with `session: "new"`; one session takes one run at a time, so a run into a session another run works in is refused, checked under the target's lock.
A continued session keeps its model unless the run names one, and its task says it follows the earlier work, whose result was already reported; a session the target no longer holds fails the run at once.
A run's prompt carries its run id, and the session takes that run as its own, for the result it reports and for the watch on it, only when that prompt's turn starts: a prompt that waits behind a turn still finishing in the session queues as any prompt does, and that turn's late result never lands on it.
A kept target is created not sweepable, so the Agent Sweep never takes it, and every reap after a result or a script leaves it alone until its expiry; the liveness sweep then reaps it.
It sleeps after the install's idle timeout, or the `idleTimeout` its spawn or `update_subagent` sets, at most an Environment's longest; it always sleeps, since awake it holds its share of the owner's memory.
A run that ends while its turn or script may still run (stopped, past its time limit, a failed setup, a restart) is ended on its own: the target's runtime cancels that session's turn or kills that script, and confirms it once the work has ended; a run whose prompt still waits is cancelled as its turn starts.
The run's session takes no run until then (waited up to a minute, then refused with the reason).
A stopped machine runs nothing, which settles it too; a run the runtime does not confirm, as on an image that predates the cancel, stops the machine after two minutes, but only once no other run of the target runs.
Deleting its Driver still deletes it, and its own Environments go with it.

**Failure says why.** A failed Invocation carries the platform's reason, because the target is gone by the time the Driver sees it.
The reasons:

- **Setup failed.** A setup step that does not land fails the Invocation the first time, naming the step and the tail of its error, and reaps the target.
  That covers a seed or install the target's runtime reports as failed, and a declared skill the apply could neither install nor account for: a turn that runs without a skill the Driver asked for would otherwise return a result the Driver cannot read as incomplete.
  It covers a harness config the target cannot apply as well — an image with no harness-config driver, a setting its catalog does not offer, or a write the target reports as failed — found once the target reports what it can do; a result such a target reports first is refused, because it came from the default and a comparison across models must never record it as the one asked for.
  There is no retry: the Driver is waiting and can spawn again, while a long-lived agent retries within its attempt budget because a user comes back to it.
- **Run failed.** A target that can no longer report a result fails at once, with the cause, instead of at its deadline.
  The target's runtime watches the run's session until the result is accepted, which it reads in the answer to `report_result`.
  A run that cannot start, or whose session does not open within two minutes, a turn that fails, the run's prompt when the harness never takes it, and a harness that exits or is recycled under it — under its prompt turn or its Autonomous Turn — fail at once; for an exit, the reason carries the harness's spawn error, exit code or signal.
  A turn that ends without a result, and a failed model call with no completed call after it — a minute when the provider refused it outright, five when a retry could succeed — go through one check: the run fails only when no model call, tool call, background work or sub-agent of its own still runs — and, for a turn that ended, no turn, the prompt's or an Autonomous one — on two reads 30 seconds apart.
  A failed call fails the run under an open turn, since the harness has gone quiet inside it.
  The second read leaves room for a sub-agent's result or the harness's own next turn, which reach the session a few seconds after the work behind them ends.
  The check repeats every minute while something runs, so work that ends without a further turn fails the run then.
  A failed call's reason carries its status and body, since a harness such as Codex can go quiet after it without ending the turn.
- **Deadline.** The Driver sets a liveness deadline, clamped to about a minute up to six hours; past it the Invocation fails and the target is reaped mid-work.
  It runs from the target's start: the first delivery of its task to its runtime, which goes only to a Ready Agent whose runtime said hello, stamps the start and moves the deadline there, so a start that waited for room keeps the whole deadline for the work.
  A target that has not started may wait as long as its deadline; past that the Invocation fails with a reason of its own that names the wait.
  A script's task carries its stop and report times, which are set from the start when the task is delivered, so an old runtime keeps working unchanged.
- **Restart.** A target whose machine restarted cannot resume its one-shot turn, so the liveness sweep fails it at once from the restart count the controller publishes ([platform-topology](platform-topology.md)).
- **Driver Cascade.** Deleting a Driver fails its running Invocations and reaps every target it still has, kept and clean slate ones too, transitively for chains.
- **Stopped.** The owner stops a running target from the Driver's chat or the Kept sub-agents group, and a Driver stops one of its own (`stop_subagent`, the SDK's abort signal or cancel event, or `stop` on its handle), with a reason the user reads, which a kept target needs.
  Every running run of the target and of each target below it fails with that reason and goes through the one reap, so a one-off target is removed, with every target still below it, and a kept one keeps its conversation.

**One reap path.** Every way a target goes — reported, failed, run failed, deadline, restart, cascade, stopped — goes through one reap, which the liveness sweep backstops: a reap that did not land, or one an api-server restart forgot, is finished by the next tick.
A deleted root drops only the records whose reap landed; the sweep drops the rest once it finishes their reap and finds the root gone.

## Script runs

**A script replaces the prompt, nothing else.** The spawn carries a shell command where a prompt would go, and the same Agent Setup, harness or image, connections and deadline.
The target is seeded and installed exactly as before; then, in place of opening a Session, its runtime runs the command once in the workspace and nothing else.
No model call runs, so Provider Inheritance, the model choices and the spend-limit refusal do not apply: the target gets no model provider, and a script spawn names no result schema and no harness config.
Admission still applies, since the target still takes room.
A spawn names a prompt or a script, never both: one that names both, or a script with a result schema or model choices, is refused, because it is ambiguous whether the Driver wants the output or a judgment of it.

**The result is the bytes the script produced.** The target keeps stdout and stderr whole, never decoded or trimmed, with each one's size and SHA-256, and uploads both to the object store under keys only the api-server builds, through short-lived links it mints for that target alone.
It then reports the exit code and what it uploaded; the api-server checks each blob's size against the store before it believes the report, records the run, and reaps the target at once, since there is no closing reply or conversation to wait for.
Exit zero is done.
Anything else fails the Invocation with the exit code and the tail of stderr: a non-zero exit, a signal, the deadline, a stream past the 5 GiB one upload carries, or an upload that failed.
The streams of a failed run stay readable too.
The script is stopped a quarter of its deadline early, at most five minutes, so a run that hits it still has time to upload and report before the sweep reaps the target.
The command runs in its own process group, so stopping it kills what it left running as well; a moment after the script exits, the group is killed and its output pipes are closed, so a background process, even one in a session of its own, cannot keep a finished run open.
The target's runtime reports itself busy while the script runs, so the idle checker never hibernates a target mid-script.
A runtime that predates script runs advertises no handler for them, so the liveness sweep fails such a target as a setup failure instead of letting it sit until its deadline.

**The Driver reads each stream once.** The Driver's view of the Invocation names the exit code and each stream's size and hash; reading a stream fetches it through a short-lived link, checks the hash, and then tells the platform to delete it.
Through the tools, await_subagents shows only a script's exit code and the start and end of each stream, so a large output never fills the model's context; **fetch_subagent_output** returns a shell command that downloads the stream to a file in the agent's sandbox, checks its hash and only then acks it, so the output outlives the model's context and the user can open the file too.
A stream nobody reads is deleted after seven days, and every stream goes when the root Driver goes ([persistence](persistence.md#lifetime)); since an Invocation's keys are fixed, these deletions also catch an upload no report ever recorded.
No object store configured means nowhere to put the output, so a script spawn is refused up front.

## The delegation record

**The Invocation outlives its target.** The record keeps what the target was given — prompt or script, label, harness or image, connections — and what it returned (for a script, its exit code), for as long as its **root Driver** exists: the first non-target Agent up the chain, since a grandchild's immediate Driver is itself a throwaway.
It goes with the root Driver's other agent-scoped rows ([persistence](persistence.md#lifetime)).
No age limit and no knob.
Spend is not on the record; it stays in telemetry, keyed by the invocation id the target's gateway stamps ([observability](observability.md)).
The root Driver reads it per sub-agent through its own cost read, which the delegation view's figures match ([metrics — agent-facing read](metrics.md#agent-facing-read)).
The record also names each sub-agent row in the root Driver's spend by agent, by its label, else the first line of its prompt, after the target is gone ([spend limits](spend-limits.md#grouped-read)).

**The target's conversation is kept on the root Driver's volume.** When a target reports, and again before its reap, the platform reads the target's one session out of its machine and hands the frames to the root Driver's runtime, which keeps them with the root's own sessions, one file per target, and the record notes that it was captured.
Copies are byte-capped per target, keeping the newest frames, and in total per root, evicting the oldest.
Capture is best effort and bounded: it never blocks a report, never fails a reap, and **never wakes the root** — a root that is not up (sleeping, crashed, or whose script did not await its spawn) keeps no copy.
A cascade that deletes the root itself skips capture, since the root's volume goes too.
The copy is read-only history, opened beside the Driver's chat and never loaded back as a live session.
From a finished target, the user can **continue in a new chat**: a new chat of the root Driver that starts from the target's prompt and result as recorded, not from its conversation ([sessions — follow-up chats](sessions.md#follow-up-chats)).

**The Driver's chat is the anchor.** The progress lines both SDKs print to stderr, naming each spawned target, are what the chat recognises in the Driver's tool output to draw the delegation in place, so their shape is a contract the SDKs and the chat share.
Each harness's adapter shapes tool output its own way — in the standard content, as the raw tool result, or as a result object — so the chat and the Driver's runtime read it through one shared reader in the runtime contract, and a line means the same on every harness.
Some adapters stream a shell command's output only in parts beside the tool call; the chat adds them up through the same reader, while the runtime, which needs only tool spawns, leaves them aside.
While children run and no line names them yet, the chat shows the Driver's running Invocations from the record, scoped to the Session it shows.
A tool spawn records the Driver's Session that called it: the harness names it on each platform MCP call by an opaque reference the Driver's runtime hands it per Session, and the api-server asks the runtime which Session that is when it records the spawn.
A script spawn records the Session the script runs in the same way: the SDK names it from the script's environment — the Session reference where the harness puts one there, and the Session id a harness or a terminal sets on its shell commands — and the api-server takes a reference the runtime resolves, or an id the runtime tracks.
A script run outside any Session names none.
A chat shows the children its own Session spawned, and every child with no recorded Session — a script run outside a Session, a harness that names no Session, a lookup that failed, a record from before Sessions were kept — so nothing that showed before goes missing.
The recorded Session also places the child's [Metered Spend](spend-limits.md#ledger) under that Session of the Driver, with the spend of the children it spawns in turn; a child with no recorded Session adds its spend to no Session.
Only the Driver's own children are scoped; a grandchild shows under its child.

## The Invocation Pin

A Driver usually waits on its sub-agents from a script, and the signals that keep an Agent awake see sessions, connections and background work its harness reports — not a detached loop, and not a harness that reports nothing.
Hibernating a waiting Driver kills the loop, and the results then have nobody to collect them.
So while an Agent drives at least one running Invocation it carries a pin the controller's idle checker and early reclaim both honour ([agent-lifecycle](agent-lifecycle.md#hibernate)).

**Only a spawn sets the pin**, as part of the spawn itself.
The write is conditional on the Driver it read, and a Driver changes under it for ordinary reasons, a sibling spawn's pin or a controller status update, so a write that loses is read again and retried a few times; a Driver a sibling already pinned is written again all the same, since the release below relies on every spawn changing the Driver.
A write that still fails fails the spawn and leaves no Invocation behind.
**A periodic reconcile only releases it**, for each pinned Driver it finds with no running Invocation, reading that Driver first and only then checking its Invocations; the release is conditional on that read, so a spawn landing in between, which must change the Driver to pin it, fails the release and the next tick decides again.
No terminal path has to remember to release it, whichever of them ended the last Invocation.
**Sleep wins**: it clears the pin, and since the reconcile never sets one, a sleeping Driver stays down while its sub-agents finish; a spawn made while the stop stamp still stands (inside a sleep's settle window) leaves the Driver unpinned, and the spawn's write is conditional on the Driver being unchanged, so a sleep landing mid-spawn fails it rather than being undone.
It is pinned again only by a spawn after it is awake.
A release bumps the Driver's activity, so its ordinary idle window starts from the last result and a chained spawn never finds it asleep; the bump and the cleared pin are one write under that same condition, so a sleep that cleared the pin meanwhile keeps its stale clock.
A Driver that crashed mid-fan-out stays up until its targets' deadlines end their Invocations.

## Sub-agent tools

The platform MCP server offers every agent the everyday case as tools: **spawn_subagent** takes what the spawn route takes — prompt, result schema, harness or image, the setup, and the harness config as flat model, mode and config options, or a script in place of the prompt — and returns the id at once; **await_subagents** takes the ids the agent is waiting on; **fetch_subagent_output** saves a script's stream to a file; **list_harnesses** and **list_connections** answer what the SDK's reads answer.
The description steers a command whose output the agent needs to a script, so no model turn retells it.
Scripts stay the path for orchestration logic — loops, scoring one result with another — and wait for their sub-agents in the foreground; long waits and wide fan-outs use the tools, because only a tool spawn's result is delivered as a turn.

**Waiting is a long poll, bounded under the request timeout.** await_subagents returns as soon as any listed Invocation is terminal, or after four minutes with the ones still running, and the agent calls it again.
The bound sits under Node's 300-second request timeout, which the harness server does not override, as the [satellite](satellites.md) wait does; no harness's own tool timeout is raised.
A harness's MCP client often gives up sooner, after a minute, so while a call waits it sends a progress message every 20 seconds to a client that asked for progress, which restarts that client's own timeout.
The mesh also cuts open calls: every Agent created or removed reloads the proxy in front of the platform, which closes the calls open before it about 45 seconds later.
A cut call collects nothing, so the agent, told to call again after a connection error, gets the result from its next call, or the sweep below delivers it as a turn.
The Driver keeps the ids; the platform tracks nothing per call, a finished id asked again answers again, and an id that is not one of the caller's own Invocations answers as unknown.

**An outcome nobody waited for is delivered as a turn.** An agent that spawned through the tool and ended its turn, or stopped calling await_subagents, is told when each Invocation ends: a short cluster-wide sweep leases such outcomes for one tick, writes one sub-agent-outcome turn per Driver, carrying what await_subagents would have returned, marks them delivered only once the turn is written, and wakes the Driver if it hibernated ([runtime-delivery](runtime-delivery.md)).
A lease the server died holding expires and the next tick claims the outcome again, so none is lost.
The turn continues the Session whose tool call started the Invocation: the Driver's runtime notes each spawn line as it passes, through the same shared reader as the chat, and keeps the note on its own disk, so the result lands where it was asked for on every harness, and a Session it no longer knows gets a new one.
A running await_subagents holds a short lease on its ids, renewed on every poll, and keeps it for a minute on the ids it returns as still running, so the agent can ask again before the sweep pushes them; what it returns counts as delivered; a call whose client aborted collects nothing, and the sweep tells the agent instead.
One outcome owes one turn: a turn that could not be written is released for the next sweep, and an hourly retry only re-wakes a Driver whose turn is written but that did not wake.
A stop its Driver asked for owes no turn, and neither does a run the stop took down below its target, so no stopped child wakes its own Driver; a target the owner stopped still reaches its Driver as a turn.
**A stop wins over the wake**: a Driver the user stopped is not woken for an outcome; its turn waits in the outbox for the Driver's next deliberate wake.
The check and the wake are one write conditional on the Agent the sweep read, never through the watch cache, so a stop landing in between fails the wake instead of being erased.
Script spawns are never pushed — the SDK polls, and an extra turn per child would interrupt the script's agent.
A runtime too old to know the kind drops it at dispatch; await_subagents still works.

**The model is told when not to use it, and must say why it does.** Most harnesses carry their own in-sandbox subagents, which start in seconds and cost nothing extra.
spawn_subagent's description opens by steering the model there when its harness has one, and names what only a platform sub-agent gives: another harness, its own setup, more disk, isolation from the Driver's workspace, heavy parallel work, a schema-checked result.
The call must name one or more of these as `needs`, and the server refuses a need the request does not bear out — another harness that is the Driver's own, a setup with no seed, install, env or skills, more disk with none asked, a schema-checked result from a script — so a stated need is one the model acted on; the three it cannot check pass as stated.
Every harness gets the delegation skill from the base image, and the base image's instructions repeat the rule in two sentences.
The SDK's spawn route has no `needs`: a script is a deliberate choice already.

**A tool spawn anchors its Delegation block like a script spawn.** The spawn's result text carries the same `[invoke] spawned <label> -> <id>` line the SDK prints, so the chat recognises either chip the same way.

## Driver SDK

The client a Driver uses, baked into every agent image in two languages with one surface — JS and Python, both dependency-free and self-configuring from the agent's platform URL: spawn and wait, spawn a script and read its streams, spawn a clean slate and give it runs (`spawnSlate` / `spawn_slate`, a `SubAgent` handle that also keeps, wakes, stops and sets an open sub-agent's egress), stop a spawn it no longer needs (an `AbortSignal` / a `threading.Event`), choose a spawn's connections, egress and keep, list the harnesses on offer and the Driver's own connections, and write result schemas in shorthand.
A failure raises with the platform's reason; a failed script's error still reads its streams.
A wait for a sub-agent logs why it has not started each time that reason changes, and its default client timeout is twice the deadline plus five minutes, since a sub-agent may wait its deadline for room and then run its whole deadline.
Reads retry transient errors; a spawn is sent once, because a duplicated spawn is a second target, not a duplicate.
Every spawn, a clean slate's too, names the Driver's Session the script runs in, when its environment has one, so the chat scopes the child to that Session ([the delegation record](#the-delegation-record)).
The HTTP routes are the contract; the clients stay thin.
Sources: [`packages/driver-sdk/`](../../packages/driver-sdk/), [`packages/driver-sdk-py/`](../../packages/driver-sdk-py/).
