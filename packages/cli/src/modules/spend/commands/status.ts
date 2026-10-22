import { Command } from "commander";
import {
  formatLocalResetTime,
  formatSpendAmount,
  type SpendBindingKind,
  type SpendCeilingSource,
  type SpendCeilingView,
  type SpendLimitState,
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
  UserSpendLimit: "set for you by your operator",
};

const STATE_LABELS: Readonly<Record<SpendLimitState, string>> = {
  ok: "ok",
  warn: "80% or more used",
  reached: "reached",
};

const UNITS_NOTE =
  "The Agent spend limit, your spend limit (all Agents) and the spend ceiling count paid API spend in US dollars only. The Claude subscription and Bob count only in their Connection limits, for one Agent or for all your Agents.";

function limitName(
  limit: SpendLimitView,
  connectionNames: ReadonlyMap<string, string>,
): string {
  const scope = limit.scope;
  switch (scope.kind) {
    case "agent":
      return "Agent spend limit";
    case "owner":
      return "Your spend limit (all Agents)";
    case "connection":
      return `${connectionNames.get(scope.connectionId) ?? scope.connectionId} spend limit`;
    case "owner-connection":
      return `Your ${connectionNames.get(scope.connectionId) ?? scope.connectionId} spend limit (all Agents)`;
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
    STATE_LABELS[limit.state],
  ];
}

function ceilingLine(ceiling: SpendCeilingView | null): string {
  if (ceiling === null) return "Spend ceiling: none.";
  return (
    `Spend ceiling (${CEILING_SOURCES[ceiling.source]}): ${formatSpendAmount(ceiling.spentMicros, "usd")} of ` +
    `${formatSpendAmount(ceiling.amountMicros, "usd")} today, ${STATE_LABELS[ceiling.state]}.`
  );
}

const BINDING_NAMES: Readonly<Record<SpendBindingKind, string>> = {
  agent: "the Agent spend limit",
  owner: "your spend limit (all Agents)",
  connection: "the Agent's limit on it",
  "owner-connection": "your limit for all Agents on it",
  ceiling: "the spend ceiling",
};

function stopsFirstLines(status: SpendStatus): string[] {
  return status.binding.map(
    (binding) =>
      `Stops first on ${binding.connectionName ?? "all paid providers"}: ` +
      `${BINDING_NAMES[binding.stopsFirst.kind]}, ${formatSpendAmount(binding.leftMicros, binding.unit)} left.`,
  );
}

function renderStatus(
  status: SpendStatus,
  subject: string,
  connectionNames: ReadonlyMap<string, string>,
): string {
  const lines = [
    `${subject} on ${status.day} (UTC). The day resets at ${formatLocalResetTime(status.resetsAt)}.`,
    "",
  ];
  lines.push(
    status.spent.length === 0
      ? "Spend today: none."
      : `Spend today: ${status.spent
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
    lines.push("No spend limit is set.", "", UNITS_NOTE);
    return `${lines.join("\n")}\n`;
  }
  return (
    lines.join("\n") +
    "\n" +
    renderTable([
      [
        "LIMIT",
        "AMOUNT",
        "CONTINUED",
        "TODAY'S LIMIT",
        "SPENT",
        "LEFT",
        "STATE",
      ],
      ...status.limits.map((limit) => limitRow(limit, connectionNames)),
    ]) +
    (status.binding.length > 0
      ? `\n${stopsFirstLines(status).join("\n")}\n`
      : "") +
    `\n${UNITS_NOTE}\n`
  );
}

async function connectionNamesOf(
  status: SpendStatus,
  connections: ConnectionService,
): Promise<ReadonlyMap<string, string>> {
  if (!status.limits.some((limit) => "connectionId" in limit.scope)) {
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
      "Show today's spend that the platform measured, the spend limits and the spend ceiling, for one Agent or for you",
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
