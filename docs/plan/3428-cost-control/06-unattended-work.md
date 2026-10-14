# 06 — Stop unattended work, agent read

**Depends on:** 04-agent-limit-and-refusal (and uses the check that 05 completes)
**Part of:** Cost control — see [README](./README.md)

## Context

At a limit, model calls stop in the gateway.
Work that nobody watches must not start either (D7): a schedule does not fire, and a sub-agent does not start.
The chat send button stays.
This slice also lets the agent read its limits, its spend and what is left, without a way to change them (D4).

## Implementation plan

Apply `/typescript-engineering`.
Both gates use the blocked check of the spend service from slice 05, wired as a port in `bootstrap.ts`.
Slice 05 shipped it as `SpendCheck.blockedFor({ payer, connectionId? })`: it returns `"limit"`, `"ceiling"` or `null`.
Without a Connection it checks the dollar limits and the ceiling.

1. **Schedules** in `packages/api-server/src/modules/schedules/services/scheduler-runner.ts`.
   - Add a spend hold gate next to `onboardingPending` and `runtimeMigrating`, wired at `bootstrap.ts` where those gates are.
     Input: the schedule's agent and the fire pair's provider Connection.
   - Apply it in `fire()` through `hold()`, so that the run records "held: spend limit reached" (or "spend ceiling reached") and the next run is still enqueued.
   - Also apply it in `fireOnce()` and `runNow()`.
     Today `fireOnce` applies no gates and `runNow` checks only onboarding.
     A spend hold must cover all three.
   - Nothing fires later to catch up.
     The next regular run starts normally when the limit no longer applies.
2. **Sub-agent spawn** in `packages/api-server/src/modules/invocations/services/invocations-service.ts`.
   - After `resolveRoot`, check the root driver with the same port.
   - When it is blocked, throw a new error (for example `SpendLimitReachedError`) before any row or Agent is created.
   - Map it in `apps/harness-api-server/driver-ops.ts` to a new failure kind (for example `spend_limit_reached`).
     The MCP tool `spawn_subagent` in `sub-agent-tools.ts` shows a clear text, with no digits.
     The REST endpoint `POST /api/agents/:id/invocations` returns the kind.
   - Check how the Driver SDK clients (JS and Python, baked into the agent images) show a failure kind.
     They must show the reason.
     Change them only if they drop unknown kinds.
3. **Agent read** in `packages/api-server/src/apps/harness-api-server/mcp-endpoint.ts`.
   - A new read-only MCP tool `describe_spend_limits`, named like the other `describe_*` tools.
   - It returns the limits that apply to this agent's calls (those of its payer), today's spend per unit, what is left, the state of each limit and when the day resets.
   - It has no write tool.
     The agent cannot set, clear or continue a limit.
   - Pi has native MCP, so the tool must work on Pi too.
4. **Docs** (same commit):
   - `docs/architecture/schedules.md`, section "Fire": a fire is held at a spend limit or ceiling, and the run records why.
   - `docs/architecture/invocations.md`, section "Spawning": a spawn is refused when the root driver is at a spend limit or ceiling.
   - `docs/architecture/spend-limits.md`: a section "Unattended work and the agent's view".
   - Bump `Last verified:`, and run `mise run fix:markdown`.

## Acceptance criteria

- [ ] With the agent at its limit, a cron schedule fire is held with the spend reason, and the next run is enqueued.
- [ ] `runNow` and a once-schedule are held in the same way.
- [ ] After "continue" or after the UTC day changes, the next regular fire runs.
- [ ] With the root driver at its limit, `spawn_subagent` returns the spend reason, and no Agent and no invocation row is created.
- [ ] Under the limit, schedules and spawns work as before.
- [ ] `describe_spend_limits` returns the agent's limits, spend and what is left, from Claude Code and from Pi.
- [ ] `mise run check`, `mise run test` and `mise run check:comment-types` pass.

## Smoke test

On the dev cluster:

1. `mise run cluster:build -- api-server`.
2. Set a tiny limit on an agent and reach it (as in slice 04).
3. Create a schedule that fires in one minute.
   After the minute, the schedule's run history shows "held: spend limit reached".
4. In the same agent, ask it to spawn a sub-agent.
   It reports the spend reason, and `dam agent list` shows no new invocation agent.
5. Ask the agent: "Use describe_spend_limits and tell me what is left today."
   It answers with the limit and the spend.
   Do the same in a Pi agent.
6. `dam approval approve <id>` on the spend question.
   The next schedule fire runs.

Then print a short guide for Petr, so that he can repeat steps 3 to 5 by hand.
