import type { z } from "zod";
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

export interface TokenSpendByModel {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  durationMs: number;
}

export interface SpendByAgent {
  agentId: string;
  agentName: string;
  costUsd: number;
}

export interface SpendByDay {
  day: string;
  costUsd: number;
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
}

export interface MetricsService {
  overview(query: MetricsQuery): Promise<MetricsOverview>;
  spendBreakdown(query: MetricsSpendBreakdownQuery): Promise<SpendBreakdown>;
}
