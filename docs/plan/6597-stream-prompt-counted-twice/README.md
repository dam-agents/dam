# A Messages stream counts the prompt twice when its first event carries the whole prompt

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/6597

## Goal

A streamed call records each prompt token once.
Then a streamed call costs the same as the same call without a stream.
A spend limit stops the agent at the right time, and the token metrics show the real counts.

Today the gateway meter and the Model Router keep the highest value of each count.
Some upstreams put the whole prompt as uncached input in `message_start`, and give the real split only in `message_delta`.
CurveBender's RITS models do this today.
LiteLLM's Anthropic bridge does this when an operator turns on `litellm_settings.anthropic_messages_estimate_initial_input_tokens` (off by default since LiteLLM 1.109.0).
The prompt then counts two times: once as uncached input from `message_start`, and once as the cache read from `message_delta`.

## Approach

Read the "On the reply" paragraph of [spend-limits](../../architecture/spend-limits.md#ledger), [the Model Router](../../architecture/harness-config.md#the-model-router) and the spend part of [metrics](../../architecture/metrics.md) first.

### The stream rule (rule D)

The meter (slice 01) and the Model Router (slice 02) use this rule, so their call records match:

- A Messages stream is an Anthropic Messages event stream (`text/event-stream`), or a Bedrock invoke stream (`application/vnd.amazon.eventstream`), whose payloads are Messages events.
- In a Messages stream, each count that the top-level `usage` object of the `message_delta` event sends as a number replaces the count recorded so far.
- A count that this object leaves out, or sends as `null`, keeps the value recorded so far.
  Normally that value comes from `message_start`.
  Bedrock leaves the input counts out of `message_delta`, so this rule keeps them.
- `0` is a number, so `0` replaces.
  No known provider sends `0` to mean "no change".
- Inside one usage object the rules do not change: the meter adds the passes in `iterations`, then takes the highest value of each field in the object.
- Every other usage object keeps "the highest value wins": the `usage` in `message_start`, a JSON reply, Chat Completions and Responses streams, Bedrock Converse streams, and the Bedrock `amazon-bedrock-invocationMetrics` object.
- A stream that stops before `message_delta` keeps the counts of `message_start`.

Why only the top-level `usage` of `message_delta` may lower a count:

- In a stream, text and tool input from the model travel inside JSON strings, where quotes are escaped.
  So the model cannot form a `message_delta` event or a usage object in a stream.
- In a JSON reply, tool input is JSON structure that the model writes.
  So the model can form a usage object there, and a replace rule would let the model lower a count.
  A JSON reply keeps "the highest value wins".

Evidence from the grilling:

- On CurveBender, a streamed call to a RITS model recorded 5,451 uncached plus 5,440 cache-read tokens.
  The same call without a stream recorded 11 uncached plus 5,440 cache-read tokens.
- In a local LiteLLM 1.109.1 lab with the estimate on, "the highest value wins" counted 5.0x LiteLLM's bill for a cached streamed call and 1.4x for an uncached one.
  Rule D matched LiteLLM's bill in every test of a full stream, with the estimate on and off.

### The day's most expensive call (slice 03)

The daily rollup keeps the most expensive single call (`spend_daily.max_call_cost_micros`).
The api-server uses it to estimate a call that reports no usage (`referenceCost` → `highestCall`).
Today every record of a call can set it, a periodic record too.
With rule D, a call's final record can be lower than its periodic records, because a periodic record can carry the whole prompt from `message_start`.
So only a final record may set the most expensive call.

The rest of the api-server already handles a final record that is lower than an earlier periodic record.
The amounts difference can be negative, the ledger adds it, and the day counters move by it.

### Out of scope

- The price of each kind of token (tracked separately).
- Stopped streams, which are counted too low or too high.
  No issue is filed: it waits for PROD data on how often it occurs.

## Sub-issues

| #   | Title                                                   | Scope                                                              | Depends on |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------ | ---------- |
| 01  | The gateway meter uses the last event's counts          | Rule D in the meter's Lua; the rule in `spend-limits.md`           | —          |
| 02  | The Model Router counts the same way                    | Rule D in `createUsageScanner`; one existing test expectation      | 01         |
| 03  | Only a finished call sets the day's most expensive call | The settle fix in `spend-ingest.ts`; one line in `spend-limits.md` | —          |
| 04  | Three outdated doc lines                                | `connection-presets.md`, `harness-config.md`, `persistence.md`     | —          |

Slice 02 depends on 01 only for the rule's wording in `spend-limits.md`.
Slices 03 and 04 are independent.

## Conventions & glossary

- **Meter:** the Lua filter in each agent's gateway Envoy (`packages/controller/pkg/reconciler/envoy_spend_meter.go`).
  Spend and spend limits read its records.
- **Model Router:** the proxy in the agent runtime (`packages/agent-runtime/src/modules/model-router/`).
  Its call records feed the token metrics and the session timeline.
- **Periodic record / final record:** the gateway sends the counts of a call so far every 2 seconds, and once more when the call ends.
  Each record carries totals, not increments.
- **Rule D:** the stream rule above.
- Apply `/typescript-engineering` in slices 02 and 03.
  Slice 01 is Lua inside a Go string, so no TypeScript skill applies.
- Code comments follow [comment-guidelines](../../guidelines/comment-guidelines.md); run `mise run check:comment-types` after a code change.
- Docs follow [documentation-guidelines](../../guidelines/documentation-guidelines.md): one sentence per line (`mise run fix:markdown`), and a new `Last verified:` date on each architecture page a slice changes.
- Do not add new tests.
  Slice 02 changes the expected values of one existing test, because rule D changes the behavior that it checks.

## Whole-feature smoke test

AC-1 of the issue is the check.

1. Bring the branch up on a cluster that has the shared CurveBender Connection (the `cluster-ops` skill), or install it into an Environment.
2. Give an agent a CurveBender Connection to a RITS model.
   Ask it, in chat, to send one long prompt (several thousand words) to the model through its Connection, in Anthropic Messages format, without a stream.
   This fills the model's cache.
3. Note the agent's "Tokens in" on the Usage view.
4. Ask the agent to send the same prompt again, streamed, and note how much "Tokens in" grows.
5. Ask the agent to send the same prompt again, without a stream, and note how much "Tokens in" grows.
6. The two growths are equal within 5%.
   Before the fix, the streamed growth is about two times the other.

If no CurveBender Connection is at hand, use a LiteLLM 1.109 or later proxy with `litellm_settings.anthropic_messages_estimate_initial_input_tokens: true` as the endpoint of a custom Connection.
The streamed call then matches LiteLLM's own spend log for the call.

Also check that nothing else moved: a streamed and a non-streamed call to a Claude model on an Anthropic Connection grow "Tokens in / out" by the same amounts, as before the change.

## Delivery

Each sub-issue is one atomic commit.
The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/6597.
