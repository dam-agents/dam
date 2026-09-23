# 03 — `schedule_once` session type

**Depends on:** 01-once-spec-and-fire-path
**Part of:** One-time tasks — see [README](./README.md)

## Context

Sessions opened by a one-time task must be distinguishable from recurring-schedule Sessions, so the UI can group and label them and a Session knows it came from a once. Today agent-runtime stamps every trigger Session `schedule_cron` (`trigger-plugin.ts` l.47-51). This slice adds a marker to the trigger payload, stamps `schedule_once` when it is present, and teaches every session-type enumeration the new value. An older runtime that ignores the marker falls back to `schedule_cron` — acceptable. Apply **/typescript-engineering** (and **/react-ui-engineering** for the small UI label change).

## Implementation plan

1. **Payload** — `packages/agent-runtime-api/src/modules/runtime/types.ts` `triggerEventPayload` (l.129-137): add `once: z.literal(true).optional()` (or `scheduleType: z.enum(["recurring","once"]).optional()` — pick one, optional so old api-servers/runtimes stay compatible).
2. **api-server** — `scheduler-runner.ts` payload build (l.89-96): set the marker for `type === "once"`.
3. **Session type enumerations** — add `ScheduleOnce: "schedule_once"`:
   - `packages/api-server-api/src/modules/sessions/types.ts` `SessionType` (l.3-12) and the category mapping (l.67-92) — `schedule_once` belongs to the `"scheduled"` category.
   - `packages/agent-runtime-api/src/modules/sessions/schemas.ts` `podSessionTypeSchema` (l.5-12).
   - `packages/agent-runtime/src/modules/acp/domain/session-list.ts` pod-type map (l.48).
4. **agent-runtime** — `packages/agent-runtime/src/modules/runtime-channel/drivers/trigger-plugin.ts` `startSession` (l.43-75): `type: payload.once ? SessionType.ScheduleOnce : SessionType.ScheduleCron`; a once never takes the continuous branch. `acp-runtime/acp-runtime.ts` `isMachineSession` (l.152-155) must count `schedule_once` as machine-driven (it already matches on `scheduleId`, but make the type check explicit).
5. **UI labels** — `packages/ui/src/modules/sessions/lib/session-category.ts` (l.10-21) and `api/acp-session-ops.ts` pod→view map (l.99-106): label `schedule_once` "One-time task"; the sidebar filter (`sessions-sidebar.tsx` l.66) groups it under scheduled.
6. Grep the repo for other `schedule_cron` / `ScheduleCron` switches (spend accounting — `session-type-spend.test.ts` hints at one) and add the once case where the switch is exhaustive or where cron-specific behaviour should also apply.

## Acceptance criteria

- [ ] A once fire opens a Session whose metadata type is `schedule_once`, visible via `dam session list <agent>`.
- [ ] Recurring fires still stamp `schedule_cron`.
- [ ] The UI sessions sidebar lists the Session under the scheduled group, labelled as a one-time task.
- [ ] `mise run //packages/agent-runtime:test`, `mise run //packages/agent-runtime-api:check`, `mise run //packages/api-server:test`, `mise run //packages/ui:check` green.

## Smoke test

- The package test/check tasks above.
- Local cluster (after rebuilding the runtime image per `cluster-ops`): create a once "now", then `dam session list <agent>` shows the new Session with type `schedule_once`; the UI sidebar shows it under scheduled.
