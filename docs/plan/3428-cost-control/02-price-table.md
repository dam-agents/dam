# 02 — Price table

**Part of:** Cost control — see [README](./README.md)

## Context

This slice gives the api-server one price lookup for model calls (decision D13).
It is pure domain code plus its data: IBM LiteLLM's own prices as operator prices from Helm, the provider rules, and a small table of the Anthropic API's list prices.
Slice 03 calls it for each usage record.
It does not depend on slice 01, but it adds two fields to slice 01's meter.

Most of the spend happens on IBM LiteLLM, so IBM's own prices matter most.
Public list prices are the real price only for an own Anthropic, OpenAI or Bedrock key, and their replies carry tokens only.
This slice stores only the Anthropic API's list prices: they price Anthropic keys and the value of the Claude subscription (D16).
OpenAI and Bedrock are not priced in this feature, unless an operator sets prices in Helm.

The prices follow LiteLLM's own cost rules (the cost code of LiteLLM at the pinned commit), so our cost equals LiteLLM's cost for the same counts.

PR #4620 adds its own price file in agent-runtime.
This slice does not use or change that file.
The agreed direction is one table in the api-server (README, "Relation to the Model Router").

## Implementation plan

Apply `/typescript-engineering`.
The code lives in the new module `packages/api-server/src/modules/spend/`.

1. **Normalized usage (domain type).**
   The input of the cost formula: uncached input tokens, output tokens, cache-read tokens, 5-minute cache-write tokens, 1-hour cache-write tokens, the cache-write total when the reply has no split, web searches, Bob credits, the service tier, the speed (`fast` or `standard`), the inference geography, and the total prompt size (input plus all cache tokens, for the long-prompt prices).
   Slice 03 maps each dialect's raw counts to this type.
   Rule for slice 03, write it next to the type: OpenAI counts cached tokens inside the prompt tokens, Anthropic does not.

2. **Price row (domain type).**
   - The five token prices: input, output, cache read, cache write 5 minutes, cache write 1 hour.
   - A price per web search.
   - At most one prompt-size threshold, with the five token prices above it.
   - The flex and priority tiers: input, output, cache read and cache write 5 minutes, also above the threshold.
   - Price factors by speed and by inference geography (LiteLLM's `provider_specific_entry`, for example `fast: 2` and `us: 1.1`).
   - Each field is optional.
   - Prices are exact whole numbers (micro-units per million tokens), so a sum has no rounding error.

3. **Lookup (domain, pure).**
   Input: the provider template id, the reply's model name and, for Bedrock, the model from the path.
   Output: a price row, the Bob credits rule, the $0 rule, or "not priced", plus the price source (`override`, `provider-rule`, `table`, `estimate`, `unpriced`).
   The first match wins:
   1. Operator price for the provider and model.
   2. Provider rule:
      - `curve-bender`: $0;
      - `ibm-litellm` with a `rits/` model: $0;
      - `bob`: the Bobcoins in the reply;
      - `anthropic-oauth`: the Anthropic table, in the unit `usd_list`.
   3. The Anthropic table, for `anthropic` and `anthropic-oauth`.
   4. Unknown model on a provider with prices: the highest price of the model's family among that provider's prices (for example all `claude-opus-*` rows), else the highest price of the provider.
      Source `estimate`.
      For `ibm-litellm`, the provider's prices are its operator prices.
   5. `openai` and `bedrock` without an operator price: "not priced".
      Source `unpriced`.

   **Model names:** a reply can name another model than the request.
   For example, `aws/claude-sonnet-4-6` comes back as `claude-sonnet-4-6`.
   Match an operator price or a table row also by the last path segment of its name, without case and with `.` and `-` treated as equal.
   An exact match wins over this match.
   When several rows match, take the highest price.

4. **Cost formula (domain, pure).**
   Cost in micro-units of the unit, rounded up.
   Follow LiteLLM's cost rules:
   - When the prompt size is above the row's threshold, use the prices above the threshold for all five token kinds.
   - When the reply names the flex or priority tier, use the tier's prices for input, output, cache read and the 5-minute cache write.
   - A missing higher price uses the normal price of the same kind.
     A missing cache-read or 5-minute price uses the input price, and a missing 1-hour price uses the 5-minute price.
     A missing cache price never becomes $0.
   - When the reply has a cache-write total but no 5-minute and 1-hour split, price it all at the 1-hour price.
     This counts high, as D10 asks.
   - Web searches cost the row's price per search (LiteLLM's "medium" search price).
   - Apply the row's speed and geography factors to all token prices.
   - A "not priced" call costs 0.

5. **Proxy cost check (domain, pure).**
   A function that compares our cost with the `x-litellm-response-cost` header value.
   It returns the difference as a ratio, or nothing when the header is missing or 0.
   IBM LiteLLM sends 0 on every streamed reply, so the check works only on replies that are not streamed.
   Slice 03 logs a warning above 5%.

