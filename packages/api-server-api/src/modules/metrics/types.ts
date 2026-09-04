import type { z } from "zod";
import type { SessionCategory } from "../sessions/types.js";
import type {
  metricsOverviewInputSchema,
  metricsSpendBreakdownInputSchema,
  metricsSpendInputSchema,
} from "./schemas.js";

export type MetricsQuery = z.infer<typeof metricsOverviewInputSchema>;
export type MetricsSpendQuery = z.infer<typeof metricsSpendInputSchema>;
export type MetricsSpendBreakdownQuery = z.infer<
  typeof metricsSpendBreakdownInputSchema
>;

export interface CreditSpend {
  unit: string;
  amount: number;
}

export interface TokenSpendByModel {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  credits: CreditSpend[];
  durationMs: number;
}

export interface SpendByAgent {
  agentId: string;
  agentName: string;
  costUsd: number;
  credits: CreditSpend[];
}

export type SpendCategory = SessionCategory | "unknown";

export interface SpendBySessionType {
  category: SpendCategory;
  costUsd: number;
  credits: CreditSpend[];
}

export interface SpendByDay {
  day: string;
  costUsd: number;
  credits: CreditSpend[];
}

export interface SessionRuntime {
  sessionId: string;
  agentId: string;
  calls: number;
  totalDurationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  credits: CreditSpend[];
  firstAt: string;
  lastAt: string;
}

export interface CallContext {
  at: string;
  requestId: string;
  agentId: string;
  model: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  contextTokens: number;
  costUsd: number;
  credits: CreditSpend[];
  durationMs: number;
}

export interface MetricsOverview {
  tokenSpendByModel: TokenSpendByModel[];
  runtimeBySession: SessionRuntime[];
  contextPerCall: CallContext[];
}

export interface SpendBreakdown {
  byModel: TokenSpendByModel[];
  byAgent: SpendByAgent[];
  byDay: SpendByDay[];
  bySessionType: SpendBySessionType[];
}

export interface MetricsService {
  overview(query: MetricsQuery): Promise<MetricsOverview>;
  spendBreakdown(query: MetricsSpendBreakdownQuery): Promise<SpendBreakdown>;
}
