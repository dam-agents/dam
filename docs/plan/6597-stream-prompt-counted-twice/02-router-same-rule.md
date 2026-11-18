# 02 — The Model Router counts the same way

**Depends on:** 01-meter-last-event
**Part of:** A Messages stream counts the prompt twice — see [README](./README.md)

## Context

The Model Router writes a call record for every model call, with the token counts it reads off the reply.
Those records feed the token metrics and the session timeline.
It merges `message_start` and `message_delta` with "the larger value wins", so it counts the prompt two times in the same streams as the meter.
This slice applies rule D (README) in the router, so its record matches the meter's record of the same call.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **`createUsageScanner` in `packages/agent-runtime/src/modules/model-router/domain/usage.ts`.**
   In the `anthropic-messages` case:
   - A `message_start` event merges its `message.usage` as today.
   - A `message_delta` event replaces each count that its top-level `usage` sends as a number, and keeps the others.
     `messagesUsage` already drops a count that is not a number, so `{ ...(partial ?? {}), ...messagesUsage(raw) }` gives this result.

   The scanner reads whole events with `JSON.parse`, so it knows the event type and the depth of `usage` without extra state.
   Keep `mergeUsage` only if another caller still uses it; otherwise remove it.

2. **The Bedrock invoke stream** (`domain/bedrock.ts`) feeds each decoded event to `createUsageScanner("anthropic-messages")`, so step 1 covers it.
   Make no change there.
   Bedrock's `message_delta` leaves the input counts out, so they keep their `message_start` values.

3. **Comments.**
   The `UNIT_BOUNDARY_DESCRIPTION` above `messagesUsage` says that "the larger of the two reports stands".
   Change it to rule D: the counts that `message_delta` sends as numbers replace those of `message_start`, and a missing or `null` count keeps its value.
   Follow [comment-guidelines](../../guidelines/comment-guidelines.md), and run `mise run check:comment-types`.

4. **The existing test** "merges Messages' start and delta usage" in `packages/agent-runtime/src/__tests__/unit/model-router-usage.test.ts` sends `cache_read_input_tokens: 0` in `message_delta`.
   With rule D, `0` replaces 300, so change the expected `cacheReadTokens` to `0`.
   Change its two `TEST_SCENARIO` comments to say that `null` keeps the start's count and a number replaces it.
   Add no other test.

5. **Docs.**
   In [harness-config.md](../../architecture/harness-config.md#the-model-router), the sentence "Each call is reported once on the telemetry rail with its tokens…" gets a short addition: the router reads a stream's counts by the meter's rule ([spend-limits](../../architecture/spend-limits.md#ledger)), so its counts match the meter's.
   Update `Last verified:` and run `mise run fix:markdown`.

## Acceptance criteria

- [ ] For a Messages stream, the router's call record has the counts that `message_delta` sends as numbers, also when they are lower than those of `message_start`.
- [ ] A count that `message_delta` leaves out or sends as `null` keeps the value from `message_start`.
- [ ] A Bedrock invoke stream follows the same rule.
- [ ] Chat Completions and Responses streams, and unstreamed replies, count as before.
- [ ] A stream cut before its usage event still has no usage, and `completed` still turns true on `message_delta`.
- [ ] `mise run //packages/agent-runtime:test` and `mise run //packages/agent-runtime:check` pass.

## Smoke test

1. Run `mise run //packages/agent-runtime:test` and `mise run //packages/agent-runtime:check`.
2. Bring the branch up with the `cluster-ops` skill on an agent image with the Model Router.
3. Run steps 2–6 of the README's whole-feature smoke test, and also open the agent's token metrics for the same time window.
   The streamed call and the call without a stream add the same input and cache-read tokens there, within 5%.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
