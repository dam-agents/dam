# 02 — Past guesses priced again at start

**Depends on:** 01-unpriced-model-waits
**Part of:** No price guess for models newer than DAM's price list — see [README](./README.md)

## Context

After slice 01, no new call takes a guess, but the call rows of the last 30 days still hold the guesses written before the deploy.
On the development installation, 2,006 subscription calls took a guess in the seven days to 2026-11-16, $257 at list price; Claude Fable 5.2 and Mythos 5.2 were missing from the list until #6647.
This slice adds a repricer kind that corrects every guess of a deploy-priced provider once, at api-server start, after slice 01's re-price of waiting calls.
A guess whose model now has a price gets its cost from the list; a guess whose model still has no price becomes a $0 waiting call, which a later start prices.
It covers AC-3.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **Repricer kind** — `packages/api-server/src/modules/spend/domain/reprice.ts`:
   - Add `"guess"` to `RepriceKind`.
   - Let each `RepriceCandidate` carry the `priceSource` of its row, and set `CallReprice.expectedSource` from it for every kind.
     The ledger's `reprice` already guards each row with its own expected source, so two replicas still never change one row twice.
     `REPRICED_SOURCE` then only selects the rows in the candidate query, and the `"guess"` kind selects two sources (step 2).
   - In `repriceCall`, for kind `"guess"`:
     - Look the price up as kind `"backfill"` does: `replyModel: candidate.model`, `modelGroup: null`.
     - When the result is a price row: the new cost is the row's cost, the price source is the result's source, the price model is `candidate.model`.
       Remove `model-unpriced` from the reasons; the row stays estimated only when another reason remains.
       A row from before migration `0154` (source `''`, no reasons) stays estimated, as the IBM back-fill does, because its row does not say why it was estimated.
     - **A row from before `0154` may hold a real price** (decided during implementation): a stream that a user stopped is estimated but priced from the table, maybe with a fast or US factor.
       The table only grew since spend started and no Anthropic price changed, so its stored cost equals its model's list cost at the standard tier or at one of the row's factors (`fast`, a region, or both).
       When the stored cost equals one of these costs, keep that cost and stamp the row with the result's source, so a later start does not read it again; only a cost that no list price explains is a guess and takes the list cost at the standard tier.
       The candidate carries its stored cost for this check.
     - When the result is `awaiting`: cost 0, price source `awaiting`, price model `candidate.model`, estimated, reasons = the old reasons without `model-unpriced`, plus `awaiting-price`.
     - Any other result (for example `unpriced`): return null.
   - Keep the existing `"awaiting"` and `"backfill"` behavior unchanged; IBM LiteLLM keeps using them.
   - Update the `UNIT_BOUNDARY_DESCRIPTION` of `repriceCall`.
2. **Candidate query** — `packages/api-server/src/modules/spend/infrastructure/spend-ledger.ts`, `repriceCandidates`:
   - Select `price_source` too.
   - For kind `"guess"`, the filter is: the provider, `started_at >= since`, `model <> UNKNOWN_MODEL`, input tokens above 0 (the same sum as `"backfill"`), and either `price_source = 'estimate' AND 'model-unpriced' = ANY(estimate_reasons)` or `price_source = '' AND estimated`.
     The input-token filter leaves out calls without usage: their cost came from the payer's most expensive call, never from a price.
   - Keyset paging (`after`, `ORDER BY calling_agent_id, call_id`) stays as it is.
     A converted row leaves the filter, so a second start finds fewer rows; once the last guess is older than 30 days, the query finds none.
3. **Service** — `packages/api-server/src/modules/spend/services/reprice.ts`:
   add `repriceGuesses(provider)` to `Repricer`, running the same loop with kind `"guess"`.
   `spend.repriced` and `platform.spend.repriced` carry kind `guess`; check that `PriceMetrics.repriced` accepts the new kind.
   Update the `UNIT_BOUNDARY_DESCRIPTION` of `createRepricer`.
4. **Start-up step** — `packages/api-server/src/modules/spend/compose.ts`:
   in slice 01's start-up method, for each deploy-priced provider run `repriceAwaiting(provider)` first, then `repriceGuesses(provider)`.
   The order matters: a guess turned into a waiting call this start is priced at a later start, never twice in one.
5. **Architecture doc** — `docs/architecture/spend-limits.md`, **When a cost is fixed**:
   add a bullet next to the IBM back-fill: a guess written before this change (a call priced by its model family's highest prices) is priced again at each api-server start while it is inside the 30 days of call rows and has input tokens.
   It gets its cost from the list when its model has a price now, and else costs nothing and waits for its price.
   A row from before calls recorded where their price came from stays marked as an estimate.
   Update `Last verified:`.
6. Run `mise run check:comment-types`, `mise run //packages/api-server:check` and `mise run //packages/api-server:test`.

## Acceptance criteria

- [ ] At start, for `anthropic` and `anthropic-oauth`, every call row of the last 30 days with input tokens and either (`price_source = 'estimate'` and the reason `model-unpriced`) or (`price_source = ''` and `estimated`) is changed once: to its list cost when the model has a price, else to cost 0 with `price_source = 'awaiting'` and the reason `awaiting-price`.
- [ ] After the change, no such row keeps the reason `model-unpriced`; a row from before `0154` whose model has a price stays estimated.
- [ ] A row without input tokens, a row of another provider, and a row with a real price do not change.
  A row from before `0154` whose cost its model's list price explains, at the standard tier or with a fast or region factor, keeps its cost and only gets the source `table`.
- [ ] The daily rollup and today's day counter move by the same difference as the call rows; `spend.repriced` logs kind `guess` with the number of calls and the total difference.
- [ ] A second start finds no row to change (for a model still without a price, the waiting row is now handled by kind `awaiting`).
- [ ] IBM LiteLLM's `awaiting` and `backfill` runs behave as before.
- [ ] `mise run check:comment-types`, `mise run //packages/api-server:check` and `mise run //packages/api-server:test` pass.

## Smoke test

On the local cluster (the [`cluster-ops`](../../../.agents/skills/cluster-ops/SKILL.md) skill):

1. Count the guesses in the local Postgres before the deploy:
   provider `anthropic` or `anthropic-oauth`, `started_at` in the last 30 days, input tokens above 0, and (`price_source = 'estimate'` with `model-unpriced`) or (`price_source = ''` with `estimated`).
   Note the total cost of these rows and the model names.
2. If the count is zero, make real guesses first: deploy `main`'s api-server with the `claude-haiku-5-5` row removed from the Anthropic table (a local edit), and run a short Claude Code session on the subscription Connection; its background haiku calls take a guess.
3. Deploy this branch's api-server with the full table.
   Check: the api-server logs `spend.repriced` with kind `guess` once per provider; the count from step 1 is now zero; the haiku rows carry `price_source = 'table'` and a lower cost.
4. To check the conversion to a waiting call, repeat step 3 with the `claude-haiku-5-5` row still removed: the guesses become cost 0, `price_source = 'awaiting'`; a later start with the full table prices them (kind `awaiting`).
5. Restart the api-server once more: no `spend.repriced` line with kind `guess`.

Then print a short manual guide for Petr with steps 1, 3 and 5.
