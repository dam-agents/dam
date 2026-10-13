import { Command } from "commander";
import {
  formatSpendAmount,
  type SpendLimitView,
  type SpendStatus,
} from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { renderTable } from "../../shared/render-table.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { SpendService } from "../services/spend-service.js";

function limitRow(limit: SpendLimitView): string[] {
  const money = (micros: number) => formatSpendAmount(micros, limit.unit);
  return [
    `${limit.scope.kind} limit`,
    money(limit.amountMicros),
    String(limit.extensions),
    money(limit.effectiveMicros),
    money(limit.spentMicros),
    money(limit.leftMicros),
    limit.state,
  ];
}

function renderStatus(status: SpendStatus, subject: string): string {
  const lines = [
    `${subject} on ${status.day} (UTC). The day resets at ${status.resetsAt}.`,
    "",
  ];
  lines.push(
    status.spent.length === 0
      ? "Metered Spend today: none."
      : `Metered Spend today: ${status.spent
          .map(
            (total) =>
              `${formatSpendAmount(total.costMicros, total.unit)}` +
              (total.estimatedCalls > 0
                ? ` (${String(total.estimatedCalls)} estimated call${total.estimatedCalls === 1 ? "" : "s"})`
                : ""),
          )
          .join(", ")}.`,
    "",
  );
  if (status.limits.length === 0) {
    lines.push("No spend limit is set.");
    return `${lines.join("\n")}\n`;
  }
  return (
    lines.join("\n") +
    "\n" +
    renderTable([
      ["LIMIT", "AMOUNT", "EXTENSIONS", "EFFECTIVE", "SPENT", "LEFT", "STATE"],
      ...status.limits.map(limitRow),
    ])
  );
}

export function buildStatusCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createSpendService: (host: string) => SpendService;
}): Command {
  return new Command("status")
    .description(
      "Show today's Metered Spend and the Spend Limits, for one Agent or for you",
    )
    .argument("[agent]", "Agent Ref — name or 'agent-…' ID (optional)")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw JSON instead of the default view")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam spend status\n" +
        "  dam spend status my-agent\n" +
        "  dam spend status my-agent --json\n",
    )
    .action(
      async (
        ref: string | undefined,
        opts: { server?: string; json?: boolean },
      ) => {
        const host = await resolveActiveHost(deps, opts.server);
        const agent =
          ref === undefined
            ? undefined
            : await resolveAgentOrExit(
                deps.createAgentService(host),
                ref,
                host,
              );
        const result = await deps
          .createSpendService(host)
          .status(agent ? { agentId: agent.id } : undefined);
        exitOnServiceError(result, host);
        return writeStdoutAndExit(
          opts.json
            ? `${JSON.stringify(result.value)}\n`
            : renderStatus(
                result.value,
                agent ? agent.name : "All your Agents",
              ),
          EXIT_SUCCESS,
        );
      },
    );
}
