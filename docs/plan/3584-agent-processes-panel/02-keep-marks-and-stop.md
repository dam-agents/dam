# 02 — Keep marks, user override, Stop

**Depends on:** 01-process-inventory
**Part of:** Agent processes panel — see [README](./README.md)

## Context

This slice adds the decisions on top of the inventory. The agent can keep a Detached Process
running with a new `platform-keep` command in the base image, and a kept process holds the
agent awake through `runtimeBusy()`. The user can override any keep decision (`setKeep`) and
stop any listed process (`stop`). When the user has decided about a process, later agent
calls on it are refused with a clear message. A Harness Task the user unkeeps keeps its
session open, so the harness doesn't kill it, but it no longer counts as busy. The agent
images that run long jobs (nous, gepa, …) learn to use `platform-keep` instead of `nohup`.

## Implementation plan

Apply `/typescript-engineering` to the runtime code.

1. **Document shape.** Extend the `processes` document from 01 with
   `marks: { id, pid, startTime, createdAt }[]` (id is the `PLATFORM_KEEP` value for a launch,
   or `pid:${pid}:${startTime}` for `--pid`) and
   `overrides: { key, keepsAwake, decidedAt }[]` (key = the row key from the README). Both are
   dropped on a new boot id, like 01 already does for the whole boot-scoped state
   (`startNewBoot` in `processes/domain/inventory.ts` builds the fresh document; add the two
   fields there).
2. **Keep resolution** (domain, pure, next to `classify.ts`): for each row,
   user override > agent mark > default. Defaults: Harness Task `true`, Detached `false`,
   Turn always `false` (no override allowed). A Detached row has an agent mark when any
   process in its tree carries a live mark: its `PLATFORM_KEEP` env value (read by the 01
   scan) matches a mark id, or its pid + start time matches a `--pid` mark. A mark is live
   while any scanned process still carries it, so it covers every descendant, even through
   `nohup`/`setsid`. Fill `keepsAwake` and `keepSource` from this. When
   `config.BACKGROUND_WORK_HOLDS` is off, `keepsAwake` is `false` for every row (the source
   still shows).
3. **Mark endpoint.** In `packages/agent-runtime/src/server.ts`, next to the
   `/api/sessions/:id/background-work` route and in the same style, add
   `POST /api/keep-marks`. Body (Zod schema `keepMarkRequestSchema` in
   `agent-runtime-api/src/modules/processes/schemas.ts`):
   `{ kind: "launch", markId, pid } | { kind: "pid", pid }`. The service reads the pid's start
   time from `/proc`. Answers:
   - 200 `{ key }` on success.
   - 404 `{ error }` when the pid doesn't exist or is one of the platform's own.
   - 409 `{ error }` when the user has an override on that process. The message names the
     choice and what to do, e.g. "The user set this process to stop at hibernation in the
     Processes panel. Ask them before keeping it."
   This endpoint, like the background-work one, is not a security boundary: the agent can
   kill its own processes anyway. "The user wins" is a rule an honest agent follows.
4. **`platform-keep` CLI** at `packages/agents/base/rootfs/usr/local/bin/platform-keep`
   (Node script, `#!/usr/bin/env node`, executable, same style as
   `packages/agents/claude-code/rootfs/usr/local/lib/report-background-work.mjs`). It talks to
   `$PLATFORM_RUNTIME_URL`. If that's unset, it explains and exits 1.
   - `platform-keep [--log FILE] -- <cmd> [args…]`: generate a random mark id. Pick the output:
     `--log FILE` if given, else the CLI's own stdout if it is a regular file, else
     `~/.platform/keep-logs/<markId>.log`. Spawn `<cmd>` with `detached: true` (own session),
     stdout and stderr to that file, stdin ignored, and env `PLATFORM_KEEP=<markId>`, then
     `unref()`. POST the `launch` mark with the child pid. Print one line,
     `kept: pid <pid>, output <path>`, and exit 0 while the child keeps running. If the POST
     fails, print the runtime's error, leave the child running unkept, and exit 1.
   - `platform-keep --pid <N>`: POST the `pid` mark and print the result. On 409, print the
     runtime's message and exit 1.
   - `platform-keep --help`: short usage that says kept work holds the agent awake until it
     exits, and that the user can see and stop it.
5. **User mutations** on the `processes` router (`agent-runtime-api`) and service:
   - `setKeep({ key, keepsAwake })`: store an override. `BAD_REQUEST` for a Turn Process.
     `NOT_FOUND` for an unknown key. Emits a notice.
   - `stop({ key })`: rescan, then SIGTERM every process in the row's tree (the root, its
     descendants, and its process group when the root leads one). After 5 s, SIGKILL whatever
     survives, checking each pid's start time first so a reused pid is never hit. Record the
     row as finished with `endedBy: "stop"`. `BAD_REQUEST` for a Harness Task with
     `pid: null`. Turn Processes may be stopped (the tool call fails, and the agent sees it).
