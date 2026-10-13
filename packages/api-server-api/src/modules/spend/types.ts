import type { z } from "zod";
import type {
  spendDailyInputSchema,
  spendLimitScopeSchema,
  spendLimitStateSchema,
  spendSetLimitInputSchema,
  spendStatusInputSchema,
  spendUnitSchema,
} from "./schemas.js";

export type SpendUnit = z.infer<typeof spendUnitSchema>;
export type SpendDailyInput = z.infer<typeof spendDailyInputSchema>;
export type SpendLimitScope = z.infer<typeof spendLimitScopeSchema>;
export type SpendLimitState = z.infer<typeof spendLimitStateSchema>;
export type SpendStatusInput = z.infer<typeof spendStatusInputSchema>;
export type SpendSetLimitInput = z.infer<typeof spendSetLimitInputSchema>;

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

export interface SpendLimitView {
  id: string;
  scope: SpendLimitScope;
  unit: SpendUnit;
  amountMicros: number;
  extensions: number;
  effectiveMicros: number;
  spentMicros: number;
  leftMicros: number;
  state: SpendLimitState;
}

export interface SpendTotal {
  unit: SpendUnit;
  costMicros: number;
  estimatedCalls: number;
}

export interface SpendStatus {
  day: string;
  resetsAt: string;
  limits: SpendLimitView[];
  spent: SpendTotal[];
}

export interface SpendService {
  daily(input: SpendDailyInput): Promise<SpendDailyRow[]>;
  status(input: SpendStatusInput): Promise<SpendStatus>;
  setLimit(input: SpendSetLimitInput): Promise<void>;
}