6. **The Anthropic table.**
   - A new task `packages/api-server/.mise/tasks/update/model-prices`, run as `mise run //packages/api-server:update:model-prices -- <litellm-commit>`.
     It downloads `model_prices_and_context_window.json` at that commit and writes `packages/api-server/src/modules/spend/infrastructure/model-prices.json` with the pinned commit and the date.
   - Keep only the rows of the Anthropic API (`litellm_provider: anthropic`) with mode `chat`.
     Keep only the fields of step 2.
   - The task fails when a kept row has no input, output, cache-read, 5-minute or 1-hour price.
     This check protects every later update: a broken LiteLLM update stops the task before anything is written.
   - Pin LiteLLM commit `7dd53d6adc6213e84f62f1366ba721d09f4af992` (2026-10-13).
     It has Claude Opus 5.5 and Sonnet 5.5, after the Sonnet 5.5 cache-read fixes of 2026-10-07 and 2026-10-08.
   - An infrastructure adapter loads the JSON and gives it to the domain lookup.

7. **Operator prices.**
   - Helm `apiServer.spend.priceOverrides` in `helm/values.yaml`: a list of rows with the provider template id, the model, and the fields of step 2, with token prices in dollars per million tokens.
   - It goes to the env var `SPEND_PRICE_OVERRIDES` (JSON) in `helm/templates/apiserver/app.yaml`.
   - Add it to `packages/api-server/src/config.ts` with a Zod schema, the same way as `HARNESSES` (`.transform(JSON.parse).pipe(schema)`).
   - Ship IBM LiteLLM's 18 priced models (the two RITS models DeepSeek V3.2 and Kimi K2.5 among them, at $0), with every price field that IBM's `/model/info` sets (step 8).
     The research page's values of 2026-10-13 are the cross-check: input, output, cache read and both cache writes must match, or Petr decides.
   - Add a short comment in `values.yaml` that tells the source and the date, because Helm values are config, not code.

8. **One IBM read, not a repo task.**
   - Petr creates a temporary IBM LiteLLM Management key.
   - He runs a read script outside the repo, in his own terminal; the key never enters a file, the shell history or the session.
   - The script calls `/model/info` on the IBM LiteLLM host and writes only the price fields of each model.
   - Petr revokes the key.
     Never give a Management key to an agent: the gateway adds a Connection's key to every call to its host.

9. **The meter reads speed and geography.**
   In slice 01's Lua meter (`packages/controller/pkg/reconciler/envoy_spend_meter.go`), read `speed` and `inference_geo` inside the usage object, and add them to the `platform.spend` metadata, like `service_tier`.
   Bump `envoyBootstrapTemplateRev`, because the template changed: a gateway reads its bootstrap only at start.

10. **Dependency updates.**
    Add one row to the Ecosystems table of the `up` skill (`.agents/skills/up/SKILL.md`, the tracked copy): the Anthropic price table, pinned in `model-prices.json`; bump with `update:model-prices` and the newest LiteLLM commit, and show the price diff for Petr's review.

11. **Docs** (same commit):
    - `docs/architecture/spend-limits.md`: a "Prices" section with the lookup order, LiteLLM's cost rules, the two rules (store the cost at call time; compare with the proxy header when it is above 0), the providers that are not priced, and how the table and the operator prices are updated.
      In the "Meter" section, add the speed and the geography to the list of what the meter reads.
    - Bump `Last verified:`.
    - Run `mise run fix:markdown`.

## Acceptance criteria

- [x] `mise run //packages/api-server:update:model-prices -- <commit>` writes the table, and a second run with the same commit gives no diff.
- [x] The table has the Anthropic API rows for Claude Opus 5.5 and Sonnet 5.5, with all five token prices and their factors (US-only for both, fast mode for Opus 5.5).
- [x] The task fails when a kept row misses one of the five token prices.
- [x] The IBM operator prices in `helm/values.yaml` come from the new read, and they match the research page for input, output, cache read and both cache writes.
- [x] The api-server starts with `SPEND_PRICE_OVERRIDES` set and fails at start when the value is not valid.
- [x] The domain code has no imports from infrastructure, Helm or config.
- [x] `mise run check` and `mise run check:comment-types` pass.

## Smoke test

1. Run `mise run //packages/api-server:update:model-prices -- 7dd53d6adc6213e84f62f1366ba721d09f4af992` two times.
   `git diff --stat` shows only the first run's change.
2. In the generated JSON, read the rows of `claude-sonnet-4-6` and `claude-opus-5-5`.
   Compare 3 prices with the LiteLLM file at the same commit, and with Anthropic's pricing page.
3. Run `mise run check`.
4. On the dev cluster: `mise run cluster:build -- api-server`, then `mise run cluster:helm` (see `cluster-ops` for the values file).
   The api-server pod starts.
5. Calculate by hand the cost of one Sonnet 4.6 call on IBM LiteLLM with 1,000 input, 200 output and 5,000 cache-read tokens.
   Keep the number for the smoke test of slice 03.

Slice 03 checks the lookup end to end against real calls.

Then print a short guide for Petr, so that he can repeat steps 1 and 2 by hand.
