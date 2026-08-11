# Agent runtime

Last verified: 2026-08-11

## Overview

agent-runtime is the process that owns everything inside a running agent pod: it
relays ACP between clients and the harness, serves the session log, allocates
terminal PTYs, and answers the controller's busy probe. This page covers what
happens *inside* the pod — sessions, the processes they start, and what becomes of
those processes. The Agent's own lifecycle around it, from create to hibernate to
delete, is [agent-lifecycle](agent-lifecycle.md).

## Session inside the pod

The harness child process runs for the pod's lifetime, not per-connection. Multiple ACP channels (UI tab WebSockets, the Slack worker, the in-process trigger handler) attach to the same runtime concurrently and engage with sessions implicitly through the `sessionId` they carry on each frame.

Each session is an append-only in-memory log (≤2 MB soft cap, with a truncation sentinel for older history). Every channel keeps a per-session cursor; new events are appended to the log and fanned out to engaged channels at or behind the new sequence number. `session/load` is served from the log on cache hit and falls through to the agent's on-disk store on cold start.

`session/resume` is mediated entirely by the runtime — the frame never reaches the harness. On the hot path (cached metadata) the runtime engages the channel, advances its cursor to the log tail, and returns a synthetic response with no replay. On the cold path (no metadata, e.g. after the pod restarts) the runtime parks the request as a waiter and issues its own `session/load` to rehydrate the harness; replay events populate the log without reaching any client, and on completion every parked resume waiter is served from memory. This shields the UI from per-harness capability differences (some harnesses, like `pi-agent`, don't implement `unstable_resumeSession` at all) and from the cold-subprocess problem on which even resume-capable harnesses would fail.

### Prompt delivery

A session runs one turn at a time. A prompt arriving while a turn is in flight is **queued** rather than refused or forwarded, then promoted when the turn ahead of it ends; a queue already at capacity rejects further prompts as an error on the send that names its cause structurally, so a sender can tell a full queue from any other refusal and say so in the user's own terms rather than the runtime's. So a prompt has three fates its sender cares about — **accepted** (the runtime has it), **queued** (parked behind an earlier turn), and **started** (handed to the agent, where delivery becomes real) — and only the runtime can tell them apart.

The runtime therefore reports them, over the same channel extension as the end-of-turn signal: one notification announcing acceptance and whether the prompt was queued, one announcing that it has started. Both carry a sender-minted prompt identifier, so a sender knows which of its prompts is meant; the identifier rides as platform metadata on the prompt and is stripped before the agent sees it, leaving the agent's view unchanged. A sender that mints none — the CLI, channel workers, an older client — gets no notifications and behaves as it always did. Both notifications are **sender-only and ephemeral**: addressed to the originating channel, never logged and never replayed, because they describe the fate of one send rather than anything that happened in the conversation. Field-level contract: [`packages/api-server-api/`](../../packages/api-server-api/).

This makes **the server authoritative about delivery**, which is the point: watching for content cannot separate "parked behind a running turn" from "never arrived", since a legitimately queued prompt produces nothing for as long as the turn ahead of it runs. Inferring failure from silence is what made the delivery indicator claim a prompt was lost when it was only waiting. A client fails a prompt on evidence instead:

- **No acceptance within a bounded wait** — the true delivery check, normally a matter of milliseconds. Unacknowledged this long means it never arrived. A drop before acceptance carries the socket's stated cause when it gave one, unattributed: the relay writes that text as often as the runtime does.
- **Waiting is unbounded.** A queued prompt is never failed for waiting, however long the turn ahead of it runs. The user is told it is waiting, which is true.
- **The sender's connection drops while its prompt is still queued.** The one loss the runtime cannot report, since reporting it needs the channel that just went away — so the sender raises it locally and keeps it raised across the reconnect that follows. That reconnect replays the log, which misleads here: the dropped prompt's echo is in it, and no reply ever will be.

That last rule covers ordinary loss, not a corner case, because **the queue is lossy by design**: queued prompts belong to the channel that sent them and are discarded when it detaches, and go with the session when the pod recycles or the agent exits. It is a scheduling convenience, not a durable buffer — nothing survives to re-deliver, which is why the loss is surfaced to the person who can act on it. Recovery is always a fresh send the user initiates: an automatic resend cannot know whether the prompt was dropped before or after the agent saw it, so it risks running the prompt twice. A prompt already *handed to the harness* is the other side of that split: losing the channel then costs the sender its live view and nothing else — the turn runs to completion and its output is appended to the log, so any later viewer replays it in full. Every client that reports delivery honestly depends on this split ([channels](channels.md) states it for its own surface).

One failure is deliberately **not** detected: an agent alive but permanently stuck emits nothing and is indistinguishable from one thinking hard, so a prompt waits indefinitely — parked behind a stuck turn, or already handed to the agent. Silence after acceptance is timed nowhere: a deadline there fails healthy turns whose first word is merely slow, and a red failure beside a working turn teaches the user to distrust the indicator. It waits *honestly* — the indicator still says waiting, which stays true — and telling wedged from slow is a separate problem from delivery.

When a session goes idle — no engaged channel, no active or queued prompt, no agent-initiated request still pending — the runtime sends `session/close` to the harness. The per-session subprocess is reaped, freeing memory; the next attach respawns it. Permission requests with no engaged channel time out after ten minutes and the runtime responds to the agent with an error so the tool call aborts cleanly.

**Teardown reaps a process session, not a process.** Every child the runtime spawns — the harness, a terminal's PTY, a per-connection `sshd`, the pod service, short-lived utility commands — is spawned as a *session leader*, and tearing one down signals it, allows one grace window, then force-kills whatever remains in its session. Without that, each teardown killed exactly one pid and everything that pid had started was inherited by the pod's init, which reaps the dead but never terminates the living: a leaked process ran until the pod restarted, holding every file it had open. The scope is the session rather than the process group because a shell with job control puts each background job in its own group, so a group-scoped kill would miss most of a terminal's subtree.

One further condition holds that reap back: **background work still running**.
Closing a session tears down the harness's per-session subprocess, and a harness
that supervises background jobs kills them as it goes, so a job an agent left
running would die seconds after the last tab closed. ACP carries no signal to
consult — a session emits nothing between turns, and `session/close` is specified
to cancel any ongoing work — so the platform asks instead of inferring. A session
reports its **complete in-flight set** to the runtime's in-pod surface, as a level
rather than start/stop edges, and while that set is non-empty the runtime will not
close the session and reports itself busy, so the [idle checker](agent-lifecycle.md#hibernate)
cannot hibernate the pod underneath the work. An empty report ends both.

Reports share one registry with the processes an agent
[declares](#reaping-orphaned-work), because both answer one question — is
something still running that a teardown would destroy. They differ only in
liveness and scope: a report is a session's, renewed until it comes back empty; a
declaration is pod-wide and expires when its process does. Everything held is
published on the runtime's status surface, so a sandbox that stays awake can be
explained by the work holding it, and nothing times a hold out — a [hard stop or
pause](agent-lifecycle.md#hibernate) reclaims the pod regardless.

Only work a harness *supervises* reaches its report: a job the agent detached is
invisible to it, and a report can be adjacent to the real work rather than the
work itself. What is held is thereby also survivable: a held session is never
torn down, so the teardown above cannot reach it, and the [orphan
reaper](#reaping-orphaned-work) cannot run at all while a hold stands, because a
hold makes the pod non-quiet.

**No hold preserves the agent's live handle on the output.** That handle belongs
to the harness's per-session subprocess, so `session/close` takes it with the
session: supervised jobs are killed, and work that detached keeps running but its
output survives only where it was redirected — which is why `platform-bg` reports
a log path. The close needs no user action: it follows three seconds after the
last channel detaches (tab closed, session switched), or immediately when a turn
ends with no viewer attached, as with a scheduled or Slack trigger.

Terminal-mode sessions follow a different model from the chat path above. agent-runtime accepts at most one WebSocket per `sessionId` on `/api/terminal`, allocates a PTY, spawns `harness-terminal` attached to it, and pipes raw bytes both ways through a small binary frame protocol (`OP_INPUT` / `OP_OUTPUT` / `OP_RESIZE` / `OP_EXIT`). A headless xterm tracks scrollback so that reattaching while the PTY lives replays the serialized buffer. A detached PTY is reaped on idleness, not on viewer loss: after a short detach grace (30 s, sized for a tab refresh), it is killed only once the harness has also been quiet — no output for five minutes. Liveness keys on harness output rather than viewer presence, so in-flight work (a running build, a streaming response) survives switching away and can be reattached live, while an abandoned idle prompt is cleaned up. There is no append-only log, no fan-out, and no `session/resume` — terminal sessions belong to one viewer at a time, and the harness's own on-disk session store is the only durable record (e.g. `~/.claude/projects/.../<HARNESS_SESSION_ID>.jsonl`).

SSH sessions are unrelated to the session/mode machinery above — they carry no `sessionId`, no DB row, and no harness involvement. agent-runtime accepts a WebSocket on `/api/ssh`, spawns a per-connection OpenSSH `sshd -i` (inetd mode) as the agent user, and relays raw bytes verbatim between the socket and the child's stdio. SSH terminates at that sshd, which authenticates a CLI-registered public key (`ssh.authorizeKey`) and drops into a plain `/bin/bash` login shell; the api-server and CLI never parse the SSH wire. sshd resets the environment before that shell, so agent-runtime rebuilds `~/.ssh/environment` from the live injected env on each connection (with `PermitUserEnvironment yes`) — the SSH session gets the same proxy routing and credentials the harness has, rather than a bare env with no working egress, and picks up connection/credential changes injected since boot on the next reconnect. Concurrent SSH connections to one agent coexist (each its own `sshd`), and the endpoint exists only on images that ship `sshd`. Like the terminal and chat relays (passive connections excepted — they take no pin), an open SSH connection marks the agent `active-session`, so it will not hibernate while connected — close the editor/session to let it idle down. Two safety nets keep that pin honest: a WS ping/pong releases it if the connection half-dies, and pins orphaned by a replica that died holding sessions are swept by a periodic reconcile — each replica refreshes a short-TTL Redis presence key per agent it holds sessions for, and the reconcile clears the annotation once no replica's key remains.

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
fresh env. Its output joins the pod log stream. A service that exits for any
reason has its whole process session torn down behind it, since anything it
started is orphaned from that moment. claude-code uses the hook to front
custom Anthropic-compatible upstreams with a local model gateway;
images without a pod service are unaffected.

## Reaping orphaned work

The pod's PID 1 is a minimal init (catatonit) wrapping agent-runtime. It reaps
*dead* orphans so they don't accumulate as zombies, but never terminates a live
one. Session-scoped teardown covers work still attached to something the runtime
spawned; it cannot cover work that detached *before* any teardown. A tool call
that backgrounds a command leaves a process whose shell has already exited, in a
session and process group of its own, sharing nothing with the harness — only
orphanhood identifies it.

The sweep runs only when the pod is completely quiet: no engaged chat channel,
no prompt running or queued, no pending request to the client, no reported
background work, no open terminal, no open SSH. It is stricter than the `idle`
flag the controller reads, which excludes SSH on purpose.

Orphanhood alone is too broad to act on — agent-runtime is itself a child of
init, and on the VM backend init is systemd, parenting the guest's own services.
The sweep therefore also requires a process to share the runtime's cgroup, which
scopes it to the pod in a container and to the runtime's own service under
systemd. An unreadable cgroup disables reaping rather than widening it.

A process in uninterruptible I/O cannot be killed until that I/O completes; the
sweep still targets it and logs that it did. Two kinds of process are spared: one
still **listening** on a socket, because a leak is what nothing can reach any
more, and one the agent **declared** on purpose. Only a declaration also holds the
pod awake — a listener merely survives the sweep. Every reap, and every listener
kept, is logged to the pod's stream.

**Declaring work that is meant to detach.** Some agents background their real
work on purpose: a campaign running for hours belongs to no session and must
survive every turn that ends. Such a process is indistinguishable from a leak,
so the agent says which it is by starting it through the `platform-bg` wrapper
instead of a bare `nohup`. The wrapper backgrounds the command and registers the
resulting pid, and the reaper skips what is registered — which covers the whole
subtree, since the children of a live process are not orphans.

A declaration needs no retraction: liveness is the process itself, so it expires
when the work ends. It lands in the same registry as
[reported](#session-inside-the-pod) background work, so it keeps the Agent awake
too — the idle checker sees a declaration exactly as it sees a report. The
registry is persisted, since on the VM backend a runtime restart that forgot its
declarations would hand every running campaign to the reaper.

Switching a session's mode (e.g. chat → terminal) is metadata-only: the switching client persists the new mode over ACP (`session/resume` carrying `_meta.platform.mode`), which the runtime merges into its session-metadata store. The running harness is unaffected — mode is a UI hint about which surface (chat vs. terminal PTY) to render. There is no cross-client notification; other clients reflect the change on their next `session/list`. The `--reset` / terminal-reset path is independent: it closes the terminal WebSocket and calls agent-runtime's `resetSession`, which sends `session/close` to the harness and clears the in-memory log and cursors.

Beyond ACP frames, agent-runtime also serves a Bearer-authenticated tRPC surface on the harness port for skill install / uninstall / scan / publish / listLocal. The api-server is the sole caller; the skills-*management* calls wake a hibernated pod through the reachability primitive ([Wake](agent-lifecycle.md#wake)) before reaching it, while the read paths (`state` / `listLocal`) degrade gracefully and never wake. Skill files land on the PVC under the configured Skill Paths and are picked up by the harness on the next session start (no hot-reload). See [skills](skills.md).

The **target** lifetime model is single-use Kubernetes Jobs per turn, with a Redis-backed read cache for lightweight queries and a two-tier PVC layout (per-session + shared). Migration is on a parallel track and not blocking. The current prototype uses the persistent runtime described above.
## `dam-run` — local exec shim

The remote Run-executor machinery (a separate executor pod per `dam-run` invocation, backed by a `Run` CR and a WebSocket relay) was removed. Its model was a second pod writing into the calling agent's live workspace — exactly the shared-writable access that ReadWriteOnce workspace volumes no longer provide — and it had been disabled since the RWO cutover.

The in-pod `dam-run` CLI remains as a compatibility shim: `dam-run <cmd>` now simply runs the command as a regular local process in the same pod, inheriting stdio, cwd, and environment. Scripts and harness prompts that call it keep working unchanged; there is no remote hop, no `Run` resource, and no relay.
