import { Command } from "commander";
import {
  formatSpendAmount,
  type SpendCeilingSource,
  type SpendCeilingView,
  type SpendLimitView,
  type SpendStatus,
} from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { ConnectionService } from "../../connection/index.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { renderTable } from "../../shared/render-table.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { SpendService } from "../services/spend-service.js";

const CEILING_SOURCES: Readonly<Record<SpendCeilingSource, string>> = {
  default: "the platform default",
  UserSpendLimit: "your UserSpendLimit",
};

function limitName(
  limit: SpendLimitView,
  connectionNames: ReadonlyMap<string, string>,
): string {
  const scope = limit.scope;
  switch (scope.kind) {
    case "agent":
      return "agent";
    case "owner":
      return "own (all Agents)";
    case "connection":
      return `connection ${connectionNames.get(scope.connectionId) ?? scope.connectionId}`;
  }
}

function limitRow(
  limit: SpendLimitView,
  connectionNames: ReadonlyMap<string, string>,
): string[] {
  const money = (micros: number) => formatSpendAmount(micros, limit.unit);
  return [
    limitName(limit, connectionNames),
    money(limit.amountMicros),
    String(limit.extensions),
    money(limit.effectiveMicros),
    money(limit.spentMicros),
    money(limit.leftMicros),
    limit.state,
  ];
}

function ceilingLine(ceiling: SpendCeilingView | null): string {
  if (ceiling === null) return "Spend Ceiling: off.";
  return (
    `Spend Ceiling: ${formatSpendAmount(ceiling.amountMicros, "usd")} per UTC day, from ${CEILING_SOURCES[ceiling.source]}. ` +
    `Spent ${formatSpendAmount(ceiling.spentMicros, "usd")}, ${ceiling.state}.`
  );
}

function renderStatus(
  status: SpendStatus,
  subject: string,
  connectionNames: ReadonlyMap<string, string>,
): string {
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
    ceilingLine(status.ceiling),
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
      ...status.limits.map((limit) => limitRow(limit, connectionNames)),
    ])
  );
}

async function connectionNamesOf(
  status: SpendStatus,
  connections: ConnectionService,
): Promise<ReadonlyMap<string, string>> {
  if (!status.limits.some((limit) => limit.scope.kind === "connection")) {
    return new Map();
  }
  const listed = await connections.list();
  return listed.ok
    ? new Map(listed.value.map((c) => [c.id, c.name]))
    : new Map();
}

export function buildStatusCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createConnectionService: (host: string) => ConnectionService;
  createSpendService: (host: string) => SpendService;
}): Command {
  return new Command("status")
    .description(
      "Show today's Metered Spend, the Spend Limits and the Spend Ceiling, for one Agent or for you",
    )
    .argument("[agent]", "Agent Ref — name or 'agent-…' ID (optional)")
    .option("--me", "show your own limit and your ceiling (the default)")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw JSON instead of the default view")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam spend status --me\n" +
        "  dam spend status my-agent\n" +
        "  dam spend status my-agent --json\n",
    )
    .action(
      async (
        ref: string | undefined,
        opts: { me?: boolean; server?: string; json?: boolean },
      ) => {
        if (opts.me && ref !== undefined) {
          process.stderr.write("error: --me takes no agent\n");
          process.exit(EXIT_INVALID_INPUT);
        }
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
        if (opts.json) {
          return writeStdoutAndExit(
            `${JSON.stringify(result.value)}\n`,
            EXIT_SUCCESS,
          );
        }
        return writeStdoutAndExit(
          renderStatus(
            result.value,
            agent ? agent.name : "All your Agents",
            await connectionNamesOf(
              result.value,
              deps.createConnectionService(host),
            ),
          ),
          EXIT_SUCCESS,
        );
      },
    );
}
