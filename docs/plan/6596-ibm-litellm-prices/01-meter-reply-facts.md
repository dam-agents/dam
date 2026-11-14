# 01 — The meter reads LiteLLM's reply facts

**Part of:** IBM LiteLLM calls priced from LiteLLM's own model info — see [README](./README.md)

## Context

The gateway meter reads each reply's usage and LiteLLM's four cost headers, but four facts that LiteLLM puts in a reply never reach the api-server.
LiteLLM's own cost in a chat stream sits in the last chunk's `usage.cost`, not in a header.
Chat Completions replies report cache writes as `prompt_tokens_details.cache_creation_tokens`, which the meter does not map, so DAM prices those tokens as uncached input (LiteLLM charges 1.25x input for them).
The `x-litellm-model-group` header names the exact model group, also when the body's `model` drops the provider prefix (`gpt-5.5` for `azure/gpt-5.5`).
The `x-litellm-cache-key` header marks a response-cache replay, which LiteLLM charges $0 and DAM charges as a new call.
This slice carries all four into the call record, and prices a replay at $0.

## Implementation plan

1. **Lua meter** — `packages/controller/pkg/reconciler/envoy_spend_meter.go`, `luaSpendMeterBody`:
   - In `FIELDS`, map `cache_creation_tokens` to `cache_write_tokens`.
     A Chat Completions usage object also carries `cache_write_tokens` with the same value; the highest value wins, so the two keys agree.
     Check that no Anthropic usage object uses `cache_creation_tokens` with another meaning (Anthropic's keys are `cache_creation_input_tokens` and the nested `cache_creation` object).
   - In `FIELDS`, map `cost` to a new field, `proxy_cost`.
     `counts_in` already reads decimals and exponents; in `add` mode (several passes of one call) the costs add up, which is what LiteLLM bills.
   - Add `x-litellm-model-group` and `x-litellm-cache-key` to `additional_response_headers_to_log`, beside the four `proxyCost*Header` constants.
2. **Record parser** — `packages/api-server/src/modules/spend/infrastructure/spend-metadata.ts`: read `proxy_cost` as a decimal string or number.
   It is a dollar amount, not a token count, so do not route it through the integer `amount()` reader.
3. **Access log** — `packages/api-server/src/apps/ext-authz/spend-records.ts`, `callRecordOf`:
   - Set `proxyCost.body` from the metadata's `proxy_cost`.
   - Set `modelGroup` from `x-litellm-model-group` when it is at most 256 printable ASCII characters, else `null`.
   - Set `replay` to true when `x-litellm-cache-key` is present and not empty.
4. **Domain** — `packages/api-server/src/modules/spend/domain/cost.ts` and `domain/call.ts`:
   - Add `body: string | null` to `ProxyCostHeaders`.
     `proxyCostDollars` keeps the header rule first and falls back to `body` when the headers give no positive cost.
   - Add `modelGroup` and `replay` to `CallRecord`.
   - In `measureCall`, a `replay` call costs 0 and is not estimated; keep its token counts.
     Put the replay rule before the price lookup, so that no estimate reason applies to it.
5. **Debug log** — add `modelGroup` and `replay` to the `spend.call_recorded` debug line in `services/spend-ingest.ts`, so the smoke test can see them before slice 04 uses them.
6. **Every other `CallRecord` builder** (the unrecorded-call sweep in `spend-ingest.ts`, test fixtures) sets `modelGroup: null`, `replay: false` and `body: null`.
7. **Docs** — `docs/architecture/spend-limits.md`:
   - **Meter › On the reply:** the raw counts include the Chat Completions cache writes, and the meter also keeps LiteLLM's cost from a chat stream's usage.
   - **Meter › The record:** the record carries the reply's model group and whether LiteLLM served it from its response cache.
   - **Prices:** a response-cache replay costs nothing, as at LiteLLM.

Apply `/typescript-engineering` to the api-server changes.

## Acceptance criteria

- [ ] A Chat Completions call on IBM LiteLLM that writes the prompt cache records those tokens as cache writes, not as uncached input.
- [ ] A chat stream with `stream_options.include_usage` on IBM LiteLLM carries LiteLLM's `usage.cost` in its call record.
- [ ] Every IBM LiteLLM call record carries the reply's `x-litellm-model-group`.
- [ ] A reply with `x-litellm-cache-key` costs $0 and is not estimated.
- [ ] Calls to other providers record the same counts and cost as before.
- [ ] `mise run //packages/controller:check`, `mise run //packages/api-server:check` and `mise run //packages/api-server:test` pass.

## Smoke test

With the IBM VPN on and the branch installed on the local cluster (`cluster-ops` skill), on an agent with an IBM LiteLLM Connection:

1. From inside the agent, send one Chat Completions request to `azure/gpt-5.6-luna` with a prompt over 1,024 tokens, twice, so that the second call reads the cache and the first writes it.
   In `spend_calls`, the first call has its write tokens in a cache-write column and fewer uncached input tokens than the prompt.
2. Send the same request streamed, with `stream_options.include_usage: true`.
   The api-server's `spend.call_recorded` debug line shows the model group, and the record's proxy cost equals the `usage.cost` of the last chunk.
3. Send one identical non-streamed request twice with LiteLLM's response cache enabled for the request (`"cache": {"no-cache": false}` or the proxy's own setting).
   If the second reply has `x-litellm-cache-key`, its `spend_calls` row has cost 0 and `estimated = false`.

Then print a short manual guide for the user to repeat steps 1–3.
