import { z } from "zod";
import type {
  BaseTokenPrices,
  PricedModel,
  PriceRow,
  ServiceTierName,
  TierPrices,
  TokenPrices,
} from "../domain/prices.js";
import table from "./model-prices.json" with { type: "json" };

const liteLlmRowSchema = z.record(
  z.string(),
  z.union([z.number(), z.record(z.string(), z.number())]),
);

const tableSchema = z.object({
  commit: z.string(),
  models: z.record(z.string(), liteLlmRowSchema),
});

type LiteLlmRow = z.infer<typeof liteLlmRowSchema>;

const PICO_PER_DOLLAR = 1e12;
const MICROS_PER_DOLLAR = 1e6;
const TIERS: readonly ServiceTierName[] = ["flex", "priority"];

export function loadAnthropicPriceTable(): PricedModel[] {
  const { models } = tableSchema.parse(table);
  return Object.entries(models).map(([model, row]) => ({
    provider: "anthropic",
    model,
    row: priceRowFromLiteLlm(model, row),
  }));
}

function priceRowFromLiteLlm(model: string, row: LiteLlmRow): PriceRow {
  const price = (field: string): number | undefined => {
    const value = row[field];
    return typeof value === "number"
      ? Math.round(value * PICO_PER_DOLLAR)
      : undefined;
  };
  const prices = (suffix: string): TokenPrices =>
    definedOnly({
      input: price(`input_cost_per_token${suffix}`),
      output: price(`output_cost_per_token${suffix}`),
      cacheRead: price(`cache_read_input_token_cost${suffix}`),
      cacheWrite5m: price(`cache_creation_input_token_cost${suffix}`),
      cacheWrite1h: price(`cache_creation_input_token_cost_above_1hr${suffix}`),
    });

  const thresholdKey = Object.keys(row)
    .map((field) => field.match(/^input_cost_per_token_above_(\d+)(k?)_tokens/))
    .find((m) => m !== null);
  const above = thresholdKey
    ? `_above_${thresholdKey[1]}${thresholdKey[2]}_tokens`
    : null;

  const tiers: Partial<Record<ServiceTierName, TierPrices>> = {};
  for (const tier of TIERS) {
    const tierPrices = prices(`_${tier}`);
    const tierAbove = above ? prices(`${above}_${tier}`) : {};
    if (isEmpty(tierPrices) && isEmpty(tierAbove)) continue;
    tiers[tier] = isEmpty(tierAbove)
      ? { prices: tierPrices }
      : { prices: tierPrices, aboveThreshold: tierAbove };
  }

  const webSearch = row.web_search_cost_per_query;
  const factors = row.price_factors;
  return {
    prices: basePrices(model, prices("")),
    ...(typeof webSearch === "number"
      ? { webSearchMicros: Math.round(webSearch * MICROS_PER_DOLLAR) }
      : {}),
    ...(thresholdKey && above
      ? {
          threshold: {
            promptTokens:
              Number(thresholdKey[1]) * (thresholdKey[2] === "k" ? 1000 : 1),
            prices: prices(above),
          },
        }
      : {}),
    ...(isEmpty(tiers) ? {} : { tiers }),
    ...(typeof factors === "object" ? { factors } : {}),
  };
}

function basePrices(model: string, prices: TokenPrices): BaseTokenPrices {
  const { input, output } = prices;
  if (input === undefined || output === undefined) {
    throw new Error(`model-prices.json: ${model} has no input or output price`);
  }
  return { ...prices, input, output };
}

function definedOnly(prices: TokenPrices): TokenPrices {
  return Object.fromEntries(
    Object.entries(prices).filter(([, value]) => value !== undefined),
  );
}

function isEmpty(value: object): boolean {
  return Object.keys(value).length === 0;
}
