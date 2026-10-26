# 01 — Slack and Telegram replies name the outage

**Part of:** Outage messages only where work failed — see [README](./README.md)

## Context

A failed addressed Slack or Telegram turn whose model call hit a provider outage replies today with the generic "Something went wrong while relaying this message — try again."
This slice gives that turn a reply that names the provider and its outage, with the same three cases as the web chat's failed-turn card.
It also marks every such failure, addressed or ambient, with the reason `provider-unavailable` and the template on `ChannelTurnRelayed`, which slice 03 reads.
It covers AC-3 and AC-4.

## Implementation plan

Apply `/typescript-engineering` to the api-server changes and `/react-ui-engineering` to the one UI import change.

1. **Share the "provider down" rule.**
   Move the `PROVIDER_UNAVAILABLE` pattern out of `packages/ui/src/modules/acp/errors.ts` into a browser-safe module of `packages/api-server-api/src/modules/provider-status/` (for example `provider-error.ts`), as a function such as `saysProviderUnavailable(text: string): boolean`.
   Export it from `packages/api-server-api/src/index.ts`.
   `errors.ts` in the UI calls the shared function; its behavior does not change.

2. **Classify the failure.**
   In `packages/api-server/src/modules/channels/infrastructure/turn-failure-copy.ts`, `classifyTurnFailure` stays synchronous.
   Add a branch before the generic `acp-error`: an error whose message (and its JSON-RPC `data`, where it has one) says the provider is unavailable gets the reason `provider-unavailable`.
   Its copy needs the outage state, so the branch returns a marker that the worker resolves (step 4); keep the other branches as they are.
   The wake, stall, stopped and no-default-model branches keep their order before it, so their copy wins.

3. **Write the copy.**
   Add `packages/api-server/src/modules/channels/infrastructure/provider-outage-copy.ts`, beside `spend-hold-copy.ts`, with one function per messenger or one function and a time formatter, in the style of `spend-hold-copy.ts`.
   Inputs: the provider's display name (`PROVIDERS[providerTypeForTemplateId(templateId)].displayName` from `api-server-api`, or "The model provider" for an unknown template), the condition, the brand name, and the time.
   The three conditions, worded after `packages/ui/src/modules/provider-status/lib/copy.ts`:
   - degraded: "`<Provider>` has had an outage since `<time>`, so this agent could not answer.
     Try again when `<Provider>` works again."
     plus "`<Provider>` status: `<url>`" when the outage has a status page;
   - the fault is on the platform's side: "`<Brand>` cannot reach model providers, so this agent could not answer.
     The problem is on `<Brand>`'s side.
     Try again in a few minutes.";
   - no outage known: "`<Provider>` did not respond, so this agent could not answer.
     Try again in a few minutes.
     If it keeps failing, the agent's owner can switch it to another provider."

   The word "outage" in the degraded case is what AC-3 and AC-4 check.
   Times: on Slack a `<!date^…>` token, which Slack shows in the reader's time zone (see `SLACK.time` in `outage-alerts/domain/messages.ts`); on Telegram a `tg://time` entity, as `telegramResetTime` in `spend-hold-copy.ts` does.
   Escape the provider name for Slack mrkdwn as `messages.ts` does.

4. **Inject the outage lookup into both workers.**
   Add one optional dependency to the Slack worker (`createSlackWorker`) and the Telegram worker (`createTelegramWorker`), for example `providerOutage: (agentId) => Promise<{ templateId: string | null; status: ProviderStatusView } | null>`, with a default that returns `null`, so existing unit tests that build the workers compile unchanged.
   `null` or a failed lookup gives the "no outage known" copy with "The model provider"; it never fails the reply.
   In `packages/api-server/src/bootstrap.ts`, build it from `providerStatus.service.view()` and the turn's template: `channelFirePair(agentId, "channel")`, then `grantedTemplates.templateOf(agentId, pair.provider)`, the resolution that `fireTemplate` in the `composeOutageAlerts` call already does.
   Extract that resolution into one local function in `bootstrap.ts` that both use, and create `grantedTemplates` before the workers.
   Pick the condition as the UI's `useOutageFor` does: `damSide` set → platform side; the template in `outages` → degraded with its `since` and `statusPageUrl`; otherwise no outage.

5. **Reply in Slack.**
   In `packages/api-server/src/modules/channels/infrastructure/slack.ts`, `postFailure` resolves the copy for a `provider-unavailable` failure through the new dependency, then posts it with `postNotice` as today, files suffix included.
   Whispers stay ephemeral, because `postNotice` already handles them.
   The ambient path (`slack.ambient_turn.failed`) posts nothing, as today; it only needs the template for the event (step 7).

6. **Reply in Telegram.**
   In `packages/api-server/src/modules/channels/infrastructure/telegram.ts`, the `catch` around the turn resolves the same copy for a `provider-unavailable` failure and posts it with `thread.post` on an addressed turn; an ambient turn posts nothing, as today.

7. **Name the template on the event.**
   Add an optional `templateId?: string` to `ChannelTurnRelayed` in `packages/api-server/src/events.ts`.
   Both workers set it on a failed turn with the reason `provider-unavailable`, addressed and ambient alike, when the lookup resolved a template.
   Check the consumers of `ChannelTurnRelayed` (usage tracking, audit) accept the new reason token; it is low-cardinality like the others.

8. **Docs.**
   - `docs/architecture/channel-turns.md`: in the paragraph "An addressed turn that fails is answered in plain language keyed to what happened", say that a provider outage is answered by naming the provider and its outage, from Provider Status; add `provider-unavailable` where the failure reasons of the turn event are listed.
   - `docs/architecture/provider-status.md`: under **Screens**, add a short **Slack and Telegram** paragraph: the reply of a failed addressed turn, its three cases, the channel default's provider, and that Pi gets none (leave that out if [#5929](https://github.com/dam-agents/dam/issues/5929) has landed).
   - Update `Last verified:` on both pages.

## Acceptance criteria

- [ ] A failed addressed Slack turn whose error says the provider is down replies with the copy of the matching condition, never with "Something went wrong".
- [ ] The same holds for a Telegram turn.
- [ ] An ambient turn posts nothing on failure, as before.
- [ ] Every other failure (wake, stall, stopped Agent, no default model, other ACP errors) keeps its current copy.
- [ ] A failed lookup of the template or the status gives the "no outage known" copy and does not fail the reply.
- [ ] `ChannelTurnRelayed` carries `reason: "provider-unavailable"` and `templateId` for such a failure, addressed and ambient.
- [ ] The web chat still shows its failed-turn card for the same errors (the shared pattern did not change behavior).
- [ ] `mise run check` and `mise run test` pass; `mise run check:comment-types` passes.

## Smoke test

Run `mise run test` for the api-server and UI suites (`turn-failure-copy`, the Slack and Telegram worker tests, the UI `errors` tests), then `mise run check`.

Then on the local dev cluster ([`cluster-ops`](../../../.agents/skills/cluster-ops/SKILL.md)), with an Agent on Anthropic bound to a Slack channel:

1. Wake the Agent, then block Anthropic's API address in the cluster VM as the README's whole-feature smoke test describes, and delete the Agent's gateway pod.
2. Wait until the banner names an Anthropic outage.
3. Mention the Agent in its channel.
   Within five minutes, the thread gets "Anthropic has had an outage since …", with the status link.
4. Remove the rule.

Print a short manual guide for the user: the same steps, plus the Telegram variant if a bot is configured, and what the reply says in each of the three cases.