6. **Busy integration** in
   `packages/agent-runtime/src/modules/acp/services/acp-runtime/acp-runtime.ts`:
   - Add a dep `keptProcesses?: () => number` (count of running Detached rows with
     `keepsAwake`). `runtimeBusy()` is also true when it's above 0. `describeBusy()` adds
     `N kept process(es)`.
   - The service scans every 15 s while any mark or `keepsAwake` Detached row is live, even
     with no watcher, so busy drops soon after kept work exits. (01 already scans every 30 s
     with no watcher, and every 3 s while watched: lower the unwatched period while a keep
     is live.) When the count drops to 0,
     call the same release path the registry uses (`lease.maybeRecycle()`), so a waiting
     recycle can run.
7. **Registry split** in `background-work-registry.ts`:
   - Inject `isKept(sessionId, item): boolean` (the processes service answers from overrides).
     `held()` (what counts as busy) includes only kept items. `hasWork(sessionId)` (what holds
     the session open) still counts every item. Fire `onRelease` when the busy set empties,
     even if the session hold remains.
   - On `stop` of a Harness Task, the service asks the registry to drop that item and to
     ignore it in later reports until a report leaves it out, so a stale harness report
     can't bring it back.
8. **Status surface.** `AcpRuntimeStatus` (`/api/status`) keeps its shape. `describeBusy`
   covers the new hold, so "why is this agent awake" stays explainable in the pod log.
9. **Agent instructions.** Teach agents to use `platform-keep`:
   - `packages/agents/base/rootfs/etc/AGENTS.md`: a short section. For a long job that must
     run after the turn ends, use `platform-keep -- <cmd>`. It holds the agent awake until
     the job exits, and the user sees it and can stop it. Plain `nohup … &` keeps running
     after the user leaves but stops when the agent hibernates. Never mark helper daemons.
   - Replace the `nohup` and "keep-awake escape hatch" guidance with `platform-keep` in
     `packages/agents/{nous,gepa,openevolve,shinkaevolve,skydiscover}/rootfs/etc/AGENTS.md`
     and in `packages/agents/{nous,gepa}/rootfs/app/working-dir/.agents/skills/*/SKILL.md`
     (`grep -rn -i -E "nohup|keep-awake" packages/agents`). Only the long campaign or
     experiment runs get `platform-keep`. Helpers like `nous-channel-bridge` stay plain
     `nohup`.
10. **Docs.** In [agent-processes](../../architecture/agent-processes.md): extend "Reported
   background work" and "Process inventory" with Keep Marks, the user override and who wins,
   the registry split (session hold vs busy), and Stop. In
   [agent-lifecycle](../../architecture/agent-lifecycle.md), rewrite "The blind spot — unreported
   work" under *Hibernate*: a kept Detached Process now holds the agent, and unkept work is
   still killed by hibernation. Add `platform-keep` to [agent-images](../../architecture/agent-images.md)
   if that page lists base-image helpers. Bump `Last verified:`.

## Acceptance criteria

- [ ] `platform-keep -- sh -c 'sleep 60; echo done'` returns at once, prints the pid and
      output path, and the process runs on in its own session with `PLATFORM_KEEP` set.
- [ ] While it runs, `/api/status` reports `idle: false`, and the pod log's busy description
      names the kept process. Within about 15 s after it exits, `idle` is `true`.
- [ ] A child the kept process forks, even through `nohup`/`setsid`, keeps the mark alive.
- [ ] `platform-keep --pid` on an unmarked Detached Process makes its row `keepsAwake: true`,
      `keepSource: "agent"`.
- [ ] After `setKeep` from the user, the row shows `keepSource: "user"`, and a later
      `platform-keep --pid` on it exits 1 with the user-choice message.
- [ ] A Harness Task set to `keepsAwake: false` no longer makes the runtime busy, and its
      session stays open (the task keeps running).
- [ ] `stop` ends the whole tree, including children in its process group, and the row moves
      to finished with `endedBy: "stop"`. `stop` on a Harness Task with `pid: null` is
      refused.
- [ ] With `BACKGROUND_WORK_HOLDS=off`, a marked process does not make the runtime busy.
- [ ] The agent images' AGENTS.md and skills no longer tell agents to use bare `nohup` for
      long jobs.
- [ ] `mise run //packages/agent-runtime:check`, `mise run //packages/agent-runtime:test`,
      `mise run //packages/agent-runtime-api:check`, `mise run //packages/agents:check` and
      `mise run check:comment-types` pass.

## Smoke test

1. Run the checks above.
2. `mise run cluster:build agents`. In a claude-code agent's terminal (or via
   `mise run cluster:kubectl -- exec`), run `platform-keep -- sh -c 'sleep 90; echo done'`.
3. `mise run cluster:kubectl -- exec … -- node -e "fetch('http://127.0.0.1:8080/api/status').then(r=>r.text()).then(console.log)"`
   shows `idle: false`. `processes.list` shows the row with `keepsAwake: true`,
   `keepSource: "agent"`.
4. Call `processes.setKeep` with `keepsAwake: false` (tRPC POST to
   `/api/trpc/processes.setKeep` with `{"key":"…","keepsAwake":false}`). `/api/status` turns
   `idle: true`. `platform-keep --pid <pid>` now exits 1 with the user-choice message.
5. Call `processes.stop` on it. The process is gone in `ps`, and the row is under finished
   with `endedBy: "stop"`.

Then print a short manual smoke-test guide for the user that repeats steps 2–5.
