# 03 — Settings wait for kept Harness Tasks

**Depends on:** 02-keep-marks-and-stop
**Part of:** Agent processes panel — see [README](./README.md)

## Context

Today a new connection (new env var names) or a config change makes the harness lease
recycle the harness, at the latest 60 s later, even while work runs. A recycle closes every
session, and the harness kills its background tasks as it goes, so kept Harness Tasks die. This
slice changes the rule: **a recycle for env or config is never forced while a kept Harness
Task runs.** The change waits. The `processes.list` result reports it as `pendingRestart`,
and a new `applyPendingRestart` mutation lets the user apply it now. The user can also unblock
it by stopping or unkeeping the task, or by Hard Stop / Pause of the agent. This ships to
everyone, not behind the flag.

## Implementation plan

Apply `/typescript-engineering`.

1. **Harness lease**
   (`packages/agent-runtime/src/modules/acp/services/acp-runtime/harness-lease.ts`):
   - New dep `forceBlocked(): boolean`: true while a kept Harness Task runs. acp-runtime
     answers it from the background-work registry's kept items (`held()` after the 02
     split), not from Detached marks, since a recycle doesn't touch detached work.
   - The force timer (`forceTimer`, armed in `refreshEnv({ force: true })`,
     `recycleForConfig()` and `requestRecycle()` for the env/config reasons) checks
     `forceBlocked()` when it fires. If blocked, it does not recycle. It records that the
     forced recycle is owed. Then, when the block clears (the registry's `onRelease` already
     calls `lease.maybeRecycle()`), a pending recycle runs at once if the runtime is idle.
     Otherwise it re-arms the force timer so a running turn still drains first.
   - `harness-unresponsive` keeps today's forced behavior. A wedged harness has to go, even
     if it costs kept tasks.
   - New `pending(): { reason: "env-recycle" | "config-recycle"; since: number } | null` and
     `recycleNow()` (tear down at once, whatever is busy, through the same `recycle()` path).
     Keep `supersededRecycle` / `cancelRecycleRequest` semantics intact.
2. **acp-runtime** (`acp-runtime.ts`): pass `forceBlocked`, expose `pendingRestart()`
   (non-null only while a recycle is pending **and** `forceBlocked()` is true, with
   `blockingTasks` = number of kept Harness Task items) and `applyPendingRestart()`. Tell a
   listener when either changes (reuse the registry change hook from 01 plus a lease
   callback), so the processes service emits a notice.
3. **Processes service and router:** fill `pendingRestart` in `processes.list` from
   `acpRuntime.pendingRestart()`. Add the `applyPendingRestart` mutation
   (`PRECONDITION_FAILED` when nothing is pending) to
   `agent-runtime-api/src/modules/processes/router.ts` and the `ProcessesService` type.
4. **Log line.** When a forced recycle is held back, log once:
   `holding <reason> for N kept background task(s)`, next to the existing `RECYCLE_LOG`
   messages.
5. **Existing tests.** `acp-runtime/__tests__/acp-runtime-env-changes.test.ts` and
   `acp-runtime-staying-awake.test.ts` encode the old "force after 60 s regardless" rule.
   Update the cases that now contradict the new rule. Don't add new suites.
6. **Docs.** Update the recycle wording in
   [harness-config](../../architecture/harness-config.md) ("on the same deferral the env rail
   uses"), the env rail in [runtime-delivery](../../architecture/runtime-delivery.md) or
   [connections](../../architecture/connections.md) (wherever the 60 s force is stated), and the
   "Reported background work" in
   [agent-processes](../../architecture/agent-processes.md): kept Harness Tasks block a forced
   recycle until they end, the user stops or unkeeps them, or the user applies the change.
   Bump `Last verified:`.

## Acceptance criteria

- [ ] With a kept Harness Task running, adding a connection does not recycle the harness
      after 60 s. The task keeps running, and `processes.list` shows `pendingRestart` with
      `reason: "env-recycle"` and `blockingTasks: 1`.
- [ ] `applyPendingRestart` recycles at once. `pendingRestart` becomes `null`, and the task
      shows as finished.
- [ ] Unkeeping or stopping the blocking task lets the pending recycle run (at once if idle,
      after the turn drains otherwise) without `applyPendingRestart`.
- [ ] With only an unkept Harness Task, or no tasks, the old behavior holds (forced after
      60 s), and `pendingRestart` stays `null`.
- [ ] `harness-unresponsive` is still forced.
- [ ] `mise run //packages/agent-runtime:test`, `mise run //packages/agent-runtime:check`,
      `mise run //packages/agent-runtime-api:check` and `mise run check:comment-types` pass.

## Smoke test

1. Run the checks above.
2. `mise run cluster:build agents`. In a claude-code agent, ask for a `run_in_background`
   loop that runs ten minutes.
3. Add any connection to the agent in the UI. Wait 90 s. `processes.list` (via
   `mise run cluster:kubectl -- exec … node -e "fetch(…/api/trpc/processes.list)…"`) shows
   `pendingRestart`, the task is still running, and the pod log has the "holding env-recycle"
   line.
4. POST `/api/trpc/processes.applyPendingRestart`. The pod log shows the env recycle. The task
   is gone, and `pendingRestart` is `null`.

Then print a short manual smoke-test guide for the user that repeats steps 2–4.
