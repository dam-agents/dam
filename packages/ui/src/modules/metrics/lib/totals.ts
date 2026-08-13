import type { TokenSpendByModel } from "api-server-api";

/** Total spend for a scope. The breakdown carries per-model rows but no total,
 *  so every surface would otherwise re-derive it. */
export const totalCostUsd = (rows: TokenSpendByModel[]): number =>
  rows.reduce((sum, row) => sum + row.costUsd, 0);
