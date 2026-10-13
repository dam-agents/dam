# 02 — Price table

**Part of:** Cost control — see [README](./README.md)

## Context

This slice gives the api-server one price lookup for model calls (decision D13).
It is pure domain code plus its data: a generated table from a pinned LiteLLM commit, operator overrides from Helm with the IBM prices, and the provider rules.
Slice 03 calls it for each usage record.
It does not depend on slice 01.

PR #4620 adds its own price file in agent-runtime.
This slice does not use or change that file.
The agreed direction is one table in the api-server (README, "Relation to the Model Router").

## Implementation plan

Apply `/typescript-engineering`.
The code lives in the new module `packages/api-server/src/modules/spend/`.

1. **Normalized usage (domain type).**
   The input of the cost formula: uncached input tokens, output tokens, cache-read tokens, 5-minute cache-write tokens, 1-hour cache-write tokens, web searches, Bob credits, the service tier, and the total prompt size (for the long-prompt tiers).
   Slice 03 maps each dialect's raw counts to this type.
   Rule for slice 03, write it next to the type: OpenAI counts cached tokens inside the prompt tokens, Anthropic does not.

2. **Price row (domain type).**
   Prices in dollars per token: input, output, cache read, cache write 5 minutes, cache write 1 hour, input and output above a prompt-size threshold (200k or 272k, with the threshold), flex and priority input and output, and a price per web search.
   Each field is optional.

3. **Lookup (domain, pure).**
   Input: the provider template id, the reply's model name and, for Bedrock, the model from the path.
   Output: a price row, or a fixed unit amount for Bob, plus the price source (`override`, `provider-rule`, `table`, `estimate`).
   The first match wins:
   1. Operator override for the provider and model.
   2. Provider rule:
      - `curve-bender`: $0;
      - `ibm-litellm` with a `rits/` model: $0;
      - `bob`: the Bobcoins in the reply;
      - `anthropic-oauth`: the list price from the table, in the unit `usd_list`.
   3. The generated table.
   4. The highest price of the model's family (for example all `claude-opus-*` rows), else the highest price of the provider.
      Source `estimate`.

   **Model names:** a reply can name another model than the request.
   For example, `aws/claude-sonnet-4-6` comes back as `claude-sonnet-4-6`.
   Match an override or a table row also by the last path segment of its name, without case and with `.` and `-` treated as equal.
   An exact match wins over this match.

4. **Cost formula (domain, pure).**
   Cost in micro-units of the unit, rounded up.
   - Use the long-prompt prices when the prompt is above the row's threshold.
   - Use the flex or priority prices when the reply names that tier.
   - When the reply has a cache-write total but no 5-minute and 1-hour split, price it all at the 1-hour price.
     This counts high, as D10 asks.
   - A missing optional price falls back to the plain input or output price of the same row.
     A missing cache price never becomes $0.

5. **Proxy cost check (domain, pure).**
   A function that compares our cost with the `x-litellm-response-cost` header value.
   It returns the difference as a ratio.
   Slice 03 logs a warning above 5%.

6. **The generated table.**
   - A new task `packages/api-server/.mise/tasks/update/model-prices`, run as `mise run //packages/api-server:update:model-prices -- <litellm-commit>`.
     It downloads `model_prices_and_context_window.json` at that commit and writes `packages/api-server/src/modules/spend/infrastructure/model-prices.json` with the pinned commit and the date.
   - Keep the rows of the providers that DAM uses: Anthropic, OpenAI, Bedrock, Gemini, Azure.
     Keep only the fields of step 2.
     Check the LiteLLM field names at the pinned commit, for example `cache_creation_input_token_cost_above_1hr` and `search_context_cost_per_query`.
   - The task fails when a kept row has no input or output price, or when a Claude row has no 1-hour cache-write price.
     This check protects every later update.
   - Pin a LiteLLM commit from October 2026 that has Claude Opus 5.5 and Sonnet 5.5.
     The Sonnet 5.5 cache-read price was corrected 9 days after its release, so take a commit after that fix.
   - An infrastructure adapter loads the JSON and gives it to the domain lookup.

