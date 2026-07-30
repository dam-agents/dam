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

/** Token counts + cost rolled up per model, over the window. */
export interface TokenSpendByModel {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

/** Spend rolled up per agent over the window. Grouped on the trusted,
 *  gateway-stamped agent id; `agentName` is the latest `platform.agent.name`
 *  the telemetry carried in range, so a since-deleted agent keeps a readable
 *  name. The name is display-only — the id stays the key. */
export interface SpendByAgent {
  agentId: string;
  agentName: string;
  costUsd: number;
}

/** Spend for one local calendar day. The response is sparse — only days that
 *  carried spend appear, `day` is a `YYYY-MM-DD` wall-clock date in the
 *  client's timezone. Zero-filling the rest of the month is the client's job. */
export interface SpendByDay {
  day: string;
  costUsd: number;
}

/** One row per Claude Code session: API-call count, summed request latency,
 *  and token/cost totals. The sessionId is the ACP session id — Claude Code
 *  reuses it as its OTel `session.id`, so it joins with the UI's session list.
 *  Child harness runs are folded into their root session via shared trace. */
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

/** One row per LLM API call. `contextTokens` = input + cache-read +
 *  cache-creation — the tokens fed into the model's context that call. */
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

/** All metrics stats for the window in one shape: per-model token spend,
 *  per-session runtime, and the most recent per-call context rows. */
export interface MetricsOverview {
  tokenSpendByModel: TokenSpendByModel[];
  runtimeBySession: SessionRuntime[];
  contextPerCall: CallContext[];
}

/** The whole Usage tab in one shape: per-model, per-agent, and per-day spend
 *  over the same [from, to) range, resolved under a single ownership scope. */
export interface SpendBreakdown {
  byModel: TokenSpendByModel[];
  byAgent: SpendByAgent[];
  byDay: SpendByDay[];
}

/** Read-only, owner-scoped view over agent metrics stored in ClickHouse.
 *  Returns data only for agents the caller owns. */
export interface MetricsService {
  overview(query: MetricsQuery): Promise<MetricsOverview>;
  /** The whole Usage tab in one read: per-model, per-agent, and per-day spend
   *  over [from, to), across all of the caller's agents — deleted ones included,
   *  so history doesn't shrink retroactively. Per-agent rows are sorted highest
   *  cost first; per-day rows are sparse (only days with spend) and bucketed
   *  into the client's local calendar days. Ownership resolves once for all
   *  three rollups. */
  spendBreakdown(query: MetricsSpendBreakdownQuery): Promise<SpendBreakdown>;
}
