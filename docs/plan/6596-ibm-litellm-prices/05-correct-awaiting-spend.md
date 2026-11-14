# 05 — DAM corrects spend that waited for a price

**Depends on:** 04-price-ibm-calls-from-the-list
**Part of:** IBM LiteLLM calls priced from LiteLLM's own model info — see [README](./README.md)

## Context

After slice 04, an IBM call that no source could price counts $0 with `price_source = 'awaiting'`, and it starts a read of its Connection.
This slice prices such calls again once the read brings their price, so spend and limits catch up within seconds.
It also prices again, once, the IBM calls of the last 30 days that the old estimate charged, so the Usage history stops showing up to 131x LiteLLM's cost.
A call that had a real price never changes, so the rule that a fixed cost stays fixed still holds for measured calls.
A late record already corrects an estimate the same way (`spend-ingest.ts`, `settle`), and the stamped-session job already moves call rows and rollup amounts together (`ledger.bookCalls`); this slice follows both.

## Implementation plan

1. **Ledger operation** — `spend/infrastructure/spend-ledger.ts`, a new `reprice(changes)` that runs in one transaction per batch:
   - For each call, update the call row only while its `price_source` is still the one that was read (`awaiting`, or `''` for the back-fill), and return the old cost.
   - Add the cost difference, and the change in estimated calls, to the call's rollup row (day, payer, Connection, model, Session, calling agent, unit), as `add` does.
   - Recompute the rollup row's most expensive call from its call rows, because `add` can only raise it and a re-priced call is usually lower.
2. **Re-pricer** — `spend/services/reprice.ts`, which the reader (03) calls after any read that added or changed list rows:
   - Select the `awaiting` call rows of the provider whose `price_model` now has a list row, in batches of 500 (the index from 04).
   - Price each from its token columns with the list row (`callCostMicros`), at the standard tier, as the row keeps no tier.
   - Remove `awaiting-price` from the row's estimate reasons; the call stays estimated only when another reason remains, for example a cut stream.
   - After the transaction, move today's day counters by the same difference, with the helper that the ingest uses for `settle` (move that helper out of `spend-ingest.ts` into a shared function); a counter that fails to move is dropped, so the next read rebuilds it.
   - If the call's state is still in Redis (`infrastructure/call-states.ts`), update its applied cost too, so that a late duplicate record does not add the old difference again.
3. **Back-fill of old estimates** — in the same service, run after each successful hourly read:
   - Select IBM call rows of the last 30 days with `estimated = true`, `price_source = ''` (written before slice 04), a model other than `unknown`, and at least one token count above 0.
     Calls cut before any reply have no model and no tokens, so they stay as they are (#6494 part 1 owns them).
   - Match the row's `model` against the list with the lookup's name rules (exact, then loose).
   - Price it from its tokens, set `price_source = 'list'` and `price_model`, and keep `estimated` as it is, because a row from before slice 04 does not say why it was estimated.
   - The `price_source = ''` filter makes the pass repeatable: a row is re-priced once, and rows whose model is still not in the list are tried again next hour until they leave the 30-day window.
4. **Logs and counters** — `spend.repriced` per batch (calls, total difference in micro-dollars, `awaiting` or `backfill`), and `platform.spend.repriced` (`provider`, `kind`) in `price-metrics.ts`.
5. **Docs** — `docs/architecture/spend-limits.md`:
   - **Prices › When a cost is fixed:** the exception for IBM calls that waited for a price, and the back-fill of estimates from before the change.
   - **Ledger:** re-pricing moves the call row, the rollup row and today's counters together.

Apply `/typescript-engineering`.

## Acceptance criteria

- [ ] When a read adds a model, every `awaiting` call of that model gets the list price; its call row, its rollup row and today's counters move by the same amount.
- [ ] A re-priced call that had no other estimate reason is no longer estimated, and its rollup row counts one estimated call less.
- [ ] A re-priced call is re-priced only once, also when two replicas run the re-pricer at the same time.
- [ ] After the first successful read on a deployment with old estimates, the IBM call rows of the last 30 days that have tokens and a listed model carry the list price; calls with a real price are unchanged.
- [ ] A rollup row's most expensive call reflects the re-priced costs.
- [ ] `mise run //packages/api-server:check` and `mise run //packages/api-server:test` pass.

## Smoke test

With the IBM VPN on and the branch on the local cluster:

1. Repeat slice 04's step 2 (delete the Haiku 5.5 row, run a turn on Opus).
   Within a minute, the Haiku calls have `price_source = 'list'`, a cost equal to LiteLLM's price for their tokens, and the agent's day total in Usage grew by the same amount.
2. On a cluster that has IBM call rows from before slice 04 (the dev history from 2026-11-13 qualifies), run the hourly job once (restart the api-server, or call the job).
   The estimated IBM rows with tokens now carry list prices, and `spend.repriced` with `backfill` reports the total difference.

Then print a short manual guide for the user to repeat both steps.
