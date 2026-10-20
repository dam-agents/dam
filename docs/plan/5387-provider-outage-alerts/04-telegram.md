# 04 — Telegram alert in the owner's private chat

**Depends on:** 01-slack-alert
**Part of:** Owners hear when a provider outage hits their unattended agents — see [README](./README.md)

## Context

Slice 01 sends the outage alert only as a Slack DM.
Many Telegram users talk to their agent in their own private chat with the platform's bot.
Telegram has no link from a person to a platform user, but a private chat that a person bound to one of their own agents is a chat with that person.
This slice sends the outage and recovery messages also to each such chat, with times in UTC (D2).
It never sends to a group chat or a business chat: a business chat is one-to-one with a customer of the business, not with the owner.

## Implementation plan

Apply `/typescript-engineering`.
The texts are in [README — Wording](./README.md#wording).

1. **Which chats.** In `packages/api-server/src/modules/agents/domain/telegram-conversation.ts`, add `isTelegramPrivateChat(conversationId)`: true for a one-to-one chat (`isTelegramDirectConversation`) that is not a business chat (`telegram:biz:…`).
   Export it from `modules/agents/index.ts`, next to `telegramChatOf`.
2. **The query.** In `packages/api-server/src/modules/channels/infrastructure/telegram-conversations-repository.ts`, add `listConversationsAuthorizedBy(db)`: the `conversation_id` and `agent_id` of the rows whose `authorized_by` is the given Keycloak sub.
   The binding flow requires the binder to be the agent's owner, so these are the owner's own bindings.
   The table is small; no index.
3. **The worker.** In `modules/channels/infrastructure/telegram.ts`:
   - add `listAuthorizedBy` to the worker's `conversations` deps, and wire it in `bootstrap.ts` next to `listByAgent`;
   - add `notifyPerson(keycloakSub, text): Promise<{ sent: number }>` to `TelegramWorker`: for each listed chat that `isTelegramPrivateChat` accepts, call `postMessage(agentId, text, { conversationId })`, and count the sends that succeed;
   - log a failed send and continue; return `{ sent: 0 }` when the bot does not run.
4. **The channel manager.** In `modules/channels/services/channel-manager.ts`, `notifyPerson` takes a notice `{ slack: string; telegram?: string }`:
   - the Slack worker gets `notice.slack`, as before;
   - the Telegram worker gets `notice.telegram`, only when the caller gives one;
   - the result is the sum of both `sent` counts.
     Update the RPC argument schema of `notifyPerson`, so a follower sends the notice to the leader.
     Resource alerts pass `{ slack: text }` and stay Slack-only (O10).
5. **The texts.** In the `outage-alerts` module, `domain/messages.ts` returns `{ slack, telegram }` for the outage and the recovery message.
   The Telegram text is the Slack text with times in UTC (for example "20 Oct 10:02 UTC"), plain text, with no Slack date tokens.
   The module's `notify` port takes the notice, and `bootstrap.ts` passes it to `channelManager.notifyPerson`.
6. **Docs:**
   - `docs/architecture/channels.md`, Telegram section: the platform can message an owner in a private chat that the owner bound to one of their own agents, never in a group or a business chat; a reply there is a turn of the bound agent.
     The "Identity model" bullet stays true: there is still no per-person link.
   - `docs/architecture/provider-status.md`, section "Outage alerts": the Telegram delivery and its times in UTC.
   - Bump `Last verified:` on both pages; run `mise run fix:markdown`.

## Acceptance criteria

- [ ] `mise run check` and `mise run //packages/api-server:test` pass; `mise run check:comment-types` passes.
- [ ] An outage alert goes to each private chat that the owner bound to one of their agents, and to no group or business chat.
- [ ] The Telegram text shows times in UTC and has no Slack date token.
- [ ] Resource alerts still go only to Slack.
- [ ] An owner with no Slack link and no bound private chat gets no message, and the service logs it, as before.
- [ ] A follower replica's `notifyPerson` reaches the leader with the new notice shape.

## Smoke test

On the dev cluster (Telegram is configured there through `values-dev.yaml`), with the api-server image rebuilt and the chart redeployed with `apiServer.outageAlertDelay: "2m"`:

1. Petr binds agent A to his private chat with the dev bot (`/bind` in that chat).
   He also binds a test group to agent B.
2. Run steps 2–4 of slice 01's smoke test with agents A and B.
3. After the delay, the outage message arrives in the private chat, with times in UTC; the group gets nothing.
   The Slack DM arrives as before.
4. After the recovery, the recovery message arrives in the private chat.

Print a short guide so Petr can repeat the steps by hand.
