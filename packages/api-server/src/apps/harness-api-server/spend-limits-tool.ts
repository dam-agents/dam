import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatSpendAmount, type SpendStatus } from "api-server-api";
import { json, run } from "../../core/mcp-tool-result.js";

const DESCRIPTION = `Read today's spend limits that apply to your model calls, what you spent today and what is left. The platform measures the spend of each model call itself. Limits are per UTC day and reset at resetsAt. When a limit or the ceiling is "reached", the platform refuses your model calls, does not run your schedules and does not start your sub-agents until the day ends; for a limit, your owner can also approve more. The ceiling is the platform operator's maximum for your owner. You cannot set, clear or extend a limit. Amounts are dollars, "list $" (the list-price value of a Claude subscription), or Bobcoins.`;

function readable(status: SpendStatus) {
  return {
    day: status.day,
    resetsAt: status.resetsAt,
    limits: status.limits.map((limit) => ({
      scope: limit.scope,
      limit: formatSpendAmount(limit.amountMicros, limit.unit),
      extensions: limit.extensions,
      effective: formatSpendAmount(limit.effectiveMicros, limit.unit),
      spent: formatSpendAmount(limit.spentMicros, limit.unit),
      left: formatSpendAmount(limit.leftMicros, limit.unit),
      state: limit.state,
    })),
    ceiling: status.ceiling && {
      ceiling: formatSpendAmount(status.ceiling.amountMicros, "usd"),
      spent: formatSpendAmount(status.ceiling.spentMicros, "usd"),
      left: formatSpendAmount(
        Math.max(0, status.ceiling.amountMicros - status.ceiling.spentMicros),
        "usd",
      ),
      state: status.ceiling.state,
    },
    spentToday: status.spent.map((total) => ({
      spent: formatSpendAmount(total.costMicros, total.unit),
      estimatedCalls: total.estimatedCalls,
    })),
  };
}

export function registerSpendLimitsTool(
  server: McpServer,
  deps: { status: () => Promise<SpendStatus> },
): void {
  server.tool("describe_spend_limits", DESCRIPTION, {}, () =>
    run(async () => json(readable(await deps.status()))),
  );
}
