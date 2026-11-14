# 02 — DAM's cost rules match LiteLLM's

**Depends on:** 01-meter-reply-facts
**Part of:** IBM LiteLLM calls priced from LiteLLM's own model info — see [README](./README.md)

## Context

DAM's cost rules copy LiteLLM's, but in two places they do not.
LiteLLM charges a cache write that has no five-minute or one-hour split at the base write price, the five-minute one (`calculate_cache_writing_cost` in LiteLLM's `llm_cost_calc/utils.py`); DAM charges it at the one-hour price, so a Claude model that reports unsplit writes costs about twice too much on them.
A LiteLLM price can have several prompt-size steps; DAM keeps only the first one it finds.
DAM also compares its cost with LiteLLM's only on calls with no cache, and only in a log line.
This slice closes the two gaps and turns the comparison into a check on every reply that carries LiteLLM's cost, with counters in ClickHouse.

## Implementation plan

1. **Unsplit cache writes** — `packages/api-server/src/modules/spend/domain/cost.ts`, `rowCostMicros`: price `cacheWriteUnsplitTokens` at `rates.cacheWrite5m`, and only `cacheWrite1hTokens` at `rates.cacheWrite1h`.
   In `domain/call.ts`, `measureCall` adds the unsplit tokens to `cacheWrite5mTokens` instead of `cacheWrite1hTokens`, so the call row and the rollup show the tokens under the price they paid.
   Slice 05 prices call rows again from these columns, so they must say which price applies.
2. **Several prompt-size steps** — `domain/prices.ts`:
   - Replace `PriceRow.threshold` with `thresholds`, a list of `{ promptTokens, prices }` sorted by `promptTokens`, and give `TierPrices` the same list in place of `aboveThreshold`.
   - In `cost.ts`, `resolveRates` uses the highest step that `promptTokens(usage)` passes, with the tier's prices for that step ahead of the step's own prices.
     Check the rule against LiteLLM's (`_get_token_base_cost` and its callers in `llm_cost_calc/utils.py` on the LiteLLM version IBM runs, 1.108.4) before writing it.
   - `infrastructure/anthropic-price-table.ts`, `priceRowFromLiteLlm`: read every `input_cost_per_token_above_<N>k_tokens` key, not only the first.
   - `infrastructure/operator-prices.ts`: the chart's `threshold` (one step) stays valid and becomes a one-step list; accept an optional `thresholds` list too, so the chart format does not break.
3. **The comparison** — `services/spend-ingest.ts`, the block after `settle` that logs `spend.proxy_cost_mismatch`:
   - Compare every final call in dollars that has a positive reply cost (`proxyCostDollars`, header or body), cached calls included, except a replay.
   - Keep `PROXY_COST_TOLERANCE` (5%), and add the cache tokens and the model group to the log line.
4. **Counters** — a new `infrastructure/price-metrics.ts` in the spend module creates OTel counters from a `Meter`:
   - `platform.spend.proxy_cost.compared` and `platform.spend.proxy_cost.differs`, with the attributes `provider` and `model` (the model group when the record has one, else the reply's model) and nothing that names a user, an agent or a Connection.
   - `composeSpendSystem` (`spend/compose.ts`) takes a `meter` and passes the counters to the ingest; `bootstrap.ts` passes `metrics.getMeter("platform-apiserver")`, as the usage metrics do (`bootstrap.ts`, the `composeUsageMetricsModule` call).
   - Slices 03 and 04 add their counters to the same file.
5. **Docs** — `docs/architecture/spend-limits.md`:
   - **Prices › How a cost is computed:** a cache write without its split counts at the five-minute price, as in LiteLLM; a price can change at several prompt sizes, and the highest one passed applies.
   - **Prices › When a cost is fixed:** DAM compares its cost with LiteLLM's on every completed reply that carries LiteLLM's cost, cache included, and logs and counts a difference above 5%.
     Remove the sentences that only cached-free calls are compared and why.

Apply `/typescript-engineering`.
Update only the existing spend tests whose expected cost changes because of the five-minute rule or the step list.

## Acceptance criteria

- [ ] A cache write without a five-minute or one-hour split costs the five-minute price, and the call row shows it as a five-minute write.
- [ ] A price with two prompt-size steps uses the higher step for a prompt above it, and the lower step for a prompt between the two.
- [ ] The chart's existing `threshold` entries still load, and the Anthropic table loads with every step.
- [ ] Every completed IBM LiteLLM reply that carries LiteLLM's cost is compared, cached calls included; a difference above 5% writes `spend.proxy_cost_mismatch`.
- [ ] The two comparison counters reach ClickHouse with only `provider` and `model` attributes.
- [ ] `mise run //packages/api-server:check` and `mise run //packages/api-server:test` pass.

## Smoke test

With the IBM VPN on and the branch on the local cluster:

1. Run a Claude Code turn on `aws/claude-sonnet-5-5` that reads and writes the cache.
   No `spend.proxy_cost_mismatch` line appears for its non-streamed calls, and the comparison counter grows (query `otel_metrics` in the bundled ClickHouse for `platform.spend.proxy_cost.compared`).
2. Send a Chat Completions request to a Claude model that reports cache writes without a split.
   Its `spend_calls` row has the writes in `cache_write_5m_tokens`, and its cost equals LiteLLM's `x-litellm-response-cost`.

Then print a short manual guide for the user to repeat both steps.
