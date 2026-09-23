# 04 — Agent MCP tool

**Depends on:** 01-once-spec-and-fire-path
**Part of:** One-time tasks — see [README](./README.md)

## Context

Agents need to plan a single follow-up — a check-back, a retry after a rate limit, a hand-off to a fresh Session now — without a recurring schedule they must remember to delete. This slice adds a dedicated `schedule_once` platform MCP tool (a narrow schema is harder for a model to misuse than a third branch in `create_schedule`), and bounds agent-created once Schedules so an agent cannot spin itself into a loop: at most **20 open** (not yet fired, or `delivering`) and at most **30 created in a sliding hour**, per agent, `createdBy: "agent"` only, both configurable via Helm. Users are not limited. Apply **/typescript-engineering**.

## Implementation plan

1. **Config** — follow the `approvalHoldSeconds` pattern:
   - `helm/values.yaml` under `apiServer:` (near l.971): `oneTimeSchedules: { agentMaxOpen: 20, agentMaxPerHour: 30 }` with a one-line description each.
   - `helm/templates/apiserver/app.yaml` (near l.389): env `ONCE_SCHEDULE_AGENT_MAX_OPEN`, `ONCE_SCHEDULE_AGENT_MAX_PER_HOUR`.
   - `packages/api-server/src/config.ts`: zod fields with those defaults (l.109 pattern) and `loadConfig()` mapping (l.192+).
   - Pass into `composeSchedulesAtBoot` (`bootstrap.ts` l.968-983 → `schedules/compose.ts`).
2. **Limits in the service** — `schedules-service.ts` `createOnce` when `createdBy === "agent"`:
   - Open count: once schedules of the agent that have not completed (`lastResult` absent or `"delivering"`) — a repository count query on the `spec` jsonb type.
   - Hourly count: once schedules of the agent with `createdBy: "agent"` and `created_at > now() - 1h`. The prune (slice 02) keeps rows ≥ 30 days, so the row table is the source — no Redis counter needed. A deleted row no longer counts; acceptable.
   - Exceeding either throws a typed error whose message says which limit, its value, and that a user can still create one-time tasks from the UI.
3. **MCP tool** — `packages/api-server/src/apps/harness-api-server/mcp-endpoint.ts`, after `create_schedule` (l.741-866):
   - `schedule_once` with args `name`, `task`, `at?` (local wall-clock `YYYY-MM-DDTHH:mm`), `timezone` (required when `at` is given; default `UTC` otherwise). Description: run a task exactly once in a fresh session — at `at` in `timezone`, or immediately when `at` is omitted; PREFER THIS over `create_schedule` for anything that should happen once (check-backs, retries); the time must be absolute — compute it from the current time and verify the resolved instant returned; no precheck.
   - Calls `schedules.createOnce(input, "agent")`; returns JSON with `id`, `name`, the resolved `fireAt` instant (UTC ISO) and the same moment rendered in `timezone`, so the agent can check its own arithmetic.
   - Maps validation errors and limit errors to `errorResult` text the model can act on.
   - `list_schedules` (l.727-739) and the `create_schedule` result (l.848-850): render once schedules explicitly (type, `at`, derived state) instead of the rrule-else-cron ternary. `create_schedule` description: add one line pointing single-occurrence work to `schedule_once`.
   - `toggle_schedule` on a once returns the service's rejection as a tool error; `delete_schedule` works unchanged (cancel = delete).

## Acceptance criteria

- [ ] In a chat, the agent can call `schedule_once` with no `at` and a new Session starts; with `at` + `timezone` the tool returns the resolved instant and the schedule appears in the UI with creator *agent*.
- [ ] The 21st open agent-created once and the 31st created within an hour are refused with a message naming the limit; a user-created once is never refused by these limits.
- [ ] Limits change when the Helm values change (rendered env → config).
- [ ] `list_schedules` shows once schedules with their `at` and state.
- [ ] `mise run //packages/api-server:test` green (`schedule-mcp-tools.test.ts`, `mcp-endpoint-stateless.test.ts`); `mise run check` green including Helm lint.

## Smoke test

- `mise run //packages/api-server:test`.
- Local cluster: in a chat, "Check back on this in 5 minutes by scheduling a one-time task." → tool call visible, resolved instant echoed, schedule listed. Then ask it to create 31 one-time tasks for tomorrow; the tool refuses at the configured limit.
