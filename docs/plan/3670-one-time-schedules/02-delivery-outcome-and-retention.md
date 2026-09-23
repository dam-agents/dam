# 02 — Delivery outcome and retention

**Depends on:** 01-once-spec-and-fire-path
**Part of:** One-time tasks — see [README](./README.md)

## Context

A once Schedule has no next occurrence to make up for a lost fire, so its recorded result must say what actually happened: `success` when its `trigger` event settles on the pod, `missed` when the event expires undelivered. Today neither transition reaches the schedules module — a plain trigger never reports back (the outcome-handler seam only fires on Precheck reports), and the outbox sweep deletes expired rows with no callback. This slice adds an **api-server-only** per-kind listener seam on settle and on expiry in runtime-delivery (no pod change, so an old runtime image works), subscribes schedules to it for once, and adds the 30-day prune of completed once Schedules. Apply **/typescript-engineering**.

## Implementation plan

1. **Seam in runtime-delivery** — `packages/api-server/src/modules/runtime-delivery/`:
   - Add a registry beside the existing `EventOutcomeHandler` registry (`compose.ts` l.141-155, `registerEventOutcomeHandler` l.76/175): e.g. `registerEventLifecycleListener(kind, { onSettled(event), onExpired(event) })`. Keep it a port the schedules module consumes — schedules must not import runtime-delivery infrastructure.
   - **Settled:** `infrastructure/outbox-repo.ts` `recordOutcome` (l.233+) stamps `dispatchedAt` on settled ids (l.268-285). Have it return the settled event rows (id, kind, payload) newly stamped in this call — not ones already dispatched — and have `services/worker-handler.ts` (l.125-192) notify listeners after the transaction commits. A redelivery that settles an already-settled event must not notify twice.
   - **Expired:** `deleteExpiredEvents` (`outbox-repo.ts` l.538-549) — change to `DELETE … RETURNING id, kind, payload` and have `services/cron-sweep.ts` (l.134-137) notify listeners for the returned rows. Only rows never dispatched are deleted today; keep that.
   - Listener failures are logged and do not fail the apply or the sweep.
2. **Schedules subscribes** — in `packages/api-server/src/bootstrap.ts` next to the existing `"trigger"` outcome handler (l.984-998), register a lifecycle listener for `"trigger"` that forwards to a new runner method, e.g. `runner.recordDelivery(scheduleId, eventId, "success" | "missed")`:
   - Loads the schedule; acts only when `type === "once"` and `lastResult === "delivering"` (so a late or duplicate notification cannot overwrite a newer result, and recurring schedules are untouched).
   - Writes `lastFiredResult` via the repository (a narrow method, or `recordFire` with `nextRun` null) and emits the same schedule-changed event the fire emits, so an open UI refreshes.
   - The event id is `${scheduleId}:${fireAt}` (runner l.82) — parse the schedule id from the payload's `scheduleId`, not the id string.
3. **Retention** — prune completed once Schedules 30 days after they fired:
   - Repository: `deleteCompletedOnceOlderThan(days)` — `type = 'once'` in `spec` jsonb, `last_fired_at < now() - days`, and not `delivering` (a still-delivering one is at most 24 h old anyway, but be explicit). Model it on `deleteByAgent` (`schedules-repository.ts` l.231, no owner filter).
   - For each deleted row emit `ScheduleDeleted` and call `runner.cancel` defensively, as `schedules-service.ts` `delete` (l.187-206) does — return ids from the delete to do this.
   - Register a daily periodic job (`core/periodic-jobs.ts`), modelled on `composeAttentionRetention` (`modules/attention/compose.ts` l.30-46, registered in `bootstrap.ts` l.1277-1281). The 30 days is a constant in the schedules module, not config.

## Acceptance criteria

- [ ] A once that fires on a running agent moves `delivering` → `success` within one apply, with no pod/runtime change.
- [ ] A once whose trigger expires undelivered reads `missed` after the next outbox sweep (≤ 60 s past expiry).
- [ ] Recurring schedules' `lastResult` is unaffected (still written at commit); the Precheck outcome handler still works.
- [ ] A redelivered already-settled event does not re-notify.
- [ ] The prune job deletes once schedules fired > 30 days ago, including failed/missed ones, emits `ScheduleDeleted`, and leaves recurring schedules and younger once schedules alone.
- [ ] `mise run //packages/api-server:check` and `mise run //packages/api-server:test` green.

## Smoke test

- `mise run //packages/api-server:test` (existing runtime-delivery and scheduler suites).
- Local cluster: create a once "now" on a running agent → `success`. Hibernate/stop another agent so it can't come Ready (e.g. scale its StatefulSet to 0 with the controller paused per `cluster-ops`), create a once "now", set that event's `expires_at` into the past in Postgres, wait for the 60 s `runtime-outbox-sweep` → `missed`.
- Set a completed once row's `last_fired_at` to 31 days ago, trigger the prune job (or wait for its tick) → the row is gone and the UI list updates.
