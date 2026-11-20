# 03 — One LiteLLM price list

**Depends on:** 02-past-guesses-repriced (only for the order of the edits to `spend-limits.md`)
**Part of:** No price guess for models newer than DAM's price list — see [README](./README.md)

## Context

DAM keeps two copies of LiteLLM's public price list, with two update tasks and two rows in the `up` routine.
They drift: the catalog copy kept its 2026-10-27 commit until 2026-11-16, while the spend copy was refreshed on 2026-11-02, so spend and the catalogs did not know the same models.
The copies are two projections of one upstream file, and both are needed:

|         | Spend copy                                                                                                    | Catalog copy                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| File    | `packages/api-server/src/modules/spend/infrastructure/model-prices.json`                                      | `packages/api-server-api/src/modules/model-catalog/model-prices.json`                                                   |
| Rows    | 24: `litellm_provider = anthropic`, mode chat, LiteLLM's exact names                                          | 1,917: modes chat, responses, completion; one per family name (last segment, lowercase, dots as dashes; plain keys win) |
| Fields  | Every price field: 1-hour cache write, `_above_Nk_tokens`, `_flex` / `_priority`, web search, `price_factors` | Limits, reasoning, vision, input / output / cache-read / cache-write prices                                             |
| Task    | `//packages/api-server:update:model-prices <commit>`; stops on an incomplete row                              | `//packages/api-server-api:update:model-prices`; always the newest commit                                               |
| Readers | spend (`anthropic-price-table.ts`)                                                                            | api-server (`provider-model-catalog.ts`) and agent-runtime (`server.ts`), so it ships in every agent image              |

