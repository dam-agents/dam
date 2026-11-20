# No price guess for models newer than DAM's price list

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/6659

## Goal

When a call names a model that DAM cannot price yet, DAM guesses its price today.
It takes the highest price of each kind in the model's family, else the provider's highest price.
The guess can be several times the real price.
Until 2026-11-16, Claude Fable 5.2 counted $10 / $50 / $1.00 per million input / output / cache-read tokens instead of $8 / $40 / $0.20.
A Claude Code session reads most of its prompt from the cache, so it counted up to about five times its cost.
On an Anthropic API key the guess goes into the user's spend and the spend limits.
On the Claude subscription it makes the covered value look larger.

After this feature:

- A call to a model that DAM cannot price yet counts $0 and is marked as an estimate (`awaiting-price`), for every provider that DAM prices: Anthropic API keys and the Claude subscription (the Anthropic table), and any provider with operator prices.
- Each api-server start prices the waiting calls again, because the Anthropic table and the operator prices change only with a deploy.
- At the first start after the deploy, the Claude guesses of the last 30 days are priced again: from the list when it has the model now, else as $0 waiting calls.
- The model catalogs and spend read one LiteLLM price list, from one commit, written by one update task.

The issue's "Done when" holds the four acceptance criteria (AC-1 to AC-4).

## Approach

Read [`docs/architecture/spend-limits.md`](../../architecture/spend-limits.md) first: the sections Prices, Estimates and "When a cost is fixed" are the contract this feature changes.
The model catalog side is in [`docs/architecture/harness-config.md`](../../architecture/harness-config.md) (metadata layering) and [`docs/architecture/owner-model-catalog.md`](../../architecture/owner-model-catalog.md).

**How a call is priced today** (`packages/api-server/src/modules/spend/domain/prices.ts`, `lookupPrice`):

- IBM LiteLLM (`LISTED_PROVIDERS`): operator price, RITS rule, IBM list, the reply's own cost, then `awaiting` ($0, marked, priced again after the next price read).
- Every other provider: operator price, provider rule (CurveBender free, Bob in Bobcoins), the Anthropic table (`anthropic`, `anthropic-oauth`), then **the guess** from `highestPrices` over the family (`modelFamily`) of `operatorRows + tableRows`, with source `estimate` and reason `model-unpriced`.
  When `operatorRows + tableRows` is empty (OpenAI and Bedrock with no operator price), the call is `unpriced`: $0 and not marked.
- The chart ships `priceOverrides: []` and no deployment sets operator prices, so in practice the guess fires only for `anthropic` and `anthropic-oauth`.

**What changes:**

- The guess goes away.
  Where `lookupPrice` returns the guess today, it returns `awaiting`.
  The `unpriced` case stays as it is.
  So the rule is one sentence: a provider that DAM prices, but not this model yet, makes the call wait.
- The repricer (`services/reprice.ts`, `createRepricer`) already prices waiting calls again per provider, safely across replicas: a row changes only while its `price_source` is still the one that was read.
  Today only the IBM price reader calls it (`compose.ts`, `onWritten`).
  For the providers that a deploy prices (the Anthropic table providers and every provider with operator prices, IBM LiteLLM excluded), a new start-up step calls it, next to `spend.readPricesIfEmpty()` in `packages/api-server/src/bootstrap.ts`.
- A new repricer kind corrects the old guesses once (slice 02).
- One file in `api-server-api` holds both the catalog part and the Anthropic part of LiteLLM's list (slice 03).

**Known limits (accepted during grilling, do not fix):**

- A spend limit does not see a waiting call until a deploy brings the price, about one to two weeks for the Anthropic table.
  An operator price in the chart prices the model at once; the restart then prices the waiting calls again.
- Guesses written by old replicas during a rolling deploy stay until the next api-server start.
- Call rows live 30 days (`CALL_ROWS_RETENTION_DAYS`); daily rollups older than that keep their guesses.
- The repricer looks a model up by the row's `model` only (`pathModel: null`), so a waiting Bedrock call whose reply names no model stays waiting even after an operator price arrives.
  Bedrock has no operator prices today.

