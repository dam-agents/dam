# 02 — Unattended agents on the failing provider

**Depends on:** 01-slack-alert
**Part of:** Owners hear when a provider outage hits their unattended agents — see [README](./README.md)

## Context

Slice 01 tells only the owners of agents whose calls failed during the outage.
A daily schedule that fires after the outage starts, or a channel agent that nobody wrote to yet, has no failed call, but it will fail.
A provider that only a public status source reports has no failed calls at all.
This slice adds the owners of unattended agents whose fire provider is the failing template, and the message says why each agent is affected.
Each agent has a chat, a channel and a scheduled default, so a schedule and a channel turn of one agent can fire on different providers.

## Implementation plan

Apply `/typescript-engineering`.
The terms "unattended agent", "fire provider" and O12 are in [README — Terms](./README.md#terms) and [Decisions](./README.md#decisions).

1. **The candidates, from the database alone.**
   - `packages/api-server/src/modules/harness-config/infrastructure/default-model-notices.ts` already decides what an agent runs unattended: an enabled schedule, a Slack Channel in `channels` (type `slack`), or a Telegram chat in `telegram_conversations`, for agents that are not deleted and not spawned by a session.
     Move those three reads into one helper in that folder, so the notice reader and this slice keep one rule.
   - Add `createUnattendedAgentsReader(db)` in the same folder: `(templateId) => Promise<{ agentId: string; schedules: boolean; slack: boolean; telegram: boolean }[]>`.
     It reads the agents granted a Connection of that template (`connection_grants` joined to `connections` on `template_id`), keeps the ones the helper finds unattended, and says which kinds of work each one has.
   - Export a compose function for it from `modules/harness-config/compose.ts` and `index.ts`.
2. **The schedules of the candidates.** In `packages/api-server/src/modules/schedules/infrastructure/schedules-repository.ts`, add `listEnabledByAgents(agentIds)`, next to `listAllEnabled`.
   Bootstrap reaches it through `schedulesBoot.repo`.
3. **The fire provider of each kind of work**, in `packages/api-server/src/bootstrap.ts`:
   - For each enabled schedule: skip a one-time schedule that continues its session (`spec.type === "once"` and `spec.origin?.mode === "continue"`), because it keeps that session's choices.
     Else pass the schedule's model through `scheduleModelFor` (the same function the scheduler gets), and call `firePair(agentId, "scheduled", { harness: spec.harness, model })`.
   - For a Slack or a Telegram binding: call `firePair(agentId, "channel", {})` once for the agent.
     Use `firePair` itself, not `channelFirePair`, which runs the default conversion first.
   - When `firePair` throws `NoDefaultModelError` (`isNoDefaultModelError`), skip that work: such runs fail for another reason, and the default-model notice already tells the owner.
     When it returns `null`, no granted provider fits, so the fire is refused anyway: skip that work.
     When it returns `undefined` (a runtime that takes no pair), use the template of the agent's only provider grant, when it has exactly one; else skip that work.
   - Map the pair's provider Connection to its template with `createGrantedConnectionTemplates(db).templateOf(agentId, connectionId)`.
   - An agent is affected when a resolved template equals the outage template.
     Its reasons are `schedule`, `slack` and `telegram`, one for each kind of work that resolved to it.
   - Log and skip an agent whose resolution fails, so one agent never stops the alert of the others.
4. **The port.** Build `unattendedAgentsOn(templateId): Promise<{ agentId: string; affectedBy: OutageAlertAffectedBy[] }[]>` from steps 1–3, and pass it to `composeOutageAlerts`.
   Move the `composeOutageAlerts` call below `composeSchedulesAtBoot`, because the port needs `schedulesBoot`.
   The `outage-alerts` module imports no other module's internals.
5. **Merge in the service.** In `services/outage-alerts-service.ts`, `affectedAgents(outage)` merges the failed payers (reason `failed-calls`) and `unattendedAgentsOn(outage.templateId)`, one entry per agent with every reason.
   Then map each agent through `describeAgent` and skip a gone or disabled one, as in slice 01.
   Call `unattendedAgentsOn` only for a tellable outage, so the queries run only after the delay.
6. **Text.** The agent lines name the reasons ("calls failed", "schedule", "Slack channel", "Telegram chat"; README § Wording).
7. **Docs:**
   - `docs/architecture/provider-status.md`, section "Outage alerts": who is told now includes the owners of unattended agents whose fire provider is the template; a schedule fires on its own choices or the scheduled default, and a channel turn on the channel default; the rule for "unattended" is the one of the default-model notices.
     Bump `Last verified:`.
   - `docs/architecture/home-feed.md`, "Default-model notices": one sentence that outage alerts use the same rule for an agent that runs unattended.

## Acceptance criteria

- [ ] `mise run check` and `mise run //packages/api-server:test` pass; `mise run check:comment-types` passes.
- [ ] The default-model notices list the same agents as before.
- [ ] An agent with an enabled schedule whose choices, or whose scheduled default, fire on the failing template is named with "schedule", also without a failed call.
- [ ] An agent bound to Slack or Telegram whose channel default fires on the failing template is named with "Slack channel" or "Telegram chat"; with no channel default saved, its chat default decides.
- [ ] An agent whose channel default is on another template is not named for its binding, also when its chat default is on the failing one; the same holds for the scheduled default and its schedules.
- [ ] An agent with no default model is not named for that work, and the other agents are still named.
- [ ] A disabled agent, an agent with only disabled schedules and no binding, a sub-agent, and a one-time schedule that continues its session are not named.
- [ ] An agent with a failed call and a schedule shows both reasons in one line.
- [ ] Before the delay, the saga does not run the candidate queries.

## Smoke test

On the dev cluster, with the api-server image rebuilt and the chart redeployed with `apiServer.outageAlertDelay: "2m"`:

1. Prepare agents with IBM LiteLLM as their chat default:
   - agent B with an hourly schedule that names no model;
   - agent C bound to `#general`;
   - agent D with no schedule and no binding;
   - agent E with a second provider, its channel default and its scheduled default saved on that provider, an hourly schedule that names no model, and a binding to a test channel.
2. Cut IBM LiteLLM off with the iptables recipe, and send two messages each to two other IBM LiteLLM agents so that the template becomes degraded.
3. After the delay, the Slack DM names agent B with "schedule", agent C with "Slack channel", and the two agents of step 2 with "calls failed".
   It does not name D or E.

Print a short guide so Petr can repeat the steps by hand.
