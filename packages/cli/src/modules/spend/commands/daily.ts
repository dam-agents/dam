import { Command } from "commander";
import {
  SPEND_DAILY_MAX_DAYS,
  spendDailyInputSchema,
  type SpendDailyRow,
  type SpendUnit,
} from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { renderTable } from "../../shared/render-table.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { SpendService } from "../services/spend-service.js";

const DEFAULT_DAYS = 7;

const SPEND_TEXT: Readonly<Record<SpendUnit, (amount: number) => string>> = {
  usd: (amount) => `$${amount.toFixed(4)}`,
  usd_list: (amount) => `$${amount.toFixed(4)} list`,
  bobcoin: (amount) => `${amount.toFixed(6)} Bobcoins`,
  free: () => "free",
};

function utcDaysBack(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function buildDailyCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createSpendService: (host: string) => SpendService;
}): Command {
  return new Command("daily")
    .description(
      "Show the Metered Spend per UTC day, for one Agent or for all your Agents",
    )
    .argument("[agent]", "Agent Ref — name or 'agent-…' ID (optional)")
    .option(
      "--days <n>",
      `UTC days up to today (default ${DEFAULT_DAYS}, max ${SPEND_DAILY_MAX_DAYS})`,
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw JSON instead of the default table")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam spend daily\n" +
        "  dam spend daily my-agent --days 30\n" +
        "  dam spend daily my-agent --json\n",
    )
    .action(
      async (
        ref: string | undefined,
        opts: { days?: string; server?: string; json?: boolean },
      ) => {
        const days = opts.days === undefined ? DEFAULT_DAYS : Number(opts.days);
        if (!Number.isInteger(days) || days < 1) {
          process.stderr.write(
            "error: --days must be a whole number of 1 or more\n",
          );
          process.exit(EXIT_INVALID_INPUT);
        }
        const window = spendDailyInputSchema.safeParse(utcDaysBack(days));
        if (!window.success) {
          const msg = window.error.issues[0]?.message ?? "invalid --days";
          process.stderr.write(`error: --days: ${msg}\n`);
          process.exit(EXIT_INVALID_INPUT);
        }

        const host = await resolveActiveHost(deps, opts.server);
        const agents = deps.createAgentService(host);
        const agent =
          ref === undefined
            ? undefined
            : await resolveAgentOrExit(agents, ref, host);
        const result = await deps
          .createSpendService(host)
          .daily({ ...window.data, agentId: agent?.id });
        exitOnServiceError(result, host);

        if (opts.json) {
          return writeStdoutAndExit(
            `${JSON.stringify(result.value)}\n`,
            EXIT_SUCCESS,
          );
        }
        if (result.value.length === 0) {
          process.stderr.write(
            `No Metered Spend ${agent ? `for ${agent.name} ` : ""}in the last ${days} UTC day(s).\n`,
          );
          process.exit(EXIT_SUCCESS);
        }

        const listed = agent ? { ok: false as const } : await agents.list();
        const names = new Map<string, string>(
          agent
            ? [[agent.id, agent.name]]
            : listed.ok
              ? listed.value.map((a) => [a.id, a.name ?? a.id])
              : [],
        );
        const rows = result.value.map((r: SpendDailyRow) => [
          r.day,
          names.get(r.agentId) ?? r.agentId,
          SPEND_TEXT[r.unit](r.costMicros / 1_000_000),
          String(r.calls),
          String(r.estimatedCalls),
          r.uncachedInputTokens.toLocaleString(),
          r.outputTokens.toLocaleString(),
          r.cacheReadTokens.toLocaleString(),
          (r.cacheWrite5mTokens + r.cacheWrite1hTokens).toLocaleString(),
        ]);
        return writeStdoutAndExit(
          renderTable([
            [
              "DAY",
              "AGENT",
              "SPEND",
              "CALLS",
              "ESTIMATED",
              "INPUT",
              "OUTPUT",
              "CACHE R",
              "CACHE W",
            ],
            ...rows,
          ]),
          EXIT_SUCCESS,
        );
      },
    );
}
