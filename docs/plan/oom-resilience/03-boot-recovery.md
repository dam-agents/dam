# 03 — Boot-time recovery + interrupted turn meta

**Depends on:** 02-active-turn-markers
**Part of:** oom-resilience — see [README](./README.md)

## Context

With markers durable, this slice consumes them at boot: machine-driven sessions get one
automatic resume with an injected interruption notice (riding the proven in-process
trigger-driver path); interactive sessions keep their marker and report it on `session/load`
via `_meta.platform.turn.interruptedAt`, for slice 04 to render. This respects the
no-auto-resend doctrine (`agent-lifecycle.md`): the notice is a new prompt, never a replayed
user prompt, and interactive recovery stays user-initiated.

## Implementation plan

Apply `/typescript-engineering`.

1. Shared contract (`packages/api-server-api/src/modules/acp/types.ts`): extend
   `platformReplayTurnMetaSchema` with `interruptedAt: z.string().optional()`.
2. `session-bootstrap.ts`: new dep `interruptedAt(sessionId): string | undefined`; in
   `respondFromLog`, build the load-kind turn meta as
   `{ inFlight, ...(interruptedAt && { interruptedAt }) }`. Wire the dep in `acp-runtime.ts`
   from the active-turn store: report `startedAt` of a leftover marker only while the session
   has no new turn in flight (a marker just re-recorded by a running turn is not "interrupted").
   Simplest correct rule: expose from the store the entries that were loaded from disk at
   boot (a boot-leftovers snapshot), minus any since cleared/re-recorded.
3. New `packages/agent-runtime/src/modules/acp/services/interrupted-turn-recovery.ts`:
   - Module const `INTERRUPTION_NOTICE` per the README contract (a `<turn-interrupted>` block).
   - `recoverInterruptedTurns(deps: { store, sessionMetadata, triggerDriver, log })`:
     for each boot leftover with `origin === "machine"` and `attempts === 0` and a
     non-tombstoned session: `bumpAttempts(sessionId)` first (crash-loop guard), then
     `triggerDriver.start({ task: INTERRUPTION_NOTICE, resumeSessionId: sessionId })`,
     catching and logging per-session failures. Leftovers with `attempts > 0` are logged and
     left for surfacing only. Interactive leftovers untouched.
4. Wire in `server.ts` inside the `server.listen` callback, after `helloOnBoot`: run recovery
   once the env store is ready — `envStore.ready()` immediately, else on the env plugin's
   first `onChange` (one-shot). Delay by a few seconds (`setTimeout`, unref) so boot-time
   contribution churn settles first; a marker names work already lost, so seconds don't matter.
5. Docs: update `docs/architecture/agent-lifecycle.md` (Session inside the pod — interrupted
   turns and recovery; the notice; the machine/interactive split) and
   `docs/architecture/persistence.md` (the active-turns document alongside the
   undelivered-prompts one; correct the "a fire interrupted by a pod restart is discarded"
   statement to mention recovery). Follow `docs/guidelines/documentation-guidelines.md`,
   bump `Last verified:` on edited pages.

## Acceptance criteria

- [ ] A leftover machine marker triggers exactly one `session/resume` + notice prompt; its
      `attempts` is bumped before the resume is attempted.
- [ ] A machine marker with `attempts > 0` is never resumed again.
- [ ] Interactive leftover ⇒ `session/load` reply carries `turn.interruptedAt`; completing a
      new turn on that session clears it.
- [ ] Recovery failures (e.g. harness cannot load the session) are logged, never crash boot.
- [ ] Architecture pages updated; `mise run check` green across agent-runtime, api-server-api.

## Smoke test

`mise run agent-runtime:test`, `mise run check` (workspace). Manual (dev mode): mid-turn
`kill -9` the runtime on a schedule-typed session (create the marker with a machine origin),
restart, and watch the log for the resume + injected notice reaching the harness; for an
interactive session, restart and confirm the `session/load` response JSON carries
`_meta.platform.turn.interruptedAt`.
