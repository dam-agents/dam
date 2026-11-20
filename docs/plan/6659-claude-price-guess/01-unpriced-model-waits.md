# 01 — A call to an unpriced model waits for its price

**Part of:** No price guess for models newer than DAM's price list — see [README](./README.md)

## Context

This slice removes the family guess for new calls.
A call that names a model with no price, on a provider that DAM prices (the Anthropic table or operator prices), counts $0 and is marked `awaiting-price`, the same way IBM LiteLLM calls wait since #6596.
Each api-server start then prices the waiting calls of these providers again, because their prices change only with a deploy.
It covers AC-1 and AC-2.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **Price lookup** — `packages/api-server/src/modules/spend/domain/prices.ts`:
   - In `lookupPrice`, after the Anthropic table lookup, keep `if (known.length === 0) return { kind: "unpriced", source: "unpriced" };` and replace the guess with `return { kind: "awaiting", source: "awaiting" };`.
   - Delete `modelFamily` and `highestPrices`; they have no other caller.
   - Remove `"estimate"` from the `source` union of the `kind: "row"` variant of `CallPrice`.
     Keep `"estimate"` in `PriceSource` (the stored column): `call.ts` still writes it for a call without usage whose price would wait.
   - Add an exported function that names the deploy-priced providers of a book: the Anthropic table providers (`ANTHROPIC_TABLE_PROVIDERS`) plus every provider of `book.operatorPrices`, without `LISTED_PROVIDERS`.
   - Rewrite the `UNIT_BOUNDARY_DESCRIPTION` of `lookupPrice`: no provider takes an estimate from similar models any more; a provider that has a price source but no price for this model makes the call wait; a provider with no price source is unpriced.
2. **Estimate reasons** — `packages/api-server/src/modules/spend/domain/call.ts`:
   - Remove the `[price.source === "estimate", "model-unpriced"]` entry; the lookup no longer returns it.
   - Keep `"model-unpriced"` in the `EstimateReason` union: old rows carry it, and slice 02 reads it.
   - `awaiting` is already `reported && price.source === "awaiting"`, so a call without usage still goes to the payer's most expensive call (`needsReferenceCost`), as for IBM.
3. **No price read for non-IBM calls** — `packages/api-server/src/modules/spend/services/spend-ingest.ts`, around `deps.prices.requestRead(record.connectionId)`:
   call `requestRead` only when `LISTED_PROVIDERS` includes `measure.provider`.
   The `spend.call_awaiting_price` log line and the `platform.spend.awaiting_price` counter stay for every provider.
4. **Price waiting calls again at start** — `packages/api-server/src/modules/spend/compose.ts` and `packages/api-server/src/bootstrap.ts`:
   - Add a method to `SpendSystem`, for example `repriceDeployPriced(): Promise<void>`, that runs `repricer.repriceAwaiting(provider)` for each deploy-priced provider of `priceBook.current()`.
     The repricer needs no change: for a provider outside `LISTED_PROVIDERS`, `lookupPrice` ignores `modelGroup` and matches the row's `model`.
   - In `bootstrap.ts`, next to `void spend.readPricesIfEmpty()`, start it the same way: not awaited, with a `.catch` that logs `spend.start_reprice_failed` with `formatError`.
     Every replica runs it; the repricer's `price_source` guard keeps one call from being priced twice.
5. **Architecture doc** — `docs/architecture/spend-limits.md`:
   - **Prices**, the list "Any other provider's call is priced in this order": replace the bullet "An estimate for a model with no price…" with a waiting bullet: a model that none of these prices costs nothing and is marked estimated until a deploy brings its price ([Estimates](#estimates)).
     Keep the sentence about OpenAI and Bedrock without operator prices.
     Generalize "No IBM call takes an estimate from a similar model…" so it covers every provider.
   - **When a cost is fixed**: add that a waiting call of a provider priced by the Anthropic table or by operator prices is priced again at each api-server start, because these prices change only with a deploy.
   - **Estimates**: "It counts high, except for…" must also except every waiting call.
     Split the bullet "An IBM LiteLLM call that waits for its price" into what all waiting calls share (reason `awaiting-price`, log line, counter, a limit does not see the call until its price arrives) and what only IBM LiteLLM does (the immediate read of the Connection).
     Add the fast fix: an operator price in the chart prices a new model at once, and the restart prices its waiting calls again.
   - Update `Last verified:`.
6. Run `mise run check:comment-types`, `mise run //packages/api-server:check` and `mise run //packages/api-server:test`.
   If an existing test expects the guess (a cost from a family's highest price, or the reason `model-unpriced` on a new call), change its expectation to the waiting call and say so in the commit body.

## Acceptance criteria

- [ ] `prices.ts` has no `modelFamily`, no `highestPrices` and no `source: "estimate"` row result; `git grep -n "highestPrices\|modelFamily" packages/api-server/src` prints nothing.
- [ ] A call on `anthropic` or `anthropic-oauth` with usage, to a model that neither the Anthropic table nor an operator price has, is stored with cost 0, `price_source = 'awaiting'`, `estimated = true` and the reason `awaiting-price`.
- [ ] A call on OpenAI or Bedrock without any operator price is still `unpriced`: cost 0, not marked.
- [ ] An awaiting call on a non-IBM provider never calls `requestRead`.
- [ ] Each api-server start prices again the waiting calls of the deploy-priced providers whose model now has a price, and logs `spend.repriced` with kind `awaiting`.
- [ ] `spend-limits.md` describes the new order, the start-up re-price and the operator price as the fast fix, with no mention of a family estimate.
- [ ] `mise run check:comment-types`, `mise run //packages/api-server:check` and `mise run //packages/api-server:test` pass.

## Smoke test

On the local cluster (the [`cluster-ops`](../../../.agents/skills/cluster-ops/SKILL.md) skill), with a throwaway agent that holds the Anthropic subscription Connection:

1. Build and deploy this branch's api-server with the `claude-haiku-5-5` row removed from `packages/api-server/src/modules/spend/infrastructure/model-prices.json` (a local edit; restore it before the commit).
2. Run a short Claude Code session on an Opus or Sonnet model.
   Claude Code's background calls use `claude-haiku-5-5`.
3. Check: the api-server log has `spend.call_awaiting_price` lines with provider `anthropic-oauth` and model `claude-haiku-5-5`, and no `spend.requested_price_read_failed`.
   In Postgres, those rows have cost 0, `price_source = 'awaiting'` and the reason `awaiting-price`.
   The agent's Usage view shows the calls as estimates.
4. Add an operator price for `anthropic-oauth` / `claude-haiku-5-5` with `--helm-values=` (list prices from the restored row), and let the api-server restart.
   Check: `spend.repriced` with kind `awaiting` names those calls, the rows now carry `price_source = 'override'` and a non-zero cost, and the Usage view shows the cost.
5. Remove the operator price, restore the row, and redeploy the clean build.

Then print a short manual guide for Petr with steps 2–4.