## Sub-issues

| #   | Title                                           | Scope                                                                                                                                                                                          | Depends on                               |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 01  | A call to an unpriced model waits for its price | `lookupPrice` returns `awaiting` instead of the guess; ingest asks for a price read only for IBM LiteLLM; each start prices waiting calls of deploy-priced providers again; docs. AC-1, AC-2.  | —                                        |
| 02  | Past guesses priced again at start              | A new repricer kind for the guesses of the last 30 days: priced from the list, or turned into $0 waiting calls; docs. AC-3.                                                                    | 01                                       |
| 03  | One LiteLLM price list                          | One update task writes one file with the catalog part and the Anthropic part, with a guard against lost prices; spend reads it; the spend copy, its task and one `up` row go away; docs. AC-4. | 02 (only for the order of the doc edits) |

## Conventions & glossary

- **Deploy-priced provider:** a provider, other than IBM LiteLLM, whose prices come only from what a deploy ships: the Anthropic table (`anthropic`, `anthropic-oauth`) or operator prices (`apiServer.spend.priceOverrides`).
  Its waiting calls are priced again at each api-server start.
- **Guess:** a call row priced by the family's highest prices: `price_source = 'estimate'` with the reason `model-unpriced`, or, before migration `0154`, `price_source = ''` with `estimated = true` (such a row cannot say why it was estimated).
- **Waiting call:** a call row with `price_source = 'awaiting'`, cost $0, `estimated = true` and the reason `awaiting-price`.
- **Anthropic part / catalog part:** the two parts of the one price file `packages/api-server-api/src/modules/model-catalog/model-prices.json` after slice 03.
- Apply `/typescript-engineering` in every slice: all changes are server-side TypeScript in `packages/api-server` and `packages/api-server-api`, plus one Node task script.
- Follow [`docs/guidelines/comment-guidelines.md`](../../guidelines/comment-guidelines.md); the `UNIT_BOUNDARY_DESCRIPTION` comments on `lookupPrice`, `repriceCall`, `createRepricer` and the update task must keep matching the code.
  Run `mise run check:comment-types` after each slice.
- Follow [`docs/guidelines/documentation-guidelines.md`](../../guidelines/documentation-guidelines.md): one sentence per line, and update `Last verified:` on each architecture page you change.
- No new tests (project rule).
  The existing suite (`mise run check`, `mise run test`) plus the manual smoke tests verify each slice.
  An existing test whose expectation encodes the guess changes its expectation; it is not deleted silently.
- No UI change: the Usage view already shows a waiting call as an estimate.
  The PR needs no screenshots, and the QA and Design profiles need no edits.

## Whole-feature smoke test

On the local cluster (use the [`cluster-ops`](../../../.agents/skills/cluster-ops/SKILL.md) skill), with an Anthropic subscription Connection granted to a throwaway agent:

1. **AC-1:** deploy the branch's api-server with `claude-haiku-5-5` removed from the Anthropic part (a local edit, never committed).
   Run a Claude Code session on an Opus or Sonnet model; Claude Code's background calls go to `claude-haiku-5-5`.
   Usage shows those calls at $0 as estimates; the api-server logs `spend.call_awaiting_price` with provider `anthropic-oauth`.
2. **AC-2:** redeploy with the full file.
   At start, the api-server logs `spend.repriced` with kind `awaiting`; Usage shows the haiku calls at their list cost, and the day's spend includes it.
3. **AC-3:** before step 1, count the guesses in the local database (provider `anthropic` or `anthropic-oauth`, last 30 days, `price_source = 'estimate'` with `model-unpriced`, or `price_source = ''` with `estimated`).
   After the first start of the branch, the count is zero, and `spend.repriced` with kind `guess` names them.
4. **AC-4:** `mise run //packages/api-server-api:update:model-prices -- 21215cebac633da4b2d4d0d29ef5557a240bf141` leaves the file's content unchanged; the catalog and spend read the same `source.commit`.

Then print a short manual guide so Petr can repeat steps 1–2 by hand.

## Delivery

Each sub-issue is one atomic commit.
The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/6659.
