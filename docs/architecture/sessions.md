# Sessions

Last verified: 2026-10-08

## Session inside the pod

The harness child process runs for the pod's lifetime, not per-connection. Multiple ACP channels (UI tab WebSockets, the Slack worker, the in-process trigger handler) attach to the same runtime concurrently and engage with sessions implicitly through the `sessionId` they carry on each frame.

Each session is an append-only in-memory log (≤2 MB soft cap). Every channel keeps a per-session cursor; new events append to the log and fan out to engaged channels that have not yet seen them. Every entry the runtime appends live carries the wall-clock time it was written, as platform metadata on the frame; an entry filled in from a replay carries only what its source supplied, never a time the runtime invented. From a session-history provider that source can also supply the harness's own name for the prompt a reply answered — the prompt id by which [agent-telemetry](agent-telemetry.md#progressive-disclosure) joins a reply to its Turn once the Session is loaded.

The runtime also tells engaged viewers when a scheduled fire begins its turn, and a load hands back the fire start times the session still holds — the newest, under a bound [persistence](persistence.md) owns. A thread draws each of those beside the prompt that opens its run, so a run boundary survives a reopen. A start whose prompt is not in view — older than the loaded tail — sits above the first message after it, and only the newest such start draws there, since one message opens one run; a start with no timed message to sit beside at all draws nothing.

A `session/load` that opts in replays **only the newest tail** of the log, bounding the open cost at any length; without the opt-in the whole log replays, per ACP. The response reports any cut, with a cursor when the older range is still in the log; a load presenting that cursor is paged the older range, down to the eviction floor (cut without cursor). Cursors die with the log: a stale one is refused and the client reloads. Replay shares the connection with live fan-out, so replayed frames are tagged to their load for exact attribution.

Both verbs are runtime-mediated: a hot `session/resume` engages the channel and answers synthetically with no replay. A cold request parks as a waiter. An image may declare a **session-history provider**: it fills the log with no harness process, and the first prompt rehydrates the harness silently, replay dropped — with `session/resume` where the harness advertises that session capability, `session/load` otherwise. Resume is the better fit: the log already holds the history, so a harness that streams its replay only after answering the load would otherwise duplicate it. Otherwise, or on provider failure, the runtime's own `session/load` fills the log, reaching no client. Waiters are then served from the log, shielding the UI from per-harness gaps and the cold-subprocess problem.

**Rewinding and forking from a message.** A user can take an earlier message of an idle chat Session, edit it, and either **rewind** the conversation to it or **fork** a new one from it. A harness cannot cut a session short in place, so one that can **fork** copies the Session up to the agent's reply before that message; for the first message an empty Session stands in. The copy's history is loaded before anything else and the edited message is its first new prompt. A rewind gives the copy the original's place, title and creation time and then deletes the original like any deleted Session, so the conversation keeps going under a new id; a fork leaves the original as it was and lists the copy as a new conversation. Files the agent changed stay changed. The runtime answers before the copy's first frame, so the client that asked follows the new id without reloading. It refuses while a turn, a queued prompt or an agent request is pending, and for Sessions other parts of the platform hold the id of — scheduled, channel-bound, initialization. A message steered into a running turn is no starting point: a copy cut there would separate a tool call from its result.

## Prompt delivery

A session runs one turn at a time, and one scheduler is the only place a prompt waits. A prompt is **queued** rather than refused or forwarded whenever its session cannot take it — a turn already running, no channel engaged to read the answer, or the harness not yet holding the session — and promoted the moment that clears — a scheduled fire is **unattended**, its sender gone once the prompt is accepted and nobody reading the turn live, so it waits on the harness alone and never on a channel; a queue at capacity rejects further prompts with an error whose cause a sender can tell from any other refusal. So a prompt has three fates its sender cares about — **accepted** (the runtime has it), **queued** (waiting for its session to be able to take it), and **started** (handed to the agent, where delivery becomes real) — and only the runtime can tell them apart.

