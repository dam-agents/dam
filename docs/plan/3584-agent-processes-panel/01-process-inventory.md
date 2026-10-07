# 01 — Process inventory

**Part of:** Agent processes panel — see [README](./README.md)

## Context

agent-runtime learns to list what runs in the pod. It scans `/proc`, sorts each process into
Turn Process, Harness Task or Detached Process, keeps a history of finished work in the
`processes` runtime document, and serves `processes.list`, `processes.watch` and
`processes.output` on its tRPC surface. This slice is read-only: no Stop, no keep decisions
(`keepsAwake` comes only from today's Harness Task reports). Everything later builds on it.

## Implementation plan

Apply `/typescript-engineering` throughout.

1. **Contract** in `packages/agent-runtime-api/src/modules/processes/`:
   - `schemas.ts`: Zod schemas for `ProcessRow`, `FinishedRow`, `PendingRestart` and the
     `output` input, exactly as pinned in the README. Include `keepSource` and `endedBy` now so
     02 and 03 add no shape changes.
   - `types.ts`: a `ProcessesService` interface (`list()`, `watch(signal)`, `output(key)`), the
     same shape as `SessionsService` in `modules/sessions/types.ts`.
   - `router.ts`: `list` query, `watch` subscription (copy `sessionsRouter.watch` in
     `modules/sessions/router.ts`), `output` query. Map a missing key to `NOT_FOUND`.
   - Register it in `packages/agent-runtime-api/src/router.ts` and add `processes` to
     `AgentRuntimeContext` in `src/context.ts`.
2. **Process scan** (infrastructure) in
   `packages/agent-runtime/src/modules/processes/infrastructure/proc-scan.ts`. For each
   `/proc/<pid>` read: ppid, session id and start time (`stat`, fields 4, 6, 22), utime + stime
   (`stat` 14, 15), RSS (`status` `VmRSS`), cmdline (NUL-separated, trimmed to 500 chars), and
   `readlink` of `fd/1` and `fd/2`. Keep an output path only when it is absolute and points to
   a regular file outside `/dev`. Skip processes that vanish mid-read. Read
   `/proc/sys/kernel/random/boot_id` once. Leave `core/mem-reaper.ts` as it is.
   - Also read `environ`, but only to pull out the `PLATFORM_KEEP` value (02 uses it). Parse in
     memory and drop the rest at once. Never log it.
3. **Classification** (domain, pure) in `.../processes/domain/classify.ts`. Input: the scan,
   the runtime's own pid, the chat harness pid, the earliest start of a running turn (or
   null), and the reported Harness Tasks. Rules:
   - **Platform's own** (never listed): PID 1, the runtime and its ancestors, and the
     runtime's direct children (harness, pod service, PTYs, sshd, run-once).
   - **Harness Task**: for each reported task with a `command`, collect chat-harness
     descendants whose cmdline contains that command (whitespace-normalised). Exactly one
     topmost match gives the pid. No match, or several, gives `pid: null` (Stop is disabled
     later) and a key `task:${sessionId}:${taskId}`. A task row exists even without a pid.
   - **Turn Process**: a chat-harness descendant, not inside a Harness Task tree, started at
     or after the earliest running turn's start, listed only while a turn runs. Harness
     helpers started earlier (MCP servers and the like) are not listed.
   - **Detached Process**: a process whose parent is PID 1 and that is not the platform's
     own. Descendants of PTY and SSH shells that are still attached are not listed. Once
     they detach (re-parented to PID 1) they are.
   - One row per tree root. CPU and RSS sum the whole tree. CPU % = tick delta between the
     last two scans / elapsed wall time / `CLK_TCK` (100).
   - `keepsAwake` in this slice: Harness Tasks `true` with `keepSource: "default"`, others
     `false`/`"default"`. Turn Processes are always `false`.
4. **Hooks into acp-runtime** so classification has its inputs:
   - `packages/agent-runtime/src/modules/acp/infrastructure/agent-process.ts`: add
     `pid: number | undefined` to `AgentProcess`. Fill it in `create-child-agent-process.ts`.
   - `prompt-scheduler.ts`: add `activeTurnSince(): number | null` (earliest start of a
     running turn).
   - `acp-runtime.ts`: expose `harnessPid()` and `activeTurnSince()` on `AcpRuntime`.
   - `background-work-registry.ts`: add `onChange(cb)`, fired whenever a session's report
     changes, so the service records a task that disappears as finished.
