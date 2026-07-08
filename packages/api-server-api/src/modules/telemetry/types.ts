import type { z } from "zod";
import type { telemetryOverviewInputSchema } from "./schemas.js";

export type TelemetryQuery = z.infer<typeof telemetryOverviewInputSchema>;

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

/** All telemetry stats for the window in one shape: per-model token spend,
 *  per-session runtime, and the most recent per-call context rows. */
export interface TelemetryOverview {
  tokenSpendByModel: TokenSpendByModel[];
  runtimeBySession: SessionRuntime[];
  contextPerCall: CallContext[];
}

/** Read-only, owner-scoped view over agent telemetry stored in ClickHouse.
 *  Returns data only for agents the caller owns. */
export interface TelemetryService {
  overview(query: TelemetryQuery): Promise<TelemetryOverview>;
}
