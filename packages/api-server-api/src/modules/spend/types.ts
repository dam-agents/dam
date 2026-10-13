import type { z } from "zod";
import type { spendDailyInputSchema, spendUnitSchema } from "./schemas.js";

export type SpendUnit = z.infer<typeof spendUnitSchema>;
export type SpendDailyInput = z.infer<typeof spendDailyInputSchema>;

export interface SpendDailyRow {
  day: string;
  agentId: string;
  unit: SpendUnit;
  costMicros: number;
  calls: number;
  estimatedCalls: number;
  refusedCalls: number;
  uncachedInputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  webSearches: number;
}

export interface SpendService {
  daily(input: SpendDailyInput): Promise<SpendDailyRow[]>;
}
