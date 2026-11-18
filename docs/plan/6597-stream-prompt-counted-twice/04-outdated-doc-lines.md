# 04 — Three outdated doc lines

**Part of:** A Messages stream counts the prompt twice — see [README](./README.md)

## Context

The review of the IBM LiteLLM price work (#6632) found three architecture lines that no longer match the code.
Each is a one-line fix, so this feature takes them.
They do not touch the stream rule.

## Implementation plan

1. **[connection-presets.md](../../architecture/connection-presets.md)**, section "App preset: IBM LiteLLM proxy": the model catalog lists the endpoint's models "through the OpenAI model list when the key is refused it".
   The code asks the second listing whenever the first one gives no model list: refused, timed out, unreachable or empty (`packages/api-server-api/src/modules/model-catalog/discovery.ts`, the loop over `spec` and `spec.fallback`).
   Change the words to "when the model information cannot be read".
2. **[harness-config.md](../../architecture/harness-config.md)**, the model catalog: "A source may also name a second listing on the same endpoint, asked only when the provider refuses the first".
   Change "asked only when the provider refuses the first" to "asked when the first gives no model list".
   Keep the rest of the sentence: the LiteLLM key example and the embedding-model note stay true.
3. **[persistence.md](../../architecture/persistence.md)**, the **spend** entry: add the price tables.
   `provider_model_prices` keeps the last price row read for each provider and model.
   `provider_price_reads` keeps, per Connection, when its price list was last read, the last refusal and how many models it priced.
   Link [spend-limits](../../architecture/spend-limits.md#prices) as the owner, as the entry already does.
4. Update `Last verified:` on each page, and run `mise run fix:markdown` and `mise run //docs:check:doc-size`.

## Acceptance criteria

- [ ] `connection-presets.md` and `harness-config.md` say that the second listing is asked when the first gives no model list.
- [ ] The **spend** entry of `persistence.md` names `provider_model_prices` and `provider_price_reads`.
- [ ] `mise run //docs:check` passes.

## Smoke test

1. Run `mise run //docs:check`.
2. Read the code that each line describes: the listing loop in `discovery.ts`, and the two tables in `packages/db/src/schema.ts`.
   Each changed sentence says what the code does.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
