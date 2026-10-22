import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatSpendAmount, type SpendStatus } from "api-server-api";
import { json, run } from "../../core/mcp-tool-result.js";

const DESCRIPTION = `Read the spend limits that apply to your model calls today, what you spent today and what is left. The platform measures the spend of each model call itself, in your gateway. A day is one UTC day, and limits reset at resetsAt. Amounts are US dollars, "subscription value" (what calls on a Claude subscription would cost at Anthropic's API prices), or Bobcoins. Your agent limit, your owner's limit for all agents and the ceiling count only US dollars. A Connection limit counts that Connection's unit, for your calls ("connection") or for the calls of all your owner's agents ("owner-connection"), sub-agents included. When a limit or the ceiling is "reached", the platform refuses the model calls that it counts, does not run your schedules and does not start your sub-agents until the day ends; your owner can continue a limit, but not the ceiling. The ceiling is the platform operator's maximum for your owner. You cannot set, clear or continue a limit.`;

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