The runtime therefore reports them, over the same channel extension as the end-of-turn signal — which is logged and replayed, and names the ending turn's prompt id and stop reason: one notification on acceptance (and whether the prompt queued), one when it starts. Both ride a sender-minted prompt id as platform metadata, stripped before the agent sees it; channel workers and older clients mint none and get none. Both are **sender-only and ephemeral**; the queue is the conversation's: every viewer sees each change and can edit or remove a prompt until it starts, and a load returns it. A prompt's echo enters the log only when it starts. Field-level contract: [`packages/api-server-api/`](../../packages/api-server-api/).

A harness that can **steer** takes a prompt into the turn it is running rather than after it. A web UI prompt sent mid-turn is then **steered** — a fourth fate, reported in place of a start — and queued prompts drain into a running turn the same way. A refused steer queues again at the head, so the agent receives each prompt once and in order. Scheduled fires, invocation outcomes and CLI runs always queue.

This makes **the server authoritative about delivery**, which is the point: watching for content cannot separate "parked behind a running turn" from "never arrived". A client fails a prompt on evidence instead:

- **No acceptance within a bounded wait** — the true delivery check, normally a matter of milliseconds. Unacknowledged this long means it never arrived, and the failure carries the socket's stated cause when it gave one.
- **Waiting is unbounded.** A queued prompt is never failed for waiting, however long the turn ahead of it runs. The user is told it is waiting, which is true.

A connection that drops while its prompt is still queued raises nothing on the client, because the queue survives the departure: queued prompts belong to the conversation, not to the channel that sent them, so the last channel leaving **parks** the queue for a grace window, and a client engaging again within it resumes it. A queue holding only unattended fires is never parked: nobody is coming back for it, and it needs nobody. A queue leaves the scheduler by four routes — the window expiring, the session forgotten, the scheduler cleared when the harness goes down, or a session the harness cannot load back refusing its queue — and all but the refusal record the queue's prompts as **undelivered** in a durable document on the pod, whole, inline images capped; the refusal errors each sender instead. Each session load hands the records back, marked on the conversation to send again or delete, and says whether a turn is still running; a record sent again or deleted is **retired** so its earlier echo drops from the replay rather than doubling. Recovery is always a send the user initiates: an automatic resend cannot know whether a prompt was dropped before or after the agent saw it, so it risks running it twice. A prompt already *handed to the harness* is the other side of that split: losing the channel costs the sender only its live view — the turn runs to completion and its output lands in the log for any later viewer. Every honest delivery report depends on this split ([channel-turns](channel-turns.md) states it for its surface).

One failure is deliberately **not** detected: an agent alive but permanently stuck emits nothing and is indistinguishable from one thinking hard, so a prompt waits indefinitely. Silence after acceptance is timed nowhere — a deadline there fails healthy turns whose first word is merely slow — and telling wedged from slow is a separate problem from delivery.