The catalog part cannot price spend: it lacks the 1-hour cache write (all 24 rows), the prompt-size prices (`claude-haiku-5-5`), the fast-mode and US factors and the web-search price.
Its family dedup also fills 42 of its 66 Claude families from other hosts (`claude-opus-4-1` from `vercel_ai_gateway`, `claude-3-5-haiku` from `heroku`, every `@default` name from `vertex_ai`), so spend must not read it.
This slice puts both projections in one file, from one commit, written by one task.
It covers AC-4.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **One task** — rewrite `packages/api-server-api/.mise/tasks/update/model-prices`; delete `packages/api-server/.mise/tasks/update/model-prices`.
   - Optional argument `[commit]` (`//USAGE arg "[commit]"`): a full 40-character SHA; without it, the newest commit of `model_prices_and_context_window.json` (today's catalog behavior).
     Remove the `//MISE sources` / `outputs` lines, so the task always runs and `up` no longer needs `--force`.
   - Fetch the commit's date and the file at that commit, as the spend task does today.
   - Write one file at the catalog's current path with three keys:
     - `source`: `url` (the file's blob URL at the commit), `commit`, `committedAt`, and the `pruned` note.
     - `models`: the catalog part, built exactly as today (same modes, same family normalization and plainness order, same ten fields).
     - `anthropic`: the Anthropic part, built exactly as the spend task builds `models` today (`litellm_provider === "anthropic"`, mode chat, `PRICE_FIELD`, `web_search_cost_per_query`, `price_factors`).
   - **Guard** (decided in grilling): read the current file's `anthropic` part first.
     - A row is incomplete when it lacks one of the five `REQUIRED` prices or has more than one prompt-size step.
     - When a row that the current file has is missing upstream or is incomplete, stop before writing and name every such row: DAM would lose a price.
     - When a new row is incomplete, leave it out of the `anthropic` part, keep it in `models`, and name it in the output; its model's calls wait for their price.
   - Print a short review summary: the Anthropic rows added, removed (never, because of the guard), changed (field by field) and left out.
   - Write each model on its own line in both parts, so a `git diff` shows one line per changed model.
   - Rewrite the task's `UNIT_BOUNDARY_DESCRIPTION` for the new behavior.
2. **Regenerate** the file with `mise run //packages/api-server-api:update:model-prices -- 21215cebac633da4b2d4d0d29ef5557a240bf141`, the commit both copies hold today, so this slice changes no price.
3. **Exports** — `packages/api-server-api/src/modules/model-catalog/vendored-price-table.ts`:
   keep `VENDORED_PRICE_TABLE` (the catalog part; the `PriceTable` type in `price-table.ts` stays `{ source, models }`, so the existing test fixtures stay valid) and add an export for the Anthropic part with its commit, through the existing `api-server-api/model-prices` entry in `package.json`.
4. **Spend** — `packages/api-server/src/modules/spend/infrastructure/anthropic-price-table.ts`:
   import the Anthropic part from `api-server-api/model-prices` and parse it with the existing `liteLlmRowSchema` and `liteLlmPrice`; adapt `tableSchema` to the new shape.
   Delete `packages/api-server/src/modules/spend/infrastructure/model-prices.json`.
5. **`up` routine** — `.agents/skills/up/SKILL.md`, the Ecosystems table:
   replace the rows "Model prices" and "Model catalog table" with one row: pinned in the one file (its `source.commit`); find outdated as today; update with `mise run //packages/api-server-api:update:model-prices -- <commit>`; show the task's review summary and the context-window and reasoning changes for Petr's review before the commit; a stopped run names the rows that would lose a price: do not pin that commit.
6. **Architecture docs**:
   - `docs/architecture/spend-limits.md`, Prices: "The Anthropic table: Anthropic's list prices, copied from a pinned version of LiteLLM's public price list" becomes the Anthropic part of the LiteLLM price list that the model catalogs also read.
     **Updating prices**: one reviewed update writes both parts from one LiteLLM commit; it stops when a row that DAM prices would lose a price; a new row without every price is left out of the Anthropic part, so its model's calls wait for their price.
     Update `Last verified:`.
   - `docs/architecture/harness-config.md` (line about "the vendored LiteLLM price table") and `docs/architecture/owner-model-catalog.md`: check that each still reads true; change a line only when it no longer does.
7. Run `mise run check:comment-types`, `mise run //packages/api-server-api:check`, `mise run //packages/api-server:check`, `mise run //packages/agent-runtime:check`, `mise run //packages/api-server:test` and `mise run //packages/agent-runtime:test`.

## Acceptance criteria

- [ ] One price file exists, at `packages/api-server-api/src/modules/model-catalog/model-prices.json`, with `source`, `models` and `anthropic`; `git ls-files | grep model-prices.json` prints only it.
- [ ] One update task exists (`//packages/api-server-api:update:model-prices`); `mise tasks ls --all | grep update:model-prices` prints only it.
- [ ] Regenerated at `21215ceb`, the file's `models` part equals today's catalog `models`, and its `anthropic` part equals today's spend `models`, value for value.
- [ ] The task stops, without writing, when a row of the current `anthropic` part is missing upstream or incomplete, and names the rows.
- [ ] The task leaves a new incomplete Anthropic row out of the `anthropic` part, keeps it in `models`, and names it.
- [ ] Spend loads 24 Anthropic rows at start, as before.
- [ ] The `up` skill has one row for the price file.
- [ ] All checks and tests in step 7 pass.

## Smoke test

1. Before the change, save both files (`git show HEAD:<path>`) to a scratch folder.
2. Run `mise run //packages/api-server-api:update:model-prices -- 21215cebac633da4b2d4d0d29ef5557a240bf141`.
   Compare with a short Node or `jq` script: the new `models` part equals the saved catalog `models`, and the new `anthropic` part equals the saved spend `models`.
   The task's summary reports no added, changed or left-out row.
3. Guard check: add a fake row `claude-fake-1` with all five prices to the new file's `anthropic` part, run the task again with the same commit, and check that it stops and names `claude-fake-1` (DAM would lose its price).
   Restore the file with `git checkout`.
4. Run the checks and tests of step 7.
5. On the local cluster (the [`cluster-ops`](../../../.agents/skills/cluster-ops/SKILL.md) skill), deploy the branch's api-server and run one call on the Anthropic subscription Connection with a listed model: the call has `price_source = 'table'` and the same cost as before the change.

Then print a short manual guide for Petr with steps 2 and 3.
