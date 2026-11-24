import vendored from "./model-prices.json" with { type: "json" };
import type { PriceTable } from "./price-table.js";

export const VENDORED_PRICE_TABLE: PriceTable = {
  source: vendored.source,
  models: vendored.models,
} as PriceTable;

export const VENDORED_ANTHROPIC_PRICES: {
  readonly commit: string;
  readonly models: Readonly<Record<string, unknown>>;
} = { commit: vendored.source.commit, models: vendored.anthropic };