7. **Operator overrides.**
   - Helm `apiServer.spend.priceOverrides` in `helm/values.yaml`: a list of rows with the provider template id, the model, and prices in dollars per million tokens.
   - It goes to the env var `SPEND_PRICE_OVERRIDES` (JSON) in `helm/templates/apiserver/app.yaml`.
   - Add it to `packages/api-server/src/config.ts` with a Zod schema, the same way as `HARNESSES` (`.transform(JSON.parse).pipe(schema)`).
   - Ship the IBM LiteLLM rows from the research page, section "IBM LiteLLM price list", read on 2026-10-13: input, output, cache read, 5-minute and 1-hour cache write, for all 18 priced models, and $0 per web search.
     Add the two RITS models (DeepSeek V3.2, Kimi K2.5) at $0 as well, in case their reply names drop the `rits/` prefix.
     The tier fields and the long-prompt prices of IBM were not recorded, so the lookup takes them from the table.
   - Add a short comment in `values.yaml` that tells the source and the date, because Helm values are config, not code.

8. **IBM price script.**
   A task `packages/api-server/.mise/tasks/update/ibm-litellm-prices`.
   - It reads a temporary IBM LiteLLM Management key from the env var `IBM_LITELLM_MANAGEMENT_KEY`.
   - It calls `/model/info` on the IBM LiteLLM host (the constant `IBM_LITELLM_HOST` in `providers.ts`).
   - It prints the `priceOverrides` YAML block, with every price field, for a person to review and paste.
   - It never prints or stores the key.
   - The task description says to revoke the key after the run, and to never give a Management key to an agent: the gateway adds a Connection's key to every call to its host.

9. **Dependency updates.**
   Add one step to the `up` skill (`.agents/skills/up/SKILL.md`, the tracked copy): run `update:model-prices` with the newest LiteLLM commit, and show the price diff for Petr's review.
   Petr reviews each table update.

10. **Docs** (same commit):
    - `docs/architecture/spend-limits.md`: a "Prices" section with the lookup order, the two rules (store the cost at call time; compare with the proxy header), and how the table and the overrides are updated.
    - Bump `Last verified:`.
    - Run `mise run fix:markdown`.

## Acceptance criteria

- [ ] `mise run //packages/api-server:update:model-prices -- <commit>` writes the table, and a second run with the same commit gives no diff.
- [ ] The generated table has rows for Claude Opus 5.5 and Sonnet 5.5 with a 1-hour cache-write price.
- [ ] The task fails when a required price is missing.
- [ ] The IBM overrides in `helm/values.yaml` match the research page for 3 models picked by hand (input, output, cache read, both cache writes).
- [ ] The api-server starts with `SPEND_PRICE_OVERRIDES` set and fails at start when the value is not valid.
- [ ] The domain code has no imports from infrastructure, Helm or config.
- [ ] `mise run check` and `mise run check:comment-types` pass.

## Smoke test

1. Run `mise run //packages/api-server:update:model-prices -- <commit>` two times.
   `git diff --stat` shows only the first run's change.
2. In the generated JSON, read the rows of `claude-sonnet-4-6` and `gpt-5.5`.
   Compare 3 prices with the LiteLLM file at the same commit.
3. Run `mise run check`.
4. On the dev cluster: `mise run cluster:build -- api-server`, then `mise run cluster:helm` (see `cluster-ops` for the values file).
   The api-server pod starts.
5. Calculate by hand the cost of one Sonnet 4.6 call on IBM LiteLLM with 1,000 input, 200 output and 5,000 cache-read tokens.
   Keep the number for the smoke test of slice 03.

Slice 03 checks the lookup end to end against real calls.

Then print a short guide for Petr, so that he can repeat steps 1 and 2 by hand.
