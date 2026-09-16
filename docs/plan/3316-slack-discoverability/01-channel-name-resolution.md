# 01 — Slack channel name resolution

**Part of:** UI — Slack integration discoverability — see [README](./README.md)

## Context

Three later slices need to show a Slack channel by name, and none can. A binding carries only
`slackChannelId`; a session carries no channel field at all. Both already hold the id — the
binding directly, the session encoded in `threadTs` — and both lack the name. This slice solves
that once, server-side, so 04, 05 and 06 each become a display change.

Telegram needs nothing here: it captures the chat title at bind time and `useTelegramChats`
already returns it.

No UI. Apply the `/typescript-engineering` skill.

## Why resolve on read rather than persist at bind

A name captured at bind goes stale the moment someone renames the channel, and a confidently
wrong name is worse than a slightly slower one. Slack's own clients resolve names live for the
same reason. Resolution is cheap (`conversations.info`, or the already-paginated
`users.conversations` list) and a short-lived cache keeps it off the hot path. Persisting would
also need a rename webhook to stay honest, which is more machinery than the problem deserves.

## Implementation plan

1. **Extend the gateway.** `getConversationInfo` in
   [`bolt-slack-gateway.ts`](../../../packages/api-server/src/modules/channels/infrastructure/bolt-slack-gateway.ts)
   returns only `{ isMember }`. Add the channel `name` to its return shape. Mirror the change in
   `slack-gateway.ts` (the port) and `fake-slack-gateway.ts` (the test double) so every
   implementation agrees. `listConversations` already returns `{ id, name }` — no change there.

2. **Add a resolver with a cache.** A small service that maps one or many conversation ids to
   names, backed by a TTL cache (see `core/ttl-store.ts` for the existing pattern). It must:
   - return `null` for an id it cannot resolve, never throw into a list render;
   - tolerate `channel_not_found` and a revoked token by degrading to `null`;
   - batch or de-duplicate ids so one list render is not one API call per row.
   Unresolved ids fall back to the raw id at the display layer, so a failure is legible, not blank.

3. **Surface the name on the binding view.** Add an optional `name` to the Slack channel shape in
   [`agents/types.ts`](../../../packages/api-server-api/src/modules/agents/types.ts) and its Zod
   schema in [`agents/schemas.ts`](../../../packages/api-server-api/src/modules/agents/schemas.ts).
   Optional, so a resolution failure degrades rather than breaking the contract. Populate it
   wherever agent channels are read.

4. **Add a thread-key parser.** `sessions/types.ts` composes thread keys
   (`slackThreadKey`, `ambientThreadKey`) but never decomposes them. Add the inverse beside them:
   given a `threadTs`, return the channel id, handling both `<channelId>:<ts>` and
   `ambient:<channelId>`, and returning `null` for anything else. Sub-issue 06 consumes this.

5. **Session names need no backend.** Decided during implementation: sub-issue 06 joins
   client-side. The UI parses `threadTs` to a channel id and matches it against the agent's
   channels, which carry names from step 3. This mirrors the Telegram half of 06 and keeps
   `SessionView` unchanged. A session in a since-unbound channel shows no name, which 06 already
   allows.

## Acceptance criteria

- [ ] `getConversationInfo` returns the channel name alongside `isMember`, across the port, the
      Bolt implementation and the fake.
- [ ] Resolving a known channel id yields its name; an unknown or inaccessible id yields `null`
      rather than an error.
- [ ] Resolving the same id repeatedly inside the cache window makes one Slack call, not many.
- [ ] The Slack channel shape in the agents contract carries an optional `name`, and reading an
      agent's channels populates it.
- [ ] The thread-key parser returns the channel id for a `<channelId>:<ts>` key and for an
      `ambient:<channelId>` key, and `null` otherwise.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

Run the existing suites first:

```bash
mise run check && mise run test
```

Then, on the local dev cluster with a bound Slack channel, read the agent's channels over tRPC
(or `mise run cluster:kubectl` into the api-server and call the procedure) and confirm the
response carries the channel's human name next to its `C0…` id. Revoke nothing and break
nothing: re-read within a few seconds and confirm from the api-server logs that a second Slack
API call was not made.

**No new tests.** The plan sanctioned unit tests for the thread-key parser; the user declined
during implementation. The parser's edge cases were verified with a throwaway spec that was run
and deleted. Do not add tests in this slice.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
