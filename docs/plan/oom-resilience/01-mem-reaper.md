# 01 — Early-OOM reaper in agent-runtime

**Part of:** oom-resilience — see [README](./README.md)

## Context

The kernel (guest kernel, under Kata; group-kill on cgroup-v2 runc nodes) OOM-kills the whole
container when the pod's memory limit is exhausted, taking the harness down with the tool
process that caused it. agent-runtime already reads the cgroup limit and usage
(`server.ts:626-681`) but only logs. This slice acts first, in userspace: at a threshold, kill
the largest process that is a *grandchild-or-deeper* descendant of agent-runtime. Direct
children (harness-chat, PTY harnesses, pod service, per-connection sshd) are the supervised
platform processes and stay protected; everything deeper is a tool process the harness can
observe dying (a SIGKILLed Bash tool call) and recover from within the turn.

## Implementation plan

Apply `/typescript-engineering`.

1. New `packages/agent-runtime/src/core/mem-reaper.ts`:
   - `interface ProcEntry { pid: number; ppid: number; name: string; rssBytes: number }`.
   - `readProcTable(): ProcEntry[]` — readdir `/proc`, for each numeric dir parse
     `/proc/<pid>/status` lines `Name:`, `PPid:`, `VmRSS:` (kB). Swallow per-pid errors
     (processes vanish mid-scan).
   - `pickVictim(table: ProcEntry[], rootPid: number): ProcEntry | null` — **pure**: build a
     children map, protect `rootPid` and its direct children, collect descendants at depth ≥ 2,
     return the largest by `rssBytes` (null when none). Export for the unit test.
   - `createMemReaper(opts: { thresholdFraction: number; log: (msg: string) => void; pollMs?: number })`
     — reads `memory.max`/`memory.current` (reuse the same v2/v1 fallback paths as the
     existing monitor; extract `readCgroupBytes` from `server.ts` into this module and import
     it back in `server.ts`). Every `pollMs` (default 2000, `.unref()`), if
     `current / max >= thresholdFraction`: scan, pick victim, `process.kill(pid, "SIGKILL")`,
     log `[mem-reaper] killed pid <pid> (<name>, <rss>MB) at cgroup <cur>/<max>MB`; when no
     victim exists log that only protected processes remain. At most one kill per tick.
     No-op entirely (no interval) when the cgroup limit is unreadable/unlimited.
2. Config (`packages/agent-runtime/src/modules/config.ts`): add
   `MEM_REAPER: z.string().default("on").transform(v => v !== "off")` and
   `MEM_REAPER_THRESHOLD: z.coerce.number().gt(0).lt(1).default(0.93)`.
3. Wire in `server.ts` next to the existing monitor: start the reaper when
   `config.MEM_REAPER` (skip in `PLATFORM_DEV`, where there is no meaningful cgroup).
4. Document the two env knobs in `deploy/helm/platform/values.yaml` next to the existing
   `QUEUE_PARK_MS` comment under `templateDefaults.env` (comment only — no template change).
5. Unit test (the flagged exception — pure algorithm, no manual path exercises its edges):
   `packages/agent-runtime/src/__tests__/unit/mem-reaper.test.ts` covering `pickVictim`:
   protects root and direct children, picks largest grandchild, returns null when only
   protected processes exist, handles orphans reparented outside the root's tree (not picked).

## Acceptance criteria

- [ ] `pickVictim` never returns agent-runtime's pid or a direct child's pid.
- [ ] Reaper is off under `MEM_REAPER=off`, in dev mode, and when no cgroup limit is readable.
- [ ] Kill and no-victim paths both log with cgroup usage figures.
- [ ] `mise run common:check:comment-types` passes; agent-runtime checks/tests green.

## Smoke test

`mise run agent-runtime:test` (existing suite + the new unit test) and
`mise run agent-runtime:check`. Manual: in a size-limited local-cluster agent, ask the agent
to allocate memory in a loop; watch the pod log for `[mem-reaper] killed` and confirm the pod
does not restart (`kubectl get pod -w`).
