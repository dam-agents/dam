# 01 — The gateway meter uses the last event's counts

**Part of:** A Messages stream counts the prompt twice — see [README](./README.md)

## Context

The gateway meter is the source of spend.
It keeps the highest value of each count, so a stream whose `message_start` carries the whole prompt as uncached input counts the prompt two times.
This slice makes the meter apply rule D (README) to Messages streams, and changes the meter's rule in `spend-limits.md`.

## Implementation plan

All code changes are in `luaSpendMeterBody` in `packages/controller/pkg/reconciler/envoy_spend_meter.go`.
Envoy runs this Lua on every chunk of the reply, so keep it streaming: no buffering of whole events.

1. **Split `merge(object)` into "read" and "apply".**
   Today `merge` calls `raise` twice: once for the sum of the `iterations` passes, once for the object's own fields.
   Make it compute the object's counts in a local table first (the iterations sum, then the highest value per field of the rest of the object, as now).
   Then apply that table to `fields` in one of two ways:
   - `raise(counts)` (as today): a count goes up only.
   - a new `replace(counts)`: each count in the table replaces the value in `fields`.
     `counts_in` matches only numbers, so a `null` count is not in the table and keeps its value.

   The text fields (`speed`, `inference_geo`) keep their current handling.

2. **Find the top-level `usage` of a `message_delta` event while the reply streams.**
   `next_object` finds usage objects by pattern, so it does not know the event that holds an object.
   A look-back from the object does not work: `scan` drops the text before an object that is cut between two chunks.
   Use the state machine that `read_shallowest_fields` already runs over every chunk.
   It tracks the JSON depth across chunks, and the last string key with its depth (`last`, `last_depth`).
   Between two events the depth is 0, so the event's own keys are at depth 1.
   Extend it:
   - When the key `type` at depth 1 gets a string value, keep that value as the current event type.
   - When the key `usage` at depth 1 is followed by `{` and the current event type is `message_delta`, keep the absolute position of that `{` in a set.
     The absolute position of `data[i]` is `base + #buf + i` when `read_shallowest_fields` runs, because `scan` calls it before it joins `buf` and `data`.
   - When the depth goes back to 0, forget the event type.

   Anthropic, LiteLLM and Bedrock send `type` before `usage` in an event.
   If an upstream sends `type` after `usage`, the event keeps "the highest value wins", which is today's behavior.

3. **Apply the rule in `scan`.**
   For each usage object, `scan` knows its `{` as `open` in `text`, and the absolute position is `base + open`.
   If that position is in the set and the meter's format is not `"json"`, apply the object's counts with `replace`; otherwise use `raise`.
   Remove the position from the set after use.
   The format check keeps rule D out of JSON replies, where the model can write a usage object in tool input.

4. **Leave the rest as it is.**
   - The Bedrock event stream (`event_stream`) feeds each decoded payload to `scan`, so step 3 covers it.
     Its `amazon-bedrock-invocationMetrics` object is not a `usage` key, so it keeps "the highest value wins".
   - `publish` sends a field again whenever its value changes, so a lower value reaches the periodic and final records.
   - A stream that stops before `message_delta` never calls `replace`, so it keeps the counts of `message_start`.

5. **Change the rule in `docs/architecture/spend-limits.md`** ("On the reply", lines 57–58).
   Replace the sentences "Text from the model sits inside JSON strings…" and "For each count the highest value wins…" with text that says:
   - In a stream, text and tool input from the model sit inside JSON strings, where quotes are escaped, so the model cannot form an event or a usage object there.
   - In a JSON reply, tool input is JSON structure that the model writes, so the model can form a usage object there.
   - For each count the highest value wins, so a repeated or forged object can only raise a count.
   - The one exception is a Messages stream (an event stream or a Bedrock invoke stream): each count that the top-level `usage` of its `message_delta` event sends as a number replaces the count so far.
     The reason: some upstreams put the whole prompt as uncached input in `message_start`, and give the real split only in `message_delta`.
   - A count that `message_delta` leaves out or sends as `null` keeps its value, and a stream that stops before `message_delta` keeps the counts of `message_start`.

   Update `Last verified:`, run `mise run fix:markdown` and `mise run //docs:check:doc-size`.

## Acceptance criteria

- [ ] In a Messages event stream, the counts that the top-level `usage` of `message_delta` sends as numbers replace the earlier counts, also when they are lower.
- [ ] A count that `message_delta` leaves out or sends as `null` keeps the value from `message_start`.
- [ ] A Bedrock invoke stream follows the same rule; its input counts from `message_start` stay, because `message_delta` leaves them out.
- [ ] A JSON reply, a Chat Completions stream, a Responses stream, a Bedrock Converse stream, and a `usage` object at any other place keep "the highest value wins".
- [ ] A usage object with `iterations` still counts the sum of its passes.
- [ ] A stream that stops before `message_delta` keeps the counts of `message_start`.
- [ ] `spend-limits.md` describes the new rule and the corrected model-text sentence.
- [ ] `mise run //packages/controller:check` and `mise run //packages/controller:test` pass.

## Smoke test

1. Run `mise run //packages/controller:check` and `mise run //packages/controller:test`.
2. Bring the branch up with the `cluster-ops` skill, so the controller writes the new Lua into each gateway.
3. On an agent with a CurveBender Connection to a RITS model, run steps 2–6 of the README's whole-feature smoke test.
   The streamed call and the call without a stream grow "Tokens in / out" by the same amounts within 5%.
4. On an agent with an Anthropic Connection, send the same short prompt once streamed and once without a stream.
   Both grow "Tokens in / out" by the same amounts, as before the change.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
