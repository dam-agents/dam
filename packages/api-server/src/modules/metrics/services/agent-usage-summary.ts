import type { TokenSpendByModel } from "api-server-api";
import type { MetricsReader } from "./metrics-service.js";

export type AgentUsageSummaryResult =
  | {
      available: true;
      windowDays: number;
      totalCostUsd: number;
      sessionCount: number;
      byModel: TokenSpendByModel[];
    }
  | { available: false; reason: string };

export interface AgentUsageSummaryService {
  summary(agentId: string, days: number): Promise<AgentUsageSummaryResult>;
}

export function createAgentUsageSummary(deps: {
  reader: MetricsReader;
}): AgentUsageSummaryService {
  return {
    async summary(agentId, days) {
      const window = { hours: days * 24 };
      const [byModel, sessions] = await Promise.all([
        deps.reader.tokenSpendByModel([agentId], window),
        deps.reader.runtimeBySession([agentId], window),
      ]);
      const totalCostUsd = byModel.reduce((sum, row) => sum + row.costUsd, 0);
      return {
        available: true,
        windowDays: days,
        totalCostUsd,
        sessionCount: sessions.length,
        byModel,
      };
    },
  };
}

export function createUnavailableAgentUsageSummary(): AgentUsageSummaryService {
  return {
    async summary() {
      return {
        available: false,
        reason:
          "The telemetry backend is not enabled on this deployment, so cost and token usage are not measured here.",
      };
    },
  };
}
