import vendored from "./model-prices.json" with { type: "json" };
import type { PriceTable } from "../domain/price-table.js";

export const VENDORED_PRICE_TABLE: PriceTable = vendored as PriceTable;
