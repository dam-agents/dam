# 03 — DAM reads and keeps the IBM price list

**Depends on:** 02-cost-rules-match-litellm
**Part of:** IBM LiteLLM calls priced from LiteLLM's own model info — see [README](./README.md)

## Context

An ordinary IBM LiteLLM key reads `/v1/model/info`, which lists the models that the key can use with IBM's own prices for each kind of token.
This slice reads it with every IBM LiteLLM Connection's key, every hour and when a Connection is added or its key changes, and keeps the result in Postgres as one IBM list by model group name.
Nothing prices from the list yet; slice 04 does.
The conversion from LiteLLM's price fields to DAM's `PriceRow` already exists for the vendored Anthropic table, and the model-info fetch already exists for Bob's listing, so this slice reuses both.

## Implementation plan

1. **Tables** — `packages/db/src/schema.ts`, then `mise run //packages/db:generate`:
   - `provider_model_prices`: `provider` (the template id), `model` (the model group), `row` (jsonb, a `PriceRow`), `free_search_quota` (boolean), `incomplete` (text array, the price fields DAM does not apply), `run_id` (text), `read_at` (timestamptz); primary key `(provider, model)`.
   - `provider_price_reads`: `connection_id` (primary key), `provider`, `last_ok_at`, `last_refused_at`, `last_status` (integer or null), `model_count` (integer).
2. **Conversion** — move `priceRowFromLiteLlm` and its helpers out of `spend/infrastructure/anthropic-price-table.ts` into a pure `spend/domain/litellm-price-row.ts`, and keep the Anthropic table on it.
   Extend it to return `{ row, freeSearchQuota, incomplete }`:
   - Web search: `web_search_cost_per_query` when present, else `search_context_cost_per_query.search_context_size_medium`.
   - `freeSearchQuota` is true when `search_free_requests` is present.
   - `incomplete` names each field that would change a cost and that DAM does not apply: `output_cost_per_reasoning_token` that differs from `output_cost_per_token`, `regional_endpoint_uplift_multiplier` other than 1, `search_context_cost_per_query` sizes that differ, `search_free_requests`.
   - A model with no input or output price is skipped with one log line, not thrown, for the IBM list; the Anthropic table keeps its throw.
3. **The fetch** — `packages/api-server-api/src/modules/model-catalog/`:
   - `provider-listing.ts`: add `priceListingForTemplate(templateId)`, which returns the `/v1/model/info` spec (`shape: "litellm-model-info"`, the same `urlEnv` and `tokenEnv` as the IBM listing) for `ibm-litellm`, else `null`.
     Slice 06 reuses this spec for the catalogs.
   - `discovery.ts`: for the `litellm-model-info` shape, keep each entry's price fields in `DiscoveredModelInfo.priceFields`: only keys that match `cost`, `_above_`, `search`, `reasoning`, `uplift`, `free_requests` or `billing_unit`.
     Never keep `litellm_params`, and never log a body.
   - Let a spec ask for every mode (`allModes: true`): the price list needs the embedding models too, because the meter bills embeddings; the catalog keeps today's filter.
   - When a model group appears twice, keep the entry with the higher input price, then output price, and set `priceConflict: true` on it.
4. **Connections port** — the spend module defines what it needs; the connections module provides it:
   - In `spend/services/`, a port `PricedConnections` with `list(provider)` and `one(connectionId)`, each giving `{ connectionId, provider, env, credential(): Promise<string | null> }`.
   - In `connections/`, add `listByTemplate(templateId)` to the repository and export `createPricedConnections({ db, secretStore })` from `connections/compose.ts`.
     Build `env` from the Connection's env contributions, as `envOf` in `services/provider-model-catalog.ts` does, and read the key with `secretStore.getField(auth.valueRef)`.
5. **Reader service** — `spend/services/price-reader.ts`, with a store in `spend/infrastructure/provider-prices.ts`:
   - `readAll(provider)`: one run with a new `run_id`; read every Connection of the provider, at most 4 at a time; within the run, the higher price of a model wins and logs `spend.price_conflict`; at the end, write each model with the run's id, so the newest run replaces older rows.
     A model that no Connection lists in the run stays as it was.
   - `readOne(connectionId)`: one Connection; it adds only models that the list lacks.
   - Each read writes the Connection's status row: a good read sets `last_ok_at` and `model_count`, a refusal or error sets `last_refused_at` and `last_status`, and neither removes list rows.
   - Logs: `spend.prices_read` per Connection (Connection id, status, model count; never the key), `spend.price_incomplete` once per model and run with the fields, `spend.operator_price_differs` (next step).
6. **Drift check** — after `readAll`, compare each operator price of the provider (the chart's `priceOverrides`) with the list row of the same model, and log `spend.operator_price_differs` when any token price differs.
7. **Triggers** — in `bootstrap.ts` and the spend module:
   - Register `spend-provider-prices` with `periodicJobs.register` every hour for `ibm-litellm`; also run it once at start when the table has no row for the provider.
   - A saga `spend/sagas/read-prices-on-connection.ts` reads one Connection on `EventType.ConnectionCreated` with template `ibm-litellm`.
   - The connections service emits a new `ConnectionCredentialChanged` event (`src/events.ts`) from `rotateHeaderValue` (`connections/services/connections-service.ts`); the saga reads that Connection too.
8. **Counters** — in `spend/infrastructure/price-metrics.ts` (from slice 02): `platform.spend.price_reads` (`provider`, `outcome`) and `platform.spend.operator_price_differs` (`provider`, `model`).
9. **Docs** — `docs/architecture/spend-limits.md`, **Prices**: add a paragraph "Reading prices" (what is read, with which keys, when, kept in Postgres as one list, how a disagreement and a refusal are handled, the drift and incomplete-price logs).
   Slice 04 rewrites the list of price sources.

Apply `/typescript-engineering`: the reader is a service with ports, the tables and the HTTP fetch are infrastructure, the conversion is domain.

## Acceptance criteria

- [ ] After the api-server starts on an empty table, the IBM list holds every model that the IBM Connections' keys can use, embeddings included, each with its prices.
- [ ] Each IBM Connection has a status row; a Connection whose key gets 403 records the refusal, and the list keeps its rows.
- [ ] A new IBM Connection, and a Connection whose key is replaced, is read at once.
- [ ] Two reads that give different prices for one model keep the higher price and log `spend.price_conflict`.
- [ ] `gcp/gemini-4-argon` is stored with `free_search_quota = true` and the quota in `incomplete`.
- [ ] A chart price for an IBM model that differs from the list logs `spend.operator_price_differs`.
- [ ] No log line, table or error message contains a key or `litellm_params`.
- [ ] `mise run //packages/db:check`, `mise run //packages/api-server-api:check`, `mise run //packages/api-server:check` and `mise run //packages/api-server:test` pass.

## Smoke test

With the IBM VPN on and the branch on the local cluster:

1. Restart the api-server, then query the tables (`mise run cluster:kubectl -- exec -i platform-postgres-0 -- sh -c 'psql -U "$POSTGRES_USER" -d platform -c "…"'`): `provider_model_prices` has a row for each model of the agent's IBM key, and `provider_price_reads` has a good read for each IBM Connection.
2. Compare three rows (`aws/claude-haiku-5-5`, `azure/gpt-6-luna`, `azure/DeepSeek-V4.1-Flash`) with the prices in #6596's table.
3. Add an IBM LiteLLM Connection with an invalid key: its status row records the refusal, and the list does not change.

Then print a short manual guide for the user to repeat the three steps.
