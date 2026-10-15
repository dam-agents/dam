import type { TokenSpendByModel } from "api-server-api";

export const totalCostUsd = (rows: TokenSpendByModel[]): number =>
  rows.reduce((sum, row) => sum + row.costUsd, 0);

export const uncountedCalls = (rows: { uncountedCalls: number }[]): number =>
  rows.reduce((sum, row) => sum + row.uncountedCalls, 0);
