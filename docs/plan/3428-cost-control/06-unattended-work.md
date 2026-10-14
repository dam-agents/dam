# 06 — Stop unattended work, agent read

**Depends on:** 04-agent-limit-and-refusal (and uses the check that 05 completes)
**Part of:** Cost control — see [README](./README.md)

## Context

At a limit, model calls stop in the gateway.
Work that nobody watches must not start either (D7): a schedule does not fire, a sub-agent does not start, and a Slack or Telegram turn does not start.
The chat send button stays.
The README section "Holds" has the rules for each case (decided 2026-10-14).
This slice also lets the agent read its limits, its spend and what is left, without a way to change them (D4).

## Implementation plan

Apply `/typescript-engineering`.
All holds use one port, wired in `bootstrap.ts`: input the agent and, when known, its provider Connection; output `"limit"`, `"ceiling"` or `null`.

1. **The hold port.**
   - Slice 05 shipped `SpendCheck.blockedFor({ payer, connectionId? })`.
     Rename it to `holdFor`, and let it return the reason, the payer's owner and the questions for the reached soft limits, as `checkCall` does.
     Without a Connection it checks the dollar limits and the ceiling.
   - Move the code that asks the owner (`askToContinue` in the approvals module's ext_authz gate) to its own service, so that the gate and a hold use the same code.
   - In `bootstrap.ts`, the port finds the payer (the root driver), checks it, and asks the owner at a soft limit.
     Compose the spend system before the Slack and Telegram workers, because they take the port.
2. **Schedules** in `packages/api-server/src/modules/schedules/services/scheduler-runner.ts`.
   - Add a spend hold gate next to `onboardingPending` and `runtimeMigrating`.
     Input: the schedule's agent and the fire pair's provider Connection.
   - Apply it in `fire()` through `hold()`, so that the run records "held: spend limit reached" (or "spend ceiling reached") and the next run is still enqueued.
   - Also apply it in `fireOnce()` and `runNow()`.
     Today `fireOnce` applies no gates and `runNow` checks only onboarding.
     A spend hold must cover all three.
     A held `runNow` is refused with the reason, as onboarding is.
   - A recurring schedule: nothing fires later to catch up.
     The next regular run starts normally when the limit no longer applies.
   - A one-time schedule waits inside its 24-hour delivery window, because the architecture says that nothing may skip it (decided 2026-10-14).
     A held fire records no result.
     It re-arms one time, at the next UTC midnight (or at the end of the window, if that comes first, so that it is recorded "missed").
     When the owner sets a limit or continues one, the spend module emits a new domain event `SpendLimitsChanged`.
     A schedules saga then re-arms that owner's waiting one-time schedules at once.
     It claims each one with a conditional write first, so that two quick events cannot fire one task two times.
3. **Sub-agent spawn** in `packages/api-server/src/modules/invocations/services/invocations-service.ts`.
   - After `resolveRoot`, check the root driver with the same port, with the inherited provider Connection.
   - When it is blocked, throw a new error (`SpendLimitReachedError`) before any row or Agent is created.
   - Map it in `apps/harness-api-server/driver-ops.ts` to a new failure kind (`spend_limit_reached`).
     The MCP tool `spawn_subagent` in `sub-agent-tools.ts` shows a clear text, with no digits.
     The REST endpoint `POST /api/agents/:id/invocations` returns the kind.
   - The Driver SDK clients (JS and Python) print the status and the body of a failed spawn, so they show the reason without a change.
4. **Slack and Telegram** in `packages/api-server/src/modules/channels/infrastructure/`.
   - `slack.ts`, ambient round: skip a reader at a limit, next to the Terms check, silently.
   - `slack.ts`, `relaySharedTurn` (every addressed turn: mention, direct message, whisper, hand-off): after the Terms check, a held agent starts no turn.
     A person gets an ephemeral notice; a bot gets one notice in the thread.
   - `slack.ts`, the hand-off tool: refuse a hand-off to a held agent with the reason, next to the Terms check.
   - `telegram.ts`: after the Terms check, a held agent starts no turn, and DAM posts the notice in the chat.
   - The notice names the agent and has the soft limit or ceiling text; use the brand name from the config.
   - The hold uses the Connection of the agent's default session pair (`firePair(agentId, {})`), so that it agrees with the gateway for an agent on the Claude subscription or Bob (decided 2026-10-14).
5. **Agent read** in `packages/api-server/src/apps/harness-api-server/mcp-endpoint.ts`.
   - A new read-only MCP tool `describe_spend_limits`, named like the other `describe_*` tools.
   - It returns the limits that apply to this agent's calls (those of its payer), today's spend per unit, what is left, the state of each limit and when the day resets.
   - It has no write tool.
     The agent cannot set, clear or continue a limit.
   - Pi has native MCP, so the tool must work on Pi too.
6. **Docs** (same commit):
   - `docs/architecture/schedules.md`, section "Fire": a fire is held at a spend limit or ceiling, and the run records why.
   - `docs/architecture/invocations.md`, section "Spawning": a spawn is refused when the root driver is at a spend limit or ceiling.
   - The channels architecture page: a turn is held at a spend limit or ceiling.
   - `docs/architecture/spend-limits.md`: a section "Unattended work and the agent's view".
   - Bump `Last verified:`, and run `mise run fix:markdown`.

## Acceptance criteria

- [x] With the agent at its limit, a cron schedule fire is held with the spend reason, and the next run is enqueued.
- [x] `runNow` is refused with the spend reason.
- [x] A one-time schedule at a limit does not fire and records no result; after "continue" it fires at once, and after the UTC day changes it fires at midnight.
- [x] After "continue" or after the UTC day changes, the next regular fire runs.
- [x] With the root driver at its limit, `spawn_subagent` returns the spend reason, and no Agent and no invocation row is created.
- [x] At a soft limit, a hold creates the owner's "continue?"
  question when none exists for that limit, day and extension.
- [x] In Slack, at a limit, a person's mention gets an ephemeral notice, a bot's mention gets one notice in the thread, ambient mode skips the agent silently, and the agent does not wake.
- [x] In Telegram, at a limit, a message gets the notice, and the agent does not wake.
- [x] Under the limit, schedules, spawns and channel turns work as before.
- [x] `describe_spend_limits` returns the agent's limits, spend and what is left, from Claude Code and from Pi.
- [x] `mise run check`, `mise run test` and `mise run check:comment-types` pass.

## Smoke test

On the dev cluster:

1. `mise run cluster:build -- api-server`.
2. Set a limit that is not reached yet on an agent.
   Ask the agent: "Use describe_spend_limits and tell me what is left today."
   It answers with the limit and the spend.
   Do the same in a Pi agent.
   At a limit the agent cannot answer, because the gateway refuses its model calls.
3. Set a tiny limit on the agent and reach it (as in slice 04).
4. Create a schedule that fires in one minute.
   After the minute, the schedule's run history shows "held: spend limit reached".
5. Spawn a sub-agent from the agent's pod as a Driver SDK script does: a script spawns without a model call.
   The spawn reports the spend reason, and `dam agent list` shows no new invocation agent.
6. Mention the agent in a Slack channel where it is bound.
   You get a notice that only you see, and the agent does not wake.
7. `dam approval approve <id>` on the spend question.
   The next schedule fire runs.

Then print a short guide for Petr, so that he can repeat steps 2 to 6 by hand.
