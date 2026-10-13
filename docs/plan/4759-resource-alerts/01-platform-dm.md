# 01 — The platform can DM a person on Slack

**Part of:** Resource alerts — see [README](./README.md)

## Context

Every Slack send today belongs to an agent instance.
Alerts are the platform's own, so this slice adds one send keyed by a person.

## Implementation plan

1. `packages/db/src/schema.ts`: nullable `teamId` on `identityLinks`; `mise run //packages/db:generate` for the migration.
2. `packages/api-server/src/modules/channels/infrastructure/identity-links-repository.ts`: `upsertIdentityLink` takes an optional team id; add a read that returns `{ externalUserId, teamId }` for a sub.
   Thread the team through `identity-link-service.ts` and the OAuth callback (`slack-oauth.ts`, from `pending.teamId`).
3. `slack.ts`: `SlackWorker.notifyPerson(keycloakSub, text)` — for each link pick the workspace (its team id, else the only active install, else skip with a log line), skip a rejected credential or one without `im:write`, then `openDirectMessage` and post as the app.
   Returns `{ sent }`.
4. `services/channel-manager.ts`: `notifyPerson` in the RPC method enum, its argument and result schemas, a local handler and `ChannelManager.notifyPerson`.
5. Docs: `channels.md` (a link records its workspace; the platform can DM a linked person), `slack-guarantees.md` (platform alerts arrive as DMs from the app; replies are not handled).

Apply `/typescript-engineering`.

## Acceptance criteria

- [ ] A linked user gets exactly one DM per linked Slack identity.
- [ ] An unlinked user, or an install without Slack, returns `{ sent: 0 }` without an error.
- [ ] A call on a non-leader replica reaches the leader.
- [ ] No CRD change.

## Smoke test

`mise run //packages/db:check`, `mise run //packages/api-server:check`, `mise run //packages/api-server:test`, `mise run //docs:check`.
