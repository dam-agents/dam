import type { PriceBook } from "./domain/prices.js";
import { loadAnthropicPriceTable } from "./infrastructure/anthropic-price-table.js";
import {
  operatorPrices,
  type OperatorPriceInput,
} from "./infrastructure/operator-prices.js";

export function composePriceBook(deps: {
  priceOverrides: readonly OperatorPriceInput[];
}): PriceBook {
  return {
    operatorPrices: operatorPrices(deps.priceOverrides),
    anthropicTable: loadAnthropicPriceTable(),
  };
}
