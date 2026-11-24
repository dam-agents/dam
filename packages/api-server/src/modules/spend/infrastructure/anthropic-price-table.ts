import { VENDORED_ANTHROPIC_PRICES } from "api-server-api/model-prices";
import { z } from "zod";
import { liteLlmPrice } from "../domain/litellm-price-row.js";
import type { PricedModel } from "../domain/prices.js";

const liteLlmRowSchema = z.record(
  z.string(),
  z.union([z.number(), z.record(z.string(), z.number())]),
);

const tableSchema = z.object({
  commit: z.string(),
  models: z.record(z.string(), liteLlmRowSchema),
});

export function loadAnthropicPriceTable(): PricedModel[] {
  const { models } = tableSchema.parse(VENDORED_ANTHROPIC_PRICES);
  return Object.entries(models).map(([model, fields]) => {
    const price = liteLlmPrice(fields);
    if (!price) {
      throw new Error(
        `the Anthropic price list: ${model} has no input or output price`,
      );
    }
    return { provider: "anthropic", model, row: price.row };
  });
}
