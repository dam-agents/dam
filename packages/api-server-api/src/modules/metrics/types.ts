import type { z } from "zod";
import type {
  metricsOverviewInputSchema,
  metricsSpendByDayInputSchema,
  metricsSpendInputSchema,
} from "./schemas.js";

export type MetricsQuery = z.infer<typeof metricsOverviewInputSchema>;
export type MetricsSpendQuery = z.infer<typeof metricsSpendInputSchema>;
export type MetricsSpendByDayQuery = z.infer<
  typeof metricsSpendByDayInputSchema
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

/** LLM spend rolled up per owning agent over the window, sorted by cost
 *  descending. Grouped on the gateway-stamped `platform.agent.id` (the trusted
 *  key); `agentName` is the latest telemetry-observed `platform.agent.name`, so
 *  a deleted agent still shows its last known name. The name is display-only. */
export interface SpendByAgent {
  agentId: string;
  agentName: string;
  costUsd: number;
}

/** LLM spend for one local calendar day. Sparse: the reader emits a row only
 *  for days that have Spend, so the caller (the client) zero-fills the missing
 *  days itself. `day` is `YYYY-MM-DD` in the query's timezone. */
export interface SpendByDay {
  day: string;
  costUsd: number;
}

/** One row per Claude Code session: API-call count, summed request latency,
 *  and token/cost totals. The sessionId is the ACP session id — Claude Code
 *  reuses it as its OTel `session.id`, so it joins with the UI's session list. */
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

/** Read-only, owner-scoped view over agent metrics stored in ClickHouse.
 *  Returns data only for agents the caller owns. */
export interface MetricsService {
  overview(query: MetricsQuery): Promise<MetricsOverview>;
  /** Per-model spend over [from, to), across all of the caller's agents —
   *  deleted ones included, so history doesn't shrink retroactively. */
  spend(query: MetricsSpendQuery): Promise<TokenSpendByModel[]>;
  /** Spend over [from, to) rolled up per owning agent, sorted by cost
   *  descending. Same range and ownership scoping as `spend` (deleted agents
   *  included); grouped on the trusted agent id with a telemetry-derived name. */
  spendByAgent(query: MetricsSpendQuery): Promise<SpendByAgent[]>;
  /** Spend over [from, to) bucketed into local calendar days in the query's
   *  timezone. Same ownership scoping as `spend`. Sparse — one row per day that
   *  has Spend, days without it omitted; the client zero-fills the calendar. */
  spendByDay(query: MetricsSpendByDayQuery): Promise<SpendByDay[]>;
}