5. **Service** in `.../processes/services/processes-service.ts`
   (`createProcessesService(deps)`):
   - Opens the `processes` document through the `stateBackend` in `server.ts`
     (`{ bootId, lastRunning: [], finished: [] }`; 02 adds `marks` and `overrides`).
   - On open, if the stored `bootId` differs from the current one, move `lastRunning` rows
     to `finished` with `endedBy: "hibernation"` and `finishedAt` = their last-seen time,
     then store the new boot id.
   - Scans every 3 s while at least one `watch` subscriber is open. `list()` with no fresh
     scan (older than 3 s) scans first. 02 adds a slower scan while a keep is alive.
   - Diffs each scan with the previous one. A Harness Task or Detached row that is gone
     becomes a `FinishedRow` with `endedBy: "exit"`. Turn Processes are not kept. Trim
     `finished` to the newest 20, none older than 7 days. Write `lastRunning` (Harness Tasks
     and Detached only) when the set of keys changes, not on every scan.
   - Emits a notice (via `core/notice-stream.ts`, `topic: "processes"`, coalesced like
     `acp/services/session-changes.ts`) when the set of keys, a `keepsAwake`, or
     `pendingRestart` changes. CPU and memory changes do not emit. The UI polls for those.
   - `output(key)`: look up the key's `outputPath` (running or finished), `stat` it (regular
     file only), and return the last 64 KiB as UTF-8 with `truncated`. Unknown key or missing
     file → `NOT_FOUND`. It never reads a path the scan did not record.
   - `pendingRestart` is always `null` here (03 fills it).
6. **Wire** in `packages/agent-runtime/src/server.ts`: create the service after `acpRuntime`
   and the background-work registry, pass `process.pid`, and add it to `createTrpcContext`.
7. **Docs:** in [agent-lifecycle](../../architecture/agent-lifecycle.md) ("Session inside the
   pod"), add a paragraph on the process inventory: the three kinds, the classification
   rules, and what is never listed. In [persistence](../../architecture/persistence.md), add
   the `processes` runtime document and the boot-id rule. Bump `Last verified:`.

## Acceptance criteria

- [ ] `processes.list` returns `{ running, finished, pendingRestart: null }` matching the
      pinned README schemas.
- [ ] A plain tool command shows as `turn` only while its turn runs. Harness helper
      processes (MCP servers) never show.
- [ ] A Claude Code `run_in_background` command shows as `harness-task` with its pid and
      `keepsAwake: true`. A task whose command matches no single process still shows, with
      `pid: null`.
- [ ] `nohup … &` shows as `detached`. The runtime, catatonit, the harness, the pod service,
      PTYs and sshd never show.
- [ ] A Detached or Harness Task row that exits moves to `finished` with `endedBy: "exit"`.
      After a pod restart, rows still running at the last scan show with
      `endedBy: "hibernation"`.
- [ ] `processes.output` returns the tail of the recorded file, and `NOT_FOUND` for an
      unknown key.
- [ ] No env value other than `PLATFORM_KEEP` is read into a kept structure, logged, or
      returned.
- [ ] `mise run //packages/agent-runtime:check`, `mise run //packages/agent-runtime-api:check`
      and `mise run //packages/agent-runtime:test` pass. `mise run check:comment-types` passes.

## Smoke test

1. `mise run //packages/agent-runtime:test` and the two `:check` tasks above.
2. On the local cluster: `mise run cluster:build agents`, then open a claude-code agent and
   ask it to run `nohup sleep 900 > ~/sleep.log 2>&1 &` and a `run_in_background` loop that
   writes to a file.
3. Call the procedure inside the pod:
   `mise run cluster:kubectl -- exec -n <agent ns> <agent pod> -- node -e "fetch('http://127.0.0.1:8080/api/trpc/processes.list').then(r=>r.text()).then(console.log)"`.
   Expect one `detached` row for `sleep 900` with `outputPath` `…/sleep.log`, and one
   `harness-task` row with a pid.
4. Kill the `sleep` with `kill <pid>` in the same exec, call `list` again, and expect it under
   `finished` with `endedBy: "exit"`.

Then print a short manual smoke-test guide for the user that repeats steps 2–4.

**Open question to resolve here:** check whether Claude Code writes `run_in_background`
output to a file (then `outputPath` fills on its own) or to a pipe (then Harness Tasks have
no Output). Write down what you find in the agent-lifecycle paragraph and in the PR.
