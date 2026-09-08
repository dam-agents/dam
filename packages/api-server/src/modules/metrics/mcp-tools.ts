import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { json, run } from "../../core/mcp-tool-result.js";
import { usageSummaryInputSchema } from "api-server-api";
import type { AgentUsageSummaryService } from "./services/agent-usage-summary.js";

export function registerUsageSummaryTool(
  server: McpServer,
  deps: {
    agentId: string;
    usageSummary: AgentUsageSummaryService;
  },
): void {
  server.tool(
    "get_usage_summary",
    "Report this agent's own LLM usage from the platform's telemetry: total cost in USD, per-model token/cost split, and session count over the requested window. This is the platform's own attributed accounting — always prefer it over estimating cost or counting tokens out of transcripts. When it returns available=false, this deployment does not measure usage; report cost as not measured instead of estimating.",
    usageSummaryInputSchema.shape,
    ({ days }) =>
      run(async () =>
        json(await deps.usageSummary.summary(deps.agentId, days)),
      ),
  );
}