**Surviving memory pressure.** The harness and its tool processes share one memory ceiling, so a runaway command would take the whole agent down with it. Which ceiling depends on how the agent runs: a container is capped by its cgroup, while a machine on the `vm` Backend has no cgroup limit at all and is bounded by its own memory, read from the kernel's headroom estimate so that reclaimable cache is not mistaken for consumption. A container that carries no cgroup limit is left unwatched rather than measured against the node it shares, whose memory a neighbour moves. agent-runtime pushes back first: nearing the limit it kills the largest tool process, sparing the harness and the conversation processes its manifest names, so the agent recovers mid-turn; only when those are the hog does the kernel's kill land. A turn that dies anyway is recovered from an [active-turns marker](persistence.md) surviving to the next boot: it resumes on its own, up to five times, with a notice to pick the task back up. The marker is written only after the harness *took* the prompt, so resuming continues a turn the agent already saw — not the [no-auto-resend](#session-inside-the-pod) of a prompt it never got.

When a session goes idle — no engaged channel, no prompt active or queued, no agent request pending — the runtime sends `session/close` to the harness; a parked queue counts as queued work, holding the release back until its window passes. The per-session subprocess is reaped; the next attach respawns it. Permission requests with no engaged channel time out after ten minutes, answered to the agent as an error so the tool call aborts cleanly. A harness that leaves a cold re-attach unanswered — whichever verb it advertised for one — is wedged: that request's frames are suppressed and the process is recycled when work drains.

One further condition holds that reap back: **background work the session
reports**. Closing a session tears down the harness's per-session subprocess, and
a harness that supervises background jobs kills them as it goes, so a job an agent
left running would die seconds after the last tab closed. ACP carries no signal to
consult — a session emits nothing between turns, and `session/close` is specified
to cancel any ongoing work — so the platform asks instead of inferring. A session
reports its **complete in-flight set** to the runtime's in-pod surface, as a level
rather than start/stop edges, and while that set is non-empty the runtime will not
close the session and reports itself busy, so the [idle checker](agent-lifecycle.md#hibernate)
cannot hibernate the pod underneath the work. An empty report ends both. Reporting
is optional: a harness that never reports behaves exactly as it did before the
contract. What is held is published on the runtime's status surface, so an agent
that stays awake can be explained by the work holding it.

Only work a harness *supervises* reaches its report, which bounds what the
contract promises. A job the agent detached from the harness is invisible to it,
and what is reported can be adjacent to the real work — a detached loop whose
progress a supervised log tail watches holds the session for the tail. Nothing
times a hold out, so an agent with reported work does not scale to zero until
that work ends; a [hard stop or pause](agent-lifecycle.md#hibernate) reclaims it regardless, and an
install can refuse holds outright.

Terminal-mode sessions follow a different model from the chat path above. agent-runtime accepts at most one connection per terminal session, runs the terminal entrypoint in a PTY, and pipes raw bytes both ways. Scrollback is tracked so that reattaching while the PTY lives replays it. A detached PTY is reaped on idleness, not on viewer loss: after a short detach grace it is killed only once the harness has also gone quiet. Liveness keys on harness output rather than viewer presence, so in-flight work (a running build, a streaming response) survives switching away and can be reattached live, while an abandoned idle prompt is cleaned up. There is no append-only log, no fan-out, and no `session/resume` — terminal sessions belong to one viewer at a time, and the harness's own on-disk session store is the only durable record.

SSH sessions are unrelated to the session machinery above: they carry no session identity, no metadata entry, and no harness involvement — a per-connection in-pod OpenSSH the platform relays bytes to, with its own authentication and its own shell, several coexisting per agent. The transport and its auth belong to the CLI surface that uses it ([cli](cli.md#ssh-access)) and to agent-runtime's relay duties ([platform-topology](platform-topology.md)). For lifecycle an SSH connection matters only as a pin: while it is open the Agent will not hibernate, and the runtime's own idleness probe cannot see it ([Hibernate](agent-lifecycle.md#hibernate) states which signal carries it and how a lost connection's pin is reclaimed).

Beyond per-session children, agent-runtime supervises at most one **pod
service** — an optional
background process the agent image provides at a well-known path, running for
the life of the pod. The runtime starts it once the runtime-channel env
exists, restarts it when it crashes, and after a clean exit leaves it down
until the env next changes. When the env changes, the service is asked to
reload in place, and one that cannot is restarted with the fresh env. Its
output joins the pod log stream. The pod's init reaps processes orphaned by a
dying harness or service, so none linger as zombies. claude-code uses the hook to front
custom Anthropic-compatible upstreams with a local model gateway;
images without a pod service are unaffected.

Switching a session's mode (e.g. chat → terminal) is metadata-only: the switching client persists the new mode over ACP, which the runtime merges into its session-metadata store. The running harness is unaffected — mode is a UI hint about which surface (chat vs. terminal PTY) to render. The metadata write raises a session-watch notice, so other clients re-read and follow. The `--reset` / terminal-reset path is independent: it closes the terminal WebSocket and resets the runtime session, dropping everything the runtime held for that session id.

Beyond ACP frames, agent-runtime also serves a tRPC surface on the harness port for skill management and skill reads. The api-server is the sole caller; management calls wake a hibernated pod through the reachability primitive (above) before reaching it, while reads degrade gracefully and never wake. Skill files land on the PVC under the configured Skill Paths and are picked up by the harness on the next session start (no hot-reload). See [agent-skills](agent-skills.md).
