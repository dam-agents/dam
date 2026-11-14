# 04 — DAM prices IBM calls from the list

**Depends on:** 01-meter-reply-facts, 03-read-and-keep-ibm-prices
**Part of:** IBM LiteLLM calls priced from LiteLLM's own model info — see [README](./README.md)

## Context

With the IBM list in Postgres (03) and the model group and reply cost in each record (01), DAM can price every IBM LiteLLM call exactly.
This slice switches the IBM lookup to the new order: operator price, IBM list, LiteLLM's reply cost, then $0 "awaiting price".
It drops the family estimate for IBM, which charged up to 131x for an unpriced model and $0 for a model with a similar name to a free one.
A call that names a model missing from the list starts a read of its Connection, without waiting for it.
Each call row records where its price came from, the chart stops shipping IBM prices, and the Usage copy stops promising that an estimate is high.

## Implementation plan

1. **Price book copy per replica** — `spend/domain/prices.ts` and `spend/compose.ts`:
   - `PriceBook` gains `lists`, the IBM list rows by provider (`PricedModel` plus `freeSearchQuota`).
   - `composeSpendSystem` builds the book from the operator prices, the Anthropic table and the list rows read from Postgres, then reloads the rows every 60 seconds and right after this replica's reader writes.
     The ingest reads the current book on each record, so `measureCall` stays synchronous.
2. **Lookup** — `spend/domain/prices.ts`, `lookupPrice`:
   - `PriceQuery` gains `modelGroup`, `replyCostMicros` (from `proxyCostDollars`, rounded up) and `webSearches`.
   - For `ibm-litellm`, the names to match are the model group, then the reply model; operator rows and list rows match exact before loose (today's `matchModel`).
   - Order for `ibm-litellm`: operator price (`override`), the RITS rule (`provider-rule`), the list (`list`), the reply cost (`reply`), then awaiting (`awaiting`, cost 0).
   - A list row with `freeSearchQuota`, on a call with web searches and a reply cost, takes the reply cost (`reply`).
   - The family and all-model estimate (`highestPrices`) no longer applies to `ibm-litellm`; other providers keep it.
   - Add `CallPrice` kinds for the reply cost and for awaiting, and the `PriceSource` values of the README's contract; `callCostMicros` in `cost.ts` handles the new kinds.
3. **Measure** — `spend/domain/call.ts`, `measureCall`:
   - An awaiting call has the estimate reason `awaiting-price`, cost 0, and does not take the reference cost.
   - A replay (01) gets the price source `replay`.
   - The measure returns the price source and the name that the lookup used (`priceModel`: the model group, else the reply model).
4. **Read on a missing model** — the ingest calls the reader's `requestRead(connectionId)` (03's `readOne`) when the source is `awaiting`.
   It does not wait: one read at a time per Connection, at most once in 5 minutes per Connection, in memory on the replica.
5. **Call rows** — `packages/db/src/schema.ts` adds `price_source` and `price_model` (both `text not null default ''`) and `estimate_reasons` (`text[] not null default '{}'`) to `spend_calls`, then `mise run //packages/db:generate`.
   `SettledCall` and `ledger.putCall` (`spend/infrastructure/spend-ledger.ts`) write them; the unrecorded-call sweep writes `estimate` and its own reasons.
   Slice 05 needs the reasons to tell whether a re-priced call is still an estimate for another reason, such as a cut stream.
   Add an index on `(price_source, price_model)` where `price_source = 'awaiting'`, for slice 05.
6. **Counter** — `platform.spend.awaiting_price` (`provider`, `model`) in `spend/infrastructure/price-metrics.ts`, plus one `spend.call_awaiting_price` log line with the Connection, the model and the call id.
7. **Chart** — `helm/values.yaml`, `apiServer.spend.priceOverrides`: remove the 18 IBM LiteLLM rows and leave the key empty, with a comment that it holds corrections and prices for providers with no price route.
   Check `helm/values-*.yaml` and the chart's template for the variable, so the empty list renders.
8. **Usage copy** — `packages/ui/src/modules/spend/lib/copy.ts`: `highEstimates` (the limit card) and `estimatedCallsNote` (Usage) say "estimates" and drop "high" and "likely lower", for example "N calls in these totals are estimates."
   Apply `/react-ui-engineering`; the layout does not change.
   Check `.quality-inspector/qi-profile-dam/` for a journey that quotes the old text.
9. **Docs** — `docs/architecture/spend-limits.md`:
   - **Prices › Where a price comes from:** rewrite the source list for IBM LiteLLM; remove "IBM LiteLLM's own cost figure is real only on replies that are not streamed", the temporary management key, and "so DAM never counts low" for IBM.
   - **Estimates:** add the awaiting-price rule.
   - **Ledger › Call rows:** the price source and the name the lookup used.

Apply `/typescript-engineering` to the api-server.

## Acceptance criteria

- [ ] An IBM LiteLLM call to a model in the list costs the list price, with `price_source = 'list'`, and is not estimated.
- [ ] An IBM call whose reply model drops the provider prefix (`gpt-5.5`) is priced by its model group (`azure/gpt-5.5`).
- [ ] An IBM call to a model not in the list, with no reply cost, costs $0, is estimated with `price_source = 'awaiting'`, and starts one read of its Connection.
- [ ] An IBM call to a model not in the list that has a reply cost costs the reply cost, with `price_source = 'reply'`.
- [ ] No IBM call takes a family or all-model estimate; calls to other providers price as before.
- [ ] A Gemini call with web searches takes the reply cost when it has one.
- [ ] The chart ships no IBM LiteLLM rows, and an operator price for an IBM model still wins.
- [ ] The limit card and Usage say "estimates" without "high" or "likely lower".
- [ ] `mise run //packages/db:check`, `mise run //packages/api-server:check`, `mise run //packages/api-server:test`, `mise run //packages/ui:check` and `mise run //packages/ui:test` pass.

## Smoke test

With the IBM VPN on and the branch on the local cluster:

1. Run a Claude Code turn on `aws/claude-haiku-5-5` and a Pi turn on `azure/gpt-6-luna`; every call row has `price_source = 'list'` and a cost equal to LiteLLM's for the non-streamed calls.
2. Delete `aws/claude-haiku-5-5` from `provider_model_prices`, wait 60 seconds, and run a Claude Code turn on Opus, whose background calls go to Haiku 5.5.
   The Haiku stream calls have `price_source = 'awaiting'` and cost 0, `spend.call_awaiting_price` is logged, and the list has the Haiku row again within seconds.
3. Open Usage on an agent with estimated calls, and the agent's limit card: both use the new wording; take a screenshot for the PR.

Then print a short manual guide for the user to repeat the three steps.
