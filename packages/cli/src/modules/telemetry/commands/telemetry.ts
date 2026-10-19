import { Command } from "commander";
import {
  formatSpendAmount,
  spendTurnWindows,
  TELEMETRY_DEFAULT_SINCE_HOURS,
  TELEMETRY_MAX_SINCE_HOURS,
  type SpendAmount,
  type TurnSummary,
} from "api-server-api";

import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { ok, type Result } from "../../../result.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";
import type { SpendService } from "../../spend/index.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { renderTable } from "../../shared/render-table.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type {
  ExportOutcome,
  ExportRequest,
} from "../infrastructure/export-client.js";
import type { TelemetryService } from "../services/telemetry-service.js";

const DEFAULT_SINCE_HOURS = TELEMETRY_DEFAULT_SINCE_HOURS;
const EXPORT_SINCE_HOURS = TELEMETRY_MAX_SINCE_HOURS;

class InvalidSinceError extends Error {}

/**
 * UNIT_BOUNDARY_DESCRIPTION: read the shared `--since` option once. An omitted
 * value takes the command's default; a value that is not a positive number of
 * hours within the store's retention is refused here, with the ceiling the help
 * text states, rather than reaching the wire where the server would reject it
 * with a less legible error.
 */
function sinceHoursOf(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const hours = Number(raw);
  if (
    !Number.isFinite(hours) ||
    hours <= 0 ||
    hours > TELEMETRY_MAX_SINCE_HOURS
  ) {
    throw new InvalidSinceError(
      `--since must be a positive number of hours up to ${TELEMETRY_MAX_SINCE_HOURS}, got "${raw}"`,
    );
  }
  return hours;
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function costText(amounts: readonly SpendAmount[] | undefined): string {
  const shown = (amounts ?? []).filter(
    (a) => a.unit !== "free" && a.costMicros > 0,
  );
  if (shown.length === 0) return "—";
  return shown.map((a) => formatSpendAmount(a.costMicros, a.unit)).join(" + ");
}

async function turnSpendOf(
  spend: SpendService,
  query: { agentId: string; sessionId: string },
  turns: readonly TurnSummary[],
): Promise<
  Result<Map<string, SpendAmount[]>, TransportError | AuthRequiredError>
> {
  const windows = spendTurnWindows(turns);
  if (windows.length === 0) return ok(new Map());
  const result = await spend.turns({
    ...query,
    windows: windows.map(({ from, to }) => ({ from, to })),
  });
  if (!result.ok) return result;
  return ok(
    new Map(
      windows.map((w, i) => [
        w.turn.turnId,
        result.value.windows[i]?.amounts ?? [],
      ]),
    ),
  );
}

interface Deps {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createSpendService: (host: string) => SpendService;
  createTelemetryService: (host: string) => TelemetryService;
  createExportClient: (host: string) => {
    run: (req: ExportRequest) => Promise<ExportOutcome>;
  };
}

async function hostAndAgent(deps: Deps, ref: string, server?: string) {
  const host = await resolveActiveHost(deps, server);
  const agent = await resolveAgentOrExit(
    deps.createAgentService(host),
    ref,
    host,
  );
  return { host, agent };
}

export function buildTelemetryCommand(deps: Deps): Command {
  const telemetry = new Command("telemetry").description(
    "Read an Agent's session telemetry — the turns it ran, and the records behind them",
  );

  telemetry
    .command("show", { isDefault: true })
    .description(
      "List the turns a session ran, with their shape and the cost the platform measured",
    )
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .requiredOption("--session <id>", "the session to read")
    .option(
      "--since <hours>",
      `lookback window in hours (max ${TELEMETRY_MAX_SINCE_HOURS}; default ${DEFAULT_SINCE_HOURS})`,
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw JSON instead of the default report")
    .addHelpText(
      "after",
      "\nThe cost is the spend the platform measured for this Agent's own calls that started in each turn; sub-agents' calls are not in it.\n" +
        "\nExamples:\n  dam telemetry my-agent --session sess-abc123\n  dam telemetry my-agent --session sess-abc123 --since 168 --json\n",
    )
    .action(
      async (
        ref: string,
        opts: {
          session: string;
          since?: string;
          server?: string;
          json?: boolean;
        },
      ) => {
        const { host, agent } = await hostAndAgent(deps, ref, opts.server);
        let sinceHours: number;
        try {
          sinceHours = sinceHoursOf(opts.since, DEFAULT_SINCE_HOURS);
        } catch (err) {
          process.stderr.write(`${(err as Error).message}\n`);
          return process.exit(EXIT_INVALID_INPUT);
        }

        const result = await deps.createTelemetryService(host).turns({
          agentId: agent.id,
          sessionId: opts.session,
          sinceHours,
          limit: 100,
          spanLimit: 1000,
          logLimit: 1000,
        });
        exitOnServiceError(result, host);
        if (!result.value.available) {
          process.stderr.write(`${result.value.reason}\n`);
          process.exit(EXIT_RUNTIME_FAILURE);
        }
        const { turns } = result.value;
        const spend = await turnSpendOf(
          deps.createSpendService(host),
          { agentId: agent.id, sessionId: opts.session },
          turns,
        );
        exitOnServiceError(spend, host);

        if (opts.json) {
          return writeStdoutAndExit(
            `${JSON.stringify({
              agentId: agent.id,
              sessionId: opts.session,
              sinceHours,
              turns: turns.map((t) => ({
                ...t,
                spend: spend.value.get(t.turnId) ?? null,
              })),
            })}\n`,
            EXIT_SUCCESS,
          );
        }

        if (turns.length === 0) {
          process.stderr.write(
            `No telemetry for ${agent.name} in session ${opts.session} over the last ${sinceHours}h.\n`,
          );
          return process.exit(EXIT_SUCCESS);
        }

        return writeStdoutAndExit(
          renderTable([
            ["started", "duration", "calls", "spans", "records", "cost"],
            ...turns.map((t) => [
              t.startedAt,
              secs(t.durationMs),
              String(t.calls),
              String(t.spanCount),
              String(t.recordCount),
              costText(spend.value.get(t.turnId)),
            ]),
          ]),
          EXIT_SUCCESS,
        );
      },
    );

  telemetry
    .command("export")
    .description(
      "Write a session's telemetry to stdout as newline-delimited JSON",
    )
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .option("--session <id>", "narrow to one session")
    .option("--signal <signal>", "'logs' or 'spans' (default: logs)", "logs")
    .option(
      "--since <hours>",
      `lookback window in hours (max ${TELEMETRY_MAX_SINCE_HOURS}; default ${EXPORT_SINCE_HOURS})`,
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .addHelpText(
      "after",
      "\nExamples:\n  dam telemetry export my-agent --session sess-abc123 > telemetry.ndjson\n  dam telemetry export my-agent --signal spans | jq -s 'group_by(.name)'\n",
    )
    .action(
      async (
        ref: string,
        opts: {
          session?: string;
          signal?: string;
          since?: string;
          server?: string;
        },
      ) => {
        if (opts.signal !== "logs" && opts.signal !== "spans") {
          process.stderr.write("--signal must be 'logs' or 'spans'\n");
          return process.exit(EXIT_INVALID_INPUT);
        }
        const { host, agent } = await hostAndAgent(deps, ref, opts.server);
        let sinceHours: number;
        try {
          sinceHours = sinceHoursOf(opts.since, EXPORT_SINCE_HOURS);
        } catch (err) {
          process.stderr.write(`${(err as Error).message}\n`);
          return process.exit(EXIT_INVALID_INPUT);
        }

        const outcome = await deps.createExportClient(host).run({
          agentId: agent.id,
          ...(opts.session === undefined ? {} : { sessionId: opts.session }),
          signal: opts.signal,
          sinceHours,
        });

        if (outcome.kind === "failed") {
          process.stderr.write(
            `Export failed (${outcome.status}): ${outcome.reason}\n`,
          );
          return process.exit(EXIT_RUNTIME_FAILURE);
        }
        if (outcome.truncated) {
          process.stderr.write(
            "Export hit the row cap — narrow --since or --session for the rest.\n",
          );
        }
        return writeStdoutAndExit(outcome.body, EXIT_SUCCESS);
      },
    );

  return telemetry;
}
