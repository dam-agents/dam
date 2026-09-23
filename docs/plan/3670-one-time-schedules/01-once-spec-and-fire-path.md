# 01 — Once spec and fire path

**Part of:** One-time tasks — see [README](./README.md)

## Context

The core of the feature: the `once` spec type, its create/update procedures, and the scheduler fire path that treats it as a single occurrence — no re-arm, no onboarding hold, a 24 h delivery window, `lastResult: "delivering"` at commit. After this slice a once Schedule can be created over tRPC, fires at its moment (or immediately), opens a Session, and stays `delivering` (slice 02 turns that into `success`/`missed`). Apply **/typescript-engineering**.

## Implementation plan

1. **Contract** — `packages/api-server-api/src/modules/schedules/`:
   - `schemas.ts`: add `scheduleSpecOnceSchema` (`type: z.literal("once")`, `at: z.string().datetime({ offset: true })`, `timezone`, `task?`, `enabled`, `createdBy`, `version`; `.passthrough()` like its siblings) and add it to the `scheduleSpecSchema` discriminated union (~l.110). Add `scheduleCreateOnceInputSchema` (`agentId`, `name`, `task` required, `at?` local wall-clock `YYYY-MM-DDTHH:mm`, `timezone`) and `scheduleUpdateOnceInputSchema` (`id`, optional `name`/`task`/`at`/`timezone`). No `precheck`, `sessionMode`, `quietHours` fields — `.strict()` so a caller passing them gets a validation error, not silent drop.
   - `types.ts`: `ScheduleSpecOnce`, extend `ScheduleSpec`; add `createOnce` / `updateOnce` to `SchedulesService`; input types.
   - `router.ts`: `createOnce`, `updateOnce` procedures beside `createRRule`/`updateRRule`; fix `toView` (l.21-50) so `once` is not rendered as cron (expose `at`, `timezone`).
2. **Recurrence domain** — `packages/api-server/src/modules/schedules/domain/recurrences.ts`:
   - `nextFireAt`: for `once`, return `new Date(spec.at)` when the schedule has not fired yet, else `null`. `nextFireAt` has no status today — pass what it needs (e.g. an optional `firedAt`/`hasFired` argument, or a separate `onceNextFireAt(spec, status)`), keeping the cron/rrule paths untouched. The late-fire rule: a once whose `at` is in the past but inside the 24 h window and not yet fired still returns `at` (the queue fires it immediately).
   - Export a `resolveWallClock(local, tz): Date` built on the existing private `toInstant` so the service can turn input `at` into an instant.
   - `triggerExpiry`: once uses `fireAt + ONCE_DELIVERY_WINDOW` (24 h), not the 1 h TTL — add a parameter or a sibling function; do not change recurring expiry.
3. **Service** — `services/schedules-service.ts`:
   - `createOnce(input, createdBy = "user")`: validate timezone; resolve `at` (omitted → `now`); reject an instant earlier than now (allow a small skew, e.g. 60 s, so "now" from a slow client passes); write spec with `enabled: true`; `runner.sync`, emit `ScheduleCreated`, `securityLog` — mirror `createRRule` (l.100).
   - `updateOnce`: load; reject unless `type === "once"` and not yet fired (`lastRun` absent); same `at` validation; `updateSpec`; `runner.sync` re-arms the queue job.
   - `toggle` (l.208): reject for `once`.
   - `updateRRule` must keep rejecting a once id (check the type guard).
4. **Runner** — `services/scheduler-runner.ts` `fire()` (l.58-149):
   - Onboarding hold (l.72-80): skip the hold when `spec.type === "once"`.
   - Expiry (l.84-88): use the once delivery window.
   - Payload (l.89-96): never set `sessionMode`/`precheck` for once. (Slice 03 adds the session-type marker.)
   - Success (l.144-148): for once call `recordFire(id, "delivering", null)` and do not enqueue; recurring unchanged.
   - Error path (l.132-142): for once on the last attempt, `after` is `null` — record the error and stop; it must not re-arm.
   - `restoreAll` (l.226-235): a once with `nextRun` null or already fired must not be re-armed; one whose `nextRun` passed while the api-server was down and is still inside the window must be armed to fire now.
5. **Starter kits** — `packages/api-server/src/modules/starter-kits/services/starter-kits-service.ts` read-back (l.219-232): make sure a once schedule on a kit agent does not break the read-back mapping (skip or map safely). The kit schema itself (`api-server-api/src/modules/starter-kits/schemas.ts`) stays without `once`.
6. Run `mise run //packages/api-server-api:check`, `mise run //packages/api-server:check`, and fix any exhaustiveness errors the new union member exposes (UI/CLI compile errors from the widened union are fixed minimally here — a `once` case that renders something sensible — full UI/CLI work is slices 05/06).

## Acceptance criteria

- [ ] `schedules.createOnce` with `at` omitted creates a row whose `status.nextRun` ≈ now and fires within seconds; the agent opens a fresh Session with the task.
- [ ] `createOnce` with a future `at` + `timezone` stores the resolved UTC instant; a past `at` is rejected with a clear message; `precheck`/`sessionMode`/`quietHours` in the input are rejected.
- [ ] After firing, the row has `lastResult: "delivering"`, `lastRun` set, `nextRun` null, and no BullMQ job; a reconcile (`restoreAll`) does not re-arm it.
- [ ] A once on an agent whose onboarding is pending fires (no `held:` result).
- [ ] The trigger event's `expires_at` is fire time + 24 h.
- [ ] `updateOnce` works before the fire and is rejected after; `toggle` on a once is rejected.
- [ ] Existing cron/rrule behaviour unchanged: `mise run //packages/api-server:test` green (`scheduler-runner.test.ts`, `schedules-service.test.ts`, `schedules-recurrences.test.ts`).

## Smoke test

- `mise run //packages/api-server-api:check && mise run //packages/api-server:check && mise run //packages/api-server:test`.
- On the local cluster, call `schedules.createOnce` for an agent with no `at` (via the UI's tRPC client in the browser devtools, or a short `mise run` script against the api-server) and confirm the Session opens and the row reads `delivering` with `nextRun` null.
