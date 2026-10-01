# 02 — Wake the driver when a tool-spawned child ends

**Depends on:** 01-sub-agent-tools
**Part of:** Spawn a sub-agent through a tool call — see [README](./README.md)

## Context

A model that spawned a sub-agent and then ended its turn, or whose `await_invocations` call
ran out, never learns the child finished. Satellites solve the same gap: an outcome the
agent was not waiting for is delivered as a new turn, and a hibernated agent is woken for
it. This slice applies that mechanism to Invocations created by `invoke_agent`. Script
spawns are never pushed.

## Implementation plan

Apply `/typescript-engineering`. Read `docs/architecture/satellites.md` § Jobs and
`packages/api-server/src/modules/satellites/services/outcome-delivery.ts` and the
`deliveredAt` / `awaitedUntil` / `wokeAt` queries in
`packages/api-server/src/modules/satellites/infrastructure/satellites-repository.ts`
first; mirror them.

1. **Schema.** In `packages/db/src/schema.ts`, table `invocations`, add `origin`
   (`'tool' | 'script'`, not null, default `'script'`), `delivered_at`, `awaited_until`,
   `woke_at` (timestamptz, nullable). Add a partial index for undelivered terminal tool
   rows. Generate the migration with `mise run //packages/db:generate`.
2. **Record the origin.** `SpawnInput` gains `origin`; the HTTP route passes `script`,
   `invoke_agent` passes `tool`. The repository insert stores it.
3. **Await suppresses and delivers.** `await_invocations` sets `awaited_until` on the ids it
   waits on (now + bound + a small margin) at the start of each call, and marks
   `delivered_at` on each terminal child it returns.
4. **Outcome delivery.** Add `services/outcome-delivery.ts` in the invocations module,
   following the satellites one: claim a driver's terminal, undelivered, not-being-awaited
   tool rows (limit per turn and char budget as there), describe each (label, id, done
   with result JSON or failed with reason), `bump` one `invocation-outcome` event with
   `{ task, ids }`, `enqueueAfterCommit`, `wakeIfHibernated`, mark woken; release the
   claim on failure. Add the hourly wake retry the same way. The task text ends with
   "Carry on with whatever you were asked to do with this result. If nothing was asked,
   summarize it briefly."
5. **Trigger.** Call delivery for the driver whenever an Invocation goes terminal: the
   `recordResult` success path and every failure path (setup failure, deadline and restart
   in `invocation-liveness.ts`, Driver Cascade does not apply since the driver is gone).
   Find the one repository write that sets a terminal status if there is one, and trigger
   after it commits; otherwise call from each path. Wire it in
   `packages/api-server/src/bootstrap.ts` beside `deliverSatelliteOutcome`, reusing the
   same `bump` / `enqueue` / `wakeAgent` deps, and register
   `invocation-outcome-wake-retry` on `periodicJobs` hourly.
6. **Runtime event kind.** In `packages/agent-runtime-api/src/modules/runtime/types.ts` add
   the `invocation-outcome` kind and its payload schema beside `satellite-outcome`. In
   `packages/agent-runtime/src/modules/runtime-channel/drivers/session-event-plugins.ts`
   add `createInvocationOutcomePlugin`. It resumes the Session whose tool call started the
   Invocation (the runtime records `[invoke] spawned … -> <id>` lines from completed tool
   calls in a small store on its own disk) and opens a regular chat Session only as a fallback,
   and register it in `runtime-channel/manifest.ts` with `defaultOn: true`. A runtime that
   does not advertise the kind drops the event at dispatch; the driver still has
   `await_invocations`.
7. **Docs.** `docs/architecture/invocations.md`: outcome delivery for tool spawns, why
   scripts are excluded, how a running await suppresses it. `docs/architecture/runtime-delivery.md`:
   add `invocation-outcome` to the event kinds list. Bump `Last verified:` on both.

## Acceptance criteria

- [ ] A tool-spawned child that ends while no `await_invocations` covers it continues the
      session that invoked it, once, waking the driver if it hibernated.
- [ ] A child returned by `await_invocations` never produces an outcome turn.
- [ ] A child that ends during a running `await_invocations` call is returned by that call,
      not pushed.
- [ ] A script-spawned child never produces an outcome turn.
- [ ] Each child produces at most one outcome turn; the hourly retry wakes a driver whose
      turn is written but that did not wake.
- [ ] Migration applies on a fresh and an existing database.
- [ ] `mise run check`, `mise run test` and `mise run check:comment-types` pass.

## Smoke test

`mise run check` and `mise run test` (existing satellites and invocations suites stay
green). On the local cluster with the new runtime image: ask a Claude Code agent to call
`invoke_agent` with a prompt that sleeps 90 s then reports `"ok"` (schema
`{"type":"string"}`), and to end its turn without awaiting. Within seconds of the child
reporting, a new session appears on the driver with the outcome. Repeat but let the agent
call `await_invocations`: no extra session appears. Run a `dam-invoke` script spawn: no
outcome session.
