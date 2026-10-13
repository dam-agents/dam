# All of a user's VM agents restart at once, unexplained, when their memory pool runs out

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/4755

## Goal

When an owner's VM agents grow together, the platform reacts within seconds and stops the owner's idle agents before the runner runs out of memory.
When the runner still runs out, every agent it took down says so, and tells the owner to stop agents they are not using.

## Approach

An owner's machines are processes of their [runner](../../architecture/vm-runner.md), and its memory limit is their pool ([vm-memory](../../architecture/vm-memory.md)).
Today the controller learns use only from a 30 s pass over each runner, and the runner measures each VMM only every 10 s, so a burst between them OOM-kills the runner with every machine and nothing says why.

Three changes:

- **The runner watches its own cgroup.** Every second it reads its working set (`memory.current` less `inactive_file`, the kubelet's figure) against its limit.
  At 95% it is under pressure, and it stays so until it is below 90%.
  A new long-poll, `GET /pressure?since=&wait=`, answers when the pressure version moves; it moves when pressure starts, every 10 s while it lasts, and when it ends.
  Before moving it, the runner measures every running VMM again, so the statuses the controller reads next are fresh.
  Where no cgroup v2 is readable (the Mac host runner, cgroup v1), the version never moves.
- **The controller reclaims as soon as the runner signals.** It holds one pressure watch per owner and runs that owner's memory pass on each signal.
  Under the runner's signal the pass reclaims even below the 90% counted threshold, and a partial reclaim is allowed: freeing some memory near an OOM beats freeing none.
  The 30 s pass stays, unchanged, as the backstop.
- **A runner OOM kill is shown on each agent it took down.** A new Agent condition reason, `RunnerOutOfMemory`, read from the runner pod's last termination, through the api-server's wake-failure vocabulary to the existing crash notice.

Deferred, by decision: reclaiming before the machines reboot after a kill, a lasting record of the kill (#4759), and nodes that kill one process instead of the group (`singleProcessOOMKill`, cgroup v1).

## Sub-issues

| #   | Title                                                 | Scope                          | Depends on |
| --- | ----------------------------------------------------- | ------------------------------ | ---------- |
| 01  | The runner reports memory pressure within a second    | vm-runner, contract, Go client | —          |
| 02  | The controller reclaims as soon as the runner signals | controller                     | 01         |
| 03  | A runner OOM kill shows on each affected agent        | controller, api-server         | —          |

## Conventions & glossary

- **Working set**: the runner pod's `memory.current` less its `inactive_file`; what the kernel cannot reclaim without killing.
- **Pressure**: working set at or past 95% of the runner's limit, until it falls below 90%.
- Code comments follow the typed-comment rules (`mise run check:comment-types`).
- Apply `/typescript-engineering` for the api-server change.

## Whole-feature smoke test

On a Linux cluster with KVM and a small `virtualization.runner.resources.limits.memory`: start two vm agents of one owner, leave one idle past 3 minutes, and in the other allocate past the pool (`python3 -c "b=bytearray(3<<30); input()"`).
Within seconds the controller logs "reclaimed idle agent to free memory on its owner's VM runner".
Allocating past the pool in both instead OOM-kills the runner, and each agent shows `RunnerOutOfMemory` until it is ready again.

## Delivery

Each sub-issue is one atomic commit.
The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/4755.
