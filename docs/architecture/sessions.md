# Sessions

Last verified: 2026-10-12

## Session inside the pod

agent-runtime holds one harness process, a **Harness Lease**, per harness, provider Connection, model and process-scoped [session settings](harness-config.md#session-settings) its sessions ask for: the model and those settings reach the harness as its process env, never as a switch inside a live session, and changing a session's model or such a setting moves its next turn to the matching lease.
Neither change is accepted while the session's turn runs.
A lease outlives connections.
ACP channels attach concurrently and engage sessions by the `sessionId` each frame carries.

Each lease is the unchanged ACP runtime this section describes, behind a **lease router**.
`session/new` names the session's harness, provider and model; the runtime persists that pair in its session-metadata store, so later frames, and a load or resume after a restart, route back to the same lease.
A session naming none runs on the default harness and first granted provider, and keeps that pair.
Leases spawn lazily, except the default one, which starts once the server listens so a waking chat finds it loaded; each is told about the client as the first was, and an agent's question is answered to the lease that asked.
The default lease stays; any other shuts down once it holds no session, and one whose harness crashes is dropped for the next session to respawn.

A lease spawns with the agent-wide env, its own provider's layer and its harness's layer ([connections](connections.md#contribution-fan-out)), then the pod's process env, then its harness, provider and model.
Revoking a provider recycles only the leases on it; a prompt or setting sent to a session on a removed provider fails with a structured *provider removed* error naming it, and granting it again resumes the session.

Each session is an append-only in-memory log (≤2 MB soft cap; inline image and audio bytes give way to a placeholder before any entry is evicted).
Every channel keeps a per-session cursor; new events append to the log and fan out to engaged channels that have not yet seen them.
Every entry the runtime appends live carries the wall-clock time it was written, as platform metadata on the frame; an entry filled in from a replay carries only what its source supplied, never a time the runtime invented.
From a session-history provider that source can also supply the harness's own name for the prompt a reply answered — the prompt id by which [agent-telemetry](agent-telemetry.md#progressive-disclosure) joins a reply to its Turn once the Session is loaded.

The runtime also tells engaged viewers when a scheduled fire begins its turn, and a load hands back the fire start times the session still holds — the newest, under a bound [persistence](persistence.md) owns.
A thread draws each of those beside the prompt that opens its run, so a run boundary survives a reopen.
A start whose prompt is not in view — older than the loaded tail — sits above the first message after it, and only the newest such start draws there, since one message opens one run; a start with no timed message to sit beside at all draws nothing.

A `session/load` that opts in replays **only the newest tail** of the log, bounding the open cost at any length; without the opt-in the whole log replays, per ACP.
The response reports any cut, with a cursor when the older range is still in the log; a load presenting that cursor is paged the older range, down to the eviction floor (cut without cursor).
Cursors die with the log: a stale one is refused and the client reloads.
Replay shares the connection with live fan-out, so replayed frames are tagged to their load for exact attribution.

Both verbs are runtime-mediated: a hot `session/resume` engages the channel and answers synthetically with no replay.
A cold request parks as a waiter.
An image may declare a **session-history provider**: it fills the log with no harness process, and the first prompt rehydrates the harness silently, replay dropped — with `session/resume` where the harness advertises that session capability, `session/load` otherwise.
Resume is the better fit: the log already holds the history, so a harness that streams its replay only after answering the load would otherwise duplicate it.
Otherwise, or on provider failure, the runtime's own `session/load` fills the log, reaching no client.
Waiters are then served from the log; the UI also reads its newest tail as data and renders it while the load engages the session.

**Rewinding and forking from a message.** A user can take an earlier message of an idle chat Session, edit it, and either **rewind** the conversation to it or **fork** a new one from it.
A harness cannot cut a session short in place, so one that can **fork** copies the Session up to the entry right before that message — the agent's reply, or a tool result where a message sent mid-turn landed.
User messages with nothing between them are one **batch**, which the agent took as one message: the chat shows them under one header and rewrites them as one, editing their texts joined by a blank line and sending the result as one message.
The runtime finds that entry in the harness's own history, through the session-history provider, by the message's id or, for a message sent live, by its text; a message that history does not hold is refused rather than cut somewhere else, and only for the first message does an empty Session stand in.
The copy's history is loaded before anything else and the edited message is its first new prompt.
A rewind gives the copy the original's place, title and creation time and then deletes the original like any deleted Session, so the conversation keeps going under a new id; a fork leaves the original as it was and lists the copy as a new conversation.
Files the agent changed stay changed.
The runtime answers before the copy's first frame, so the client that asked follows the new id without reloading.
It refuses while a turn, a queued prompt or an agent request is pending, and for Sessions other parts of the platform hold the id of — scheduled, channel-bound, initialization.
The copy keeps the original's times: the harness stamps the last entry it copies with the time of the fork, and the runtime gives that entry its original time back.

## Prompt delivery

A session runs one turn at a time, and one scheduler is the only place a prompt waits.
A prompt is **queued** rather than refused or forwarded whenever its session cannot take it — a turn already running, no channel engaged to read the answer, or the harness not yet holding the session — and promoted the moment that clears — a scheduled fire is **unattended**, its sender gone once the prompt is accepted and nobody reading the turn live, so it waits on the harness alone and never on a channel; a queue at capacity rejects further prompts with an error whose cause a sender can tell from any other refusal.
So a prompt has three fates its sender cares about — **accepted** (the runtime has it), **queued** (waiting for its session to be able to take it), and **started** (handed to the agent, where delivery becomes real) — and only the runtime can tell them apart.

The runtime therefore reports them, over the same channel extension as the end-of-turn signal — which is logged and replayed, and names the ending turn's prompt id and stop reason: one notification on acceptance (and whether the prompt queued), one when it starts.
Both ride a sender-minted prompt id as platform metadata, stripped before the agent sees it; channel workers and older clients mint none and get none.
Both are **sender-only and ephemeral**; the queue is the conversation's: every viewer sees each change and can edit or remove a prompt until it starts, and a load returns it.
A prompt's echo enters the log only when it starts.
The queue marks a prompt that waits only for its session — nothing running ahead, the harness still loading the session after a wake, a restart or a rewind — as **starting**, and the chat shows it as sent rather than queued.
Field-level contract: [`packages/api-server-api/`](../../packages/api-server-api/).

A harness that can **steer** takes a prompt into the turn it is running rather than after it.
A web UI prompt sent mid-turn is then **steered** — a fourth fate, reported in place of a start — and queued prompts drain into a running turn the same way.
The harness takes a steer by aborting whatever the agent is generating, so a steer waits for a **steer point** — the agent neither writing nor running a tool, which is right after its tool calls finish — and the agent reads the prompt beside their results instead of having a reply cut off.
Prompts waiting together go as one batch — one message carrying each of them in order — since a later one may change what an earlier one asked; separate steers sent together would be merged by the harness on its own, in no reliable order.
A steer starts the agent generating again, so prompts sent after it wait for the next steer point.
The user can send a queued prompt now: it is steered at once, with every prompt queued before it, accepting the cut.
A turn that ends first starts the waiting prompts as the next turn, again as one batch; a prompt never waits longer than a minute for a steer point.
Until then it is an ordinary queued prompt the user can still change.
A refused steer queues again at the head, so the agent receives each prompt once and in order.
Scheduled fires, invocation outcomes and CLI runs always queue.

This makes **the server authoritative about delivery**, which is the point: watching for content cannot separate "parked behind a running turn" from "never arrived".
A client fails a prompt on evidence instead:

- **No acceptance within a bounded wait** — the true delivery check, normally a matter of milliseconds.
  Unacknowledged this long means it never arrived, and the failure carries the socket's stated cause when it gave one.
- **Waiting is unbounded.** A queued prompt is never failed for waiting, however long the turn ahead of it runs.
  The user is told it is waiting, which is true.

A connection that drops while its prompt is still queued raises nothing on the client, because the queue survives the departure: queued prompts belong to the conversation, not to the channel that sent them, so the last channel leaving **parks** the queue for a grace window, and a client engaging again within it resumes it.
A queue holding only unattended fires is never parked: nobody is coming back for it, and it needs nobody.
A queue leaves the scheduler by four routes — the window expiring, the session forgotten, the scheduler cleared when the harness goes down, or a session the harness cannot load back refusing its queue — and all but the refusal record the queue's prompts as **undelivered** in a durable document on the pod, whole, inline images capped; the refusal errors each sender instead.
Each session load hands the records back, marked on the conversation to send again or delete, and says whether a turn is still running; a record sent again or deleted is **retired** so its earlier echo drops from the replay rather than doubling.
Recovery is always a send the user initiates: an automatic resend cannot know whether a prompt was dropped before or after the agent saw it, so it risks running it twice.
A prompt already *handed to the harness* is the other side of that split: losing the channel costs the sender only its live view — the turn runs to completion and its output lands in the log for any later viewer.
Every honest delivery report depends on this split ([channel-turns](channel-turns.md) states it for its surface).

One failure is deliberately **not** detected: an agent alive but permanently stuck emits nothing and is indistinguishable from one thinking hard, so a prompt waits indefinitely.
Silence after acceptance is timed nowhere — a deadline there fails healthy turns whose first word is merely slow — and telling wedged from slow is a separate problem from delivery.

**Surviving memory pressure.** The harness and its tool processes share one memory ceiling, so a runaway command would take the whole agent down with it.
Which ceiling depends on how the agent runs: a container is capped by its cgroup, while a machine on the `vm` Backend has no cgroup limit at all and is bounded by its own memory, read from the kernel's headroom estimate so that reclaimable cache is not mistaken for consumption.
A container that carries no cgroup limit is left unwatched rather than measured against the node it shares, whose memory a neighbour moves.
agent-runtime pushes back first: nearing the limit it kills the largest tool process, sparing every harness and the conversation processes any carried harness's manifest names, so the agent recovers mid-turn; only when those are the hog does the kernel's kill land.
A turn that dies anyway is recovered from an [active-turns marker](persistence.md) surviving to the next boot: it resumes on its own, up to five times, with a notice to pick the task back up.
The marker is written only after the harness *took* the prompt, so resuming continues a turn the agent already saw — not the [no-auto-resend](#session-inside-the-pod) of a prompt it never got.

When a session goes idle — no engaged channel, no prompt active or queued, no agent request pending — the runtime sends `session/close` to the harness; a parked queue counts as queued work, holding the release back until its window passes.
The per-session subprocess is reaped; the next attach respawns it.
Permission requests with no engaged channel time out after ten minutes, answered to the agent as an error so the tool call aborts cleanly.
A harness that leaves a cold re-attach unanswered — whichever verb it advertised for one — is wedged: that request's frames are suppressed and the process is recycled when work drains.

One further condition holds that reap back: **background work the session reports**.
While a session reports work still running, the runtime keeps it open, and busy while that work is kept, so neither the reap nor the [idle checker](agent-lifecycle.md#hibernate) ends the work underneath it.
The contract, and the process inventory that shows the user everything running in the agent, live on [agent-processes](agent-processes.md).

Terminal-mode sessions follow a different model from the chat path above.
agent-runtime accepts at most one connection per terminal session, runs the terminal entrypoint in a PTY with the env of the harness and provider its WebSocket names, and pipes raw bytes both ways.
A session on a removed provider or an unknown harness closes with the reason.
Scrollback is tracked so that reattaching while the PTY lives replays it.
A detached PTY is reaped on idleness, not on viewer loss: after a short detach grace it is killed only once the harness has also gone quiet.
Liveness keys on harness output rather than viewer presence, so in-flight work (a running build, a streaming response) survives switching away and can be reattached live, while an abandoned idle prompt is cleaned up.
There is no append-only log, no fan-out, and no `session/resume` — terminal sessions belong to one viewer at a time, and the harness's own on-disk session store is the only durable record.

SSH sessions are unrelated to the session machinery above: they carry no session identity, no metadata entry, and no harness involvement — a per-connection in-pod OpenSSH the platform relays bytes to, with its own authentication and its own shell, several coexisting per agent.
The transport and its auth belong to the CLI surface that uses it ([cli](cli.md#ssh-access)) and to agent-runtime's relay duties ([platform-topology](platform-topology.md)).
For lifecycle an SSH connection matters only as a pin: while it is open the Agent will not hibernate, and the runtime's own idleness probe cannot see it ([Hibernate](agent-lifecycle.md#hibernate) states which signal carries it and how a lost connection's pin is reclaimed).

Beyond per-session children, agent-runtime supervises at most one **pod service** — an optional background process the agent image provides at a well-known path, running for the life of the pod.
The runtime starts it once the runtime-channel env exists, restarts it when it crashes, and after a clean exit leaves it down until the env next changes.
When the env changes, the service is asked to reload in place, and one that cannot is restarted with the fresh env.
Its output joins the pod log stream.
The pod's init reaps processes orphaned by a dying harness or service, so none linger as zombies.
claude-code uses the hook to front custom Anthropic-compatible upstreams with a local model gateway, each provider apart; images without a pod service are unaffected.

Switching a session's mode (e.g. chat → terminal) is metadata-only: the switching client persists the new mode over ACP, which the runtime merges into its session-metadata store.
The running harness is unaffected — mode is a UI hint about which surface (chat vs. terminal PTY) to render.
The metadata write raises a session-watch notice, so other clients re-read and follow.
The `--reset` / terminal-reset path is independent: it closes the terminal WebSocket and resets the runtime session, dropping everything the runtime held for that session id.

Beyond ACP frames, agent-runtime also serves a tRPC surface on the harness port for skill management and skill reads.
The api-server is the sole caller; management calls wake a hibernated pod through the reachability primitive (above) before reaching it, while reads degrade gracefully and never wake.
Skill files land on the PVC under the configured Skill Paths and are picked up by the harness on the next session start (no hot-reload).
See [agent-skills](agent-skills.md).
