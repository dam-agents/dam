# Agent processes

Last verified: 2026-10-08

## Overview

Besides the platform's own processes, a running agent holds the work its agent started:
commands a turn waits on, jobs its harness supervises in the background, and jobs it
detached from the harness. agent-runtime is the only component that sees the pod's
process table, so it owns everything on this page: the background work a harness reports,
and the **process inventory** that lists all three kinds for the user. Nothing here
changes when an agent hibernates — that rule, and the signals behind it, belong to
[agent-lifecycle](agent-lifecycle.md#hibernate).

## Reported background work

Closing a session tears down the harness's per-session subprocess, and a harness that
supervises background jobs kills them as it goes, so a job an agent left running would
die seconds after the last tab closed. ACP carries no signal to consult — a session emits
nothing between turns, and `session/close` is specified to cancel any ongoing work — so
the platform asks instead of inferring. A session reports its **complete in-flight set**
to the runtime's in-pod surface, as a level rather than start/stop edges, and while that
set is non-empty the runtime will not close the session and, while the work is kept,
reports itself busy, so the idle checker cannot hibernate the pod underneath the work. An
empty report ends both.
Reporting is optional: a harness that never reports behaves exactly as it did before the
contract. Claude Code reports from a Stop hook that its launcher writes into the user
settings on every start, not into the image's managed settings: an account that receives
server-managed settings replaces the managed file whole, which would drop the hook. What
is held is published on the runtime's status surface, and the user sees
it in the [process inventory](#process-inventory), so an agent that stays awake can be
explained by the work holding it.

Holding the session and keeping the agent awake are **two separate holds**. Every
reported task holds its session open, because closing the session would kill it. Only a
task that is [kept](#keeping-work) makes the runtime busy — every task by default, until
the user turns that off for it. An unkept task runs on with its session open and dies at
hibernation, and the status surface lists only the kept ones.

**Restarts wait for kept tasks.** A new connection or a config change reaches the harness
only when it respawns, and the recycle closes every session, killing every Harness Task
with it. Such a recycle waits for an idle runtime; one that may be forced (a config change, or a
change to which variables are set) is forced after a grace period only while no kept
Harness Task runs: while one does, the change waits as long as the task
does. The processes list reports a change waiting this way, with how many kept tasks it
waits for. The user unblocks it by applying it now, which stops those tasks, by stopping
or unkeeping them, or by a hard stop or pause. Once the last kept task is gone, the
recycle runs at once on an idle runtime, or after the grace period while a turn still
runs. Unkept tasks never hold a recycle back, since the recycle kills them anyway; a kept
Detached Process holds it back only as any busy runtime does, up to the grace period, and
the recycle leaves it alone. A harness that stopped answering is
recycled regardless, since a wedged harness serves no task.

Only work a harness *supervises* reaches its report, which bounds what the contract
promises. A job the agent detached from the harness is invisible to it, and what is
reported can be adjacent to the real work — a detached loop whose progress a supervised
log tail watches holds the session for the tail. Nothing times a hold out, so an agent
with reported work does not scale to zero until that work ends; a
[hard stop or pause](agent-lifecycle.md#hibernate) reclaims it regardless, and an install
can refuse holds outright.

## Process inventory

The runtime sorts what runs in the pod into three kinds, one row per process tree, with
its command, start time, and the CPU and memory of the whole tree:

- **Turn Process** — a descendant of the chat harness that a running turn started. It is
  listed only while a turn runs, and only if it started after the earliest running turn
  began, so helpers the harness keeps (MCP servers and the like) never show. Children of
  older work that writes to a file are not the turn's either.
- **Harness Task** — a reported background job, matched to the harness descendant that
  runs it: by the output file the harness names after the task, else by its command. A
  match holds while its process lives. A task that matches no single process is still
  listed, without a process to act on.
- **Detached Process** — a process re-parented to the reaper of orphans: PID 1, or the
  init that wraps agent-runtime and adopts orphans as a subreaper. Work under an attached
  terminal or SSH shell is not listed until it detaches.

**Never listed:** PID 1, agent-runtime and its ancestors, and agent-runtime's direct
children — the chat harness, the pod service, terminals, SSH servers.

A row carries the **output file** behind the process's stdout or stderr when that is a
regular file, and the user can read its tail. The runtime reads only a file a scan
recorded, never a path a caller names. Claude Code writes every tool call's output,
foreground or `run_in_background`, to a file of its own, so its Turn Processes and Harness
Tasks always have output; a process writing to a pipe or a terminal has none. The scan
reads each process's environment for one variable, the keep mark, and drops the rest
unread, because agents hold credentials there.

**Finished work.** A Harness Task or Detached Process that a scan finds gone moves to a
finished history — a Harness Task as soon as its process is gone, without waiting for the
harness's next report. Turn Processes keep no history. The history and the rows last seen
running live in the **processes runtime document** on the agent's home volume
([persistence](persistence.md)), stamped with the kernel's boot id: on a boot with a new
id, the rows the last scan saw running are recorded as ended by hibernation, since nothing
outlives one. The history keeps the newest twenty entries, none older than a week.

**Reading it.** The inventory is served on agent-runtime's tRPC surface, reached through
the same per-agent relay as the file and session watches; a hibernated agent shows
nothing until it wakes. A watch sends data-less change notices when a row appears, goes,
or changes whether it keeps the agent awake or who decided, and when a change waiting for
kept tasks appears or goes; the reader re-queries; CPU and memory are
polled. The runtime scans every few seconds while someone watches, every quarter minute
while a Keep Mark or kept Detached Process lives, and twice a minute otherwise, so finished
work is recorded even when nobody looks. The user's decisions — the keep switch and Stop
— go through the same surface. Field-level contract:
[`packages/agent-runtime-api/`](../../packages/agent-runtime-api/). The chat view shows the
inventory as a Processes section beside Sessions, Files and Artifacts, behind the
`processes` [experimental feature](features.md); a row's output opens in the panel docked
beside the conversation, the way a file does, and follows the file while the process runs.
Each row has a Stop that asks first; each Harness Task and Detached Process row also says
whether it keeps the agent awake and who decided, with a switch to change it (disabled on
an Always on agent); a change [waiting for kept tasks](#reported-background-work)
shows above the rows with its Apply now. A header indicator counts the running Harness
Tasks and Detached Processes and those keeping the agent awake, and opens the section —
so a user who wonders why the agent stays awake finds the answer one click away.

## Keeping work

Only **kept** work keeps the agent awake; everything else survives the user leaving and
dies at hibernation. Each row resolves who decided, in this order:

1. **The user**, through the keep switch in the panel, in either direction. The choice
   lasts for that process (for a Harness Task, that task) and wins over everything else,
   the agent's Keep Mark included.
2. **The agent**, with a **Keep Mark** on a Detached Process. `platform-keep`, a command
   in every agent image, starts a job in its own session with its output in a log file and
   marks it, or marks a process that already runs, which counts once that process runs
   detached. A launch passes an id down the job's
   environment, which every descendant inherits through `nohup` and `setsid`; a mark on a
   running process names its pid and start time. A Detached Process is marked while any
   process of its tree carries a live mark.
3. **The default**: a Harness Task is kept, since backgrounding it was the agent's
   choice; a Detached Process is not. A Turn Process ends with its turn and takes no
   decision.

The agent marks through the runtime's in-pod surface, from inside the agent only. Once the
user has decided about a process, a later mark on it is refused with a message that names
the user's choice, so the agent can ask instead. This, like the reported contract, is not a
security boundary — the agent could kill its own work anyway — but a rule an honest agent
follows. Kept Detached Processes count toward the runtime's busy signal next to kept
Harness Tasks; when the last one ends, a recycle that waited for an idle runtime runs.
With holds refused by the install, Harness Task reports are discarded, so none is listed,
and nothing keeps the agent awake: a Detached Process row still says who decided, and
`platform-keep` still records its mark, but neither holds the agent.

Marks and user choices live in the processes document, keyed so a reused pid never
inherits one, and go on a new boot with everything else boot-scoped.

**Stop.** The user can stop any listed process that has one: the runtime signals its whole
tree — every descendant, and the process group its root leads — to terminate, and after a
short grace kills what is left, matching each process by its start time so a reused pid is
never hit. The row moves to the finished history as stopped by the user; a Turn Process
just ends, and its tool call fails in front of the agent. A stopped Harness Task is dropped
from its session's report and ignored until the harness stops reporting it, so a stale
report cannot bring it back. A Harness Task matched to no process cannot be stopped.
