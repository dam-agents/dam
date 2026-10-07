# Agent processes

Last verified: 2026-10-07

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
set is non-empty the runtime will not close the session and reports itself busy, so the
idle checker cannot hibernate the pod underneath the work. An empty report ends both.
Reporting is optional: a harness that never reports behaves exactly as it did before the
contract. What is held is published on the runtime's status surface, so an agent that
stays awake can be explained by the work holding it.

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
or changes whether it keeps the agent awake, and the reader re-queries; CPU and memory are
polled. The runtime scans every few seconds while someone watches and twice a minute
otherwise, so finished work is recorded even when nobody looks. Field-level contract:
[`packages/agent-runtime-api/`](../../packages/agent-runtime-api/).
