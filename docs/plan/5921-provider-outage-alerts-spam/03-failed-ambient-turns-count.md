# 03 — Failed ambient turns count too

**Depends on:** [01-channel-replies-name-the-outage](./01-channel-replies-name-the-outage.md), [02-owners-hear-only-about-failed-runs](./02-owners-hear-only-about-failed-runs.md)
**Part of:** Outage messages only where work failed — see [README](./README.md)

## Context

An ambient turn reads along in a channel and posts nothing when it fails, so nobody sees the failure.
Slice 01 marks such a failure with the reason `provider-unavailable` and the template on `ChannelTurnRelayed`; slice 02 built the failed-work store and the rule that tells an owner once.
This slice feeds ambient failures into that store, so the owner of an Agent whose ambient turn failed in an outage gets the same one message.
A failed call in a channel Session does not count by itself, because addressed and ambient turns can share one Session, and an addressed turn already got its reply.

## Implementation plan

Apply `/typescript-engineering` to the api-server changes and `/react-ui-engineering` to the card copy.

1. **Add the entry kind.**
   In `packages/api-server/src/modules/outage-alerts/infrastructure/redis-failed-work.ts`, add `{ kind: "ambient", agentId, channel: "slack" | "telegram" }` to the entry union.
2. **Record ambient failures.**
   A saga in `packages/api-server/src/modules/outage-alerts/sagas/` (the slice 02 recording saga, or one beside it) subscribes to `ChannelTurnRelayed`.
   For `ambient: true`, `outcome: "failed"`, `reason: "provider-unavailable"` and a `templateId`, it records an `ambient` entry at the event's time.
   The event is emitted on the channel leader only; the store is in Redis, so the evaluate run on any replica reads it.
3. **Count them.**
   In `affectedOwners` in `packages/api-server/src/modules/outage-alerts/services/outage-alerts-service.ts`, an `ambient` entry gives its `agentId` the reason of its channel (`slack` or `telegram`) without a directory lookup.
   An Agent with both a failed scheduled run and a failed ambient turn lists both reasons once each.
4. **Copy.**
   - `packages/api-server/src/modules/outage-alerts/domain/messages.ts`: the labels for `slack` and `telegram` say that an ambient turn failed, in the UI's words, for example "Slack turn in Ambient mode failed" and "Telegram turn in Ambient mode failed".
   - `packages/ui/src/modules/home/lib/outage-alert-copy.ts`: the same labels, capitalized as the card's other labels.
5. **Docs.**
   - `docs/architecture/provider-status.md`, section **Outage alerts**: an ambient turn that fails because the provider is down counts as failed unattended work, recorded from the turn event; an addressed turn does not, because its reply names the outage.
   - `docs/architecture/channel-turns.md`: where ambient turns "post nothing on failure", add that a provider outage failure still reaches the Agent's owner through outage alerts.
   - Update `Last verified:` on both pages.

## Acceptance criteria

- [ ] An ambient Slack or Telegram turn that fails with `provider-unavailable`, in an outage past the delay, tells the owner once, naming the Agent with the channel's label.
- [ ] A failed addressed turn tells the owner nothing.
- [ ] An ambient failure with another reason tells nobody.
- [ ] An owner already told about the template gets no new message; the card adds the Agent.
- [ ] `mise run check` and `mise run test` pass; `mise run check:comment-types` passes.

## Smoke test

Run `mise run test` for the api-server (`outage-alerts` tests) and the UI (`outage-alert-copy`), then `mise run check`.

Then on the local dev cluster ([`cluster-ops`](../../../.agents/skills/cluster-ops/SKILL.md)), with `apiServer.outageAlertDelay` at `2m` and an Agent on Anthropic bound to a Slack channel with Ambient mode on:

1. Wake the Agent, block Anthropic's API address in the cluster VM as the README describes, and delete its gateway pod.
2. Post a plain message in the channel, without a mention.
3. Once the delay has passed, the owner gets one Slack direct message that names the Agent with the Slack label, and the card shows it.
4. Mention the Agent in the same channel: the thread gets the outage reply from slice 01, and the owner gets no new message.
5. Remove the rule.

Print a short manual guide for the user with the same steps.
