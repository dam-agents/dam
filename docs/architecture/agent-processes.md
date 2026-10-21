# Agent processes

Last verified: 2026-10-21

## Overview

Besides the platform's own processes, a running agent holds the work its agent started: commands a turn waits on, jobs its harness supervises in the background, and jobs it detached from the harness.
agent-runtime is the only component that sees the pod's process table, so it owns everything on this page: the background work a harness reports, and the **process inventory** that lists every kind for the user.
Nothing here changes when an agent hibernates — that rule, and the signals behind it, belong to [agent-lifecycle](agent-lifecycle.md#hibernate).

## Reported background work

Closing a session tears down the harness's per-session subprocess, and a harness that supervises background jobs kills them as it goes, so a job an agent left running would die seconds after the last tab closed.
ACP carries no signal to consult — a session emits nothing between turns, and `session/close` is specified to cancel any ongoing work — so the platform asks instead of inferring.
A session reports its **complete in-flight set** to the runtime's in-pod surface, as a level rather than start/stop edges, and while that set is non-empty the runtime will not close the session and, while the work is kept, reports itself busy, so the idle checker cannot hibernate the pod underneath the work.
An empty report ends both.
Reporting is optional: a harness that never reports behaves exactly as it did before the contract.
Claude Code reports from a Stop hook that its launcher writes into the user settings on every start, not into the image's managed settings: an account that receives server-managed settings replaces the managed file whole, which would drop the hook.
What is held is published on the runtime's status surface, together with how many [kept Detached Processes](#keeping-work) run.
The user sees it in the [process inventory](#process-inventory), and an agent whose status would otherwise say *Idle* says *Background work* instead, so an agent that stays awake can be explained by the work holding it.

Holding the session and keeping the agent awake are **two separate holds**.
Every reported task holds its session open, because closing the session would kill it.
Only a task that is [kept](#keeping-work) makes the runtime busy — every task by default, until the user turns that off for it.
An unkept task runs on with its session open and dies at hibernation, and the status surface lists only the kept ones.

**Restarts wait for kept tasks.** A new connection or a config change reaches the harness only when it respawns, and the recycle closes every session, killing every Harness Task with it.
Such a recycle waits for an idle runtime; one that may be forced (a config change, or a change to which variables are set) is forced after a grace period only while no kept Harness Task runs: while one does, the change waits as long as the task does.
It runs the moment the runtime goes idle, whichever turn, session setting change, or agent-initiated request settles last, not when the grace period ends.
An idle runtime still waits for the calls a client sent that the harness has not answered, such as ACP `initialize` or a control call, because the recycle fails them; it waits up to 10 seconds, then recycles and answers each with the recycle's reason.
The processes list reports a change waiting this way, with how many kept tasks it waits for and everything a restart now would stop: every Harness Task on the waiting leases, kept or not, and every running turn.
Right after a user saves an agent setting that can reach the harness, the UI checks for such a change for a few seconds and, if one waits, asks whether to restart now or to apply it when the tasks finish.
That question is not behind the `processes` feature, since every agent waits this way.
A change made from account settings, outside one agent, does not ask.
The user unblocks it by applying it now, which stops that work, by stopping or unkeeping the kept tasks, or by disabling the agent.
Once the last kept task is gone, the recycle runs at once on an idle runtime, or after the grace period while a turn still runs.
Unkept tasks never hold a recycle back, since the recycle kills them anyway; a kept Detached Process never does either, since the recycle leaves it alone.
A harness that stopped answering is recycled regardless, since a wedged harness serves no task.

Only work a harness *supervises* reaches its report, which bounds what the contract promises.
A job the agent detached from the harness is invisible to it, and what is reported can be adjacent to the real work — a detached loop whose progress a supervised log tail watches holds the session for the tail.
Nothing times a hold out, so an agent with reported work does not scale to zero until that work ends; [sleep](agent-lifecycle.md#hibernate) reclaims it regardless.

## Process inventory

The runtime sorts what runs in the pod into four kinds, one row per process tree, with its command, start time, and the CPU and memory of the whole tree; the fourth, [Startup Items](#startup-items), has a section of its own:

- **Turn Process** — a descendant of a chat harness that a running turn started.
  It is listed only while a turn runs on that harness, and only if it started after the earliest turn running there began, so helpers the harness keeps (MCP servers and the like) never show.
  Children of older work that writes to a file are not the turn's either.
- **Harness Task** — a reported background job, matched to the harness descendant that runs it by the output file the harness names after the task.
  Never by command: two tasks can run the same command, and a wrong match would point Stop at the other task's process.
  A task that matches no single process is still listed, without a process to act on.
- **Detached Process** — a process re-parented to the reaper of orphans: PID 1, or the init that wraps agent-runtime and adopts orphans as a subreaper.
  Work under an attached terminal or SSH shell is not listed until it detaches.

A pod runs one chat harness per [Harness Lease](sessions.md#session-inside-the-pod), and the runtime reads every one of them the same way.

**Never listed:** PID 1, agent-runtime and its ancestors, and agent-runtime's direct children — the chat harnesses, the pod service, terminals, SSH servers.

A row carries the **output file** behind the process's stdout or stderr when that is a regular file, and the user can read its tail.
The runtime reads only a file a scan recorded, never a path a caller names, with one exception: a Startup Item's log, which it builds from an item id that passed the same id rule as the list, and only for an item the list or a running row names.
Claude Code writes every tool call's output, foreground or `run_in_background`, to a file of its own, so its Turn Processes and Harness Tasks always have output; a process writing to a pipe or a terminal has none.
The scan reads each process's environment for the keep mark, the openrc user-service name and the [Environment Link](environments.md#the-environment-link) mark, and drops the rest unread, because agents hold credentials there.

A row also says when it is a **container** or a **container runtime**, read from its command line alone, without asking the runtime.
Docker and k3s run each container under a containerd shim that is re-parented to the reaper, so it lists as a Detached Process; its command names the containerd namespace (`moby` for Docker) and the container id, and a k3s shim runs from k3s's own paths.
The row carries the engine and the id cut to twelve characters, which `docker` and `crictl` accept.
`dockerd`, `containerd` and `k3s server` or `agent` are marked as the runtime of their engine.
The panel shows both with a container icon named by their engine, a container titled by its short id in place of the shim command, and lists them after the other rows of the same kind in their group, so the user's own detached work comes first.
The mark stays on the row in the finished history, which shows the same icon and title; the engine is the icon's name there, since a finished row has no caption.

**Finished work.** A Harness Task or Detached Process that a scan finds gone moves to a finished history — a Harness Task as soon as its process is gone, without waiting for the harness's next report.
Turn Processes keep no history.
The history and the rows last seen running live in the **processes runtime document** on the agent's home volume ([persistence](persistence.md)), stamped with the kernel's boot id: on a boot with a new id, the rows the last scan saw running are recorded as ended by hibernation, since nothing outlives one.
The history keeps the newest twenty entries, none older than a week.

**Reading it.** The inventory is served on agent-runtime's tRPC surface, reached through the same per-agent relay as the file and session watches; a hibernated agent shows nothing until it wakes.
A watch sends data-less change notices when a row appears, goes, or changes whether it keeps the agent awake or who decided, and when a change waiting for kept tasks appears or goes; the reader re-queries; CPU and memory are polled.
The runtime scans every few seconds while someone watches, every quarter minute while a Keep Mark or kept Detached Process lives, and twice a minute otherwise, so finished work is recorded even when nobody looks.
The user's decisions — the keep switch and Stop — go through the same surface.
Field-level contract: [`packages/agent-runtime-api/`](../../packages/agent-runtime-api/).
The chat view shows the inventory behind the `processes` [experimental feature](features.md).
With the `new-layout` experiment off it is a Processes section beside Files and Artifacts, in the column beside the conversation, and a row's output opens in the panel docked beside the conversation, the way a file does.
With `new-layout` on it is a Processes tab of the side panel, beside Artifacts, Files, Changes and Browser, and a row's output opens in that tab, the way a file opens in the Files tab.
Either way the output follows the file while the process runs.
Running rows are grouped by their effect on the agent: active turns, the work keeping the agent awake, and the work that stops at hibernation (on an Always on agent the last two are one group, since nothing stops there).
Each row's menu has a Stop that asks first; for a Harness Task or Detached Process it also has the keep choice, which says in one line what the row does, and is disabled on an Always on agent, and changing it moves the row to the other group.
A change [waiting for kept tasks](#reported-background-work) shows above the rows with its Apply now.
An indicator counts the running Harness Tasks and Detached Processes and those keeping the agent awake, and opens the section or the tab — so a user who wonders why the agent stays awake finds the answer one click away.
It sits in the chat's top bar while the layout has one; with `new-layout` on, the side panel's icon bar carries it on the Processes icon instead, the count turning from grey to accent blue while a process keeps the agent awake.
The list and the indicator show the same list: while the agent runs but the UI has lost its connection to it, both keep the last list and the list says the agent can't be reached; while the agent does not run, neither shows it.

## Keeping work

Only **kept** work, and an open [Environment Link](environments.md#the-environment-link), keep the agent awake; everything else survives the user leaving and dies at hibernation.
Each row resolves who decided, in this order:

1. **The user**, through the keep switch in the panel, in either direction.
   The choice lasts for that process (for a Harness Task, that task) and wins over everything else, the agent's Keep Mark included.
2. **The agent**, with a **Keep Mark** on a Detached Process.
   `platform-keep`, a command in every agent image, starts a job in its own session with its output in a log file and marks it, or marks a process that already runs, which counts once that process runs detached.
   A launch passes an id down the job's environment, which every descendant inherits through `nohup` and `setsid`; a mark on a running process names its pid and start time.
   A Detached Process is marked while any process of its tree carries a live mark.
   A mark on a pid that runs under the chat harness is refused, since such work never detaches: a Harness Task is kept already, and anything else there ends with its command or session.
   The one exception is a child of the shell that runs `platform-keep` itself, which detaches when that shell exits.
3. **The default**: a Harness Task is kept, since backgrounding it was the agent's choice; a Detached Process is not.
   A Turn Process ends with its turn and takes no decision.

The agent marks through the runtime's in-pod surface, from inside the agent only.
Once the user has decided about a process, a later mark on it is refused with a message that names the user's choice, so the agent can ask instead.
This, like the reported contract, is not a security boundary — the agent could kill its own work anyway — but a rule an honest agent follows.
Kept Detached Processes keep the agent awake next to kept Harness Tasks, but never hold back a harness recycle.

Marks and user choices live in the processes document, keyed so a reused pid never inherits one, and go on a new boot with everything else boot-scoped.

## Startup Items

A **Startup Item** is a command a vm agent's machine starts at every boot, so it comes back after a hibernation, a restart and a new image, like a Mac's login items; the UI calls them **Login items**.
It is an openrc **user service** of root, the agent's account: a script in `~/.config/rc/init.d/<name>` with a `command`, started at boot when `~/.config/rc/runlevels/default` links it, and controlled with `rc-service --user`.
The agent writes them as plain openrc scripts, and they live in the home, the one place every boot and every image keep.

OpenRC itself does the work.
platform-init already boots openrc on a machine ([vm-runner](vm-runner.md)), and openrc's own `user` service, linked as `user.root` in the image's `default` runlevel beside `platform-env`, starts root's user services at boot and stops them on a stop, as a login would for a person; nobody logs in to a machine.
Its `/etc/conf.d/user.root` keeps their state in the image's `XDG_RUNTIME_DIR`, which the agent's shell and the runtime share, starts them after docker and k3s, and waits up to a minute for them all to stop, each within its own stop timeout.
The image's `/etc/rc/user/rc.conf` makes every such service supervised by `supervise-daemon`, which restarts it two seconds after it exits, run in `~/work`, logged to `~/.local/state/rc/<name>.log`, and stopped with its whole process group; a script overrides any of it.
A service gets the environment the pod service gets: openrc keeps `PATH`, the gateway's proxy and CA variables and `PLATFORM_ENVIRONMENT_OF` of the environment it starts in, and adds every variable of `~/.config/rc/profile.env` it left unset.
The runtime writes that file when it starts and whenever the platform changes its env, connection placeholders included, so `gh` and git in a service act as the agent's account; a value openrc's file parser would change, one with a quote, a `#` or a leading `$`, is left out.
The runtime's own `PORT` is left out too, so a service that serves on `PORT` does not take the runtime's.
A process keeps the environment it started with, so when the file changes the runtime restarts every running service, as it respawns the pod service: a connection added or removed reaches the services at once, and interrupts what they were doing.
At boot, services start before the runtime, from the file it wrote before the machine stopped; the platform's first env push restarts them only when the env moved meanwhile.
User services need OpenRC 0.60 or later; the image takes OpenRC alone from Debian testing through an apt pin, until its stable release ships one.

The supervisor of a user service carries its name (`RC_USER_SERVICES`, `RC_SVCNAME`), which the process scan reads beside the keep mark, so its tree under the reaper is one **Startup Item** row rather than a Detached Process; a process below another root that only inherited those variables is not.
The panel lists every service in a section of its own, running, exited or off, with its log as output and history, and keeps a running service's row out of the background groups, the header count and the finished history.
A service that runs with no script any more is listed there too, as no longer in the list, so nothing that runs is hidden; the user can still stop it.
**A service never keeps the agent awake**: it starts again at every wake, and work that must hold the agent awake still uses a Keep Mark; the panel refuses a keep choice for one.
The user restarts, stops, turns off or removes a service there: turning it off removes its boot link, so the next boot skips it, and removing it deletes its script and link once it stopped; one that will not stop stays listed, and the user is told so.
A choice the user made is kept when openrc then fails, and the service's status says so.
Only a machine openrc booted lists Startup Items: a container agent runs the same image without openrc.

**Stop.** The user can stop any listed process that has one: the runtime signals its whole tree — every descendant, and the process group its root leads — to terminate, and after a short grace kills what is left, matching each process by its start time so a reused pid is never hit.
The row moves to the finished history as stopped by the user; a Turn Process just ends, and its tool call fails in front of the agent.
A stopped Harness Task is dropped from its session's report and ignored until the harness stops reporting it, so a stale report cannot bring it back.
A Harness Task matched to no process cannot be stopped.
