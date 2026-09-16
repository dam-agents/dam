import { Command } from "commander";
import type { AgentService } from "../../agent/index.js";
import { createAgentResolver } from "../../agent/index.js";
import {
  exitCodeForResolveError,
  printResolveError,
} from "../../agent/commands/errors.js";
import type { TokenProvider } from "../../auth/index.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { renderTable } from "../../shared/render-table.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { printServiceError } from "../../shared/trpc/print.js";
import type {
  ExportOutcome,
  ExportRequest,
} from "../infrastructure/export-client.js";
import type { TelemetryService } from "../services/telemetry-service.js";

const DEFAULT_SINCE_HOURS = 24;
const EXPORT_SINCE_HOURS = 24 * 30;

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const usd = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);

interface Deps {
  compatService: CompatService;
  configService: ConfigService;
  tokenProvider: TokenProvider;
  createAgentService: (host: string) => AgentService;
  createTelemetryService: (host: string) => TelemetryService;
  createExportClient: (host: string) => {
    run: (req: ExportRequest) => Promise<ExportOutcome>;
  };
}

async function hostAndAgent(deps: Deps, ref: string, server?: string) {
  const host = await resolveActiveHost(deps, {
    flag: server ? { server } : undefined,
    exitCodes: {
      runtimeFailure: EXIT_RUNTIME_FAILURE,
      belowFloor: EXIT_BELOW_FLOOR,
    },
  });
  const resolved = await createAgentResolver({
    agentService: deps.createAgentService(host),
  }).resolve(ref);
  if (!resolved.ok) {
    printResolveError(resolved.error, host);
    process.exit(exitCodeForResolveError(resolved.error));
  }
  return { host, agent: resolved.value };
}

export function buildTelemetryCommand(deps: Deps): Command {
  const telemetry = new Command("telemetry").description(
    "Read an Agent's session telemetry — the turns it ran, and the records behind them",
  );

  telemetry
    .command("show", { isDefault: true })
    .description("List the turns a session ran, with their cost and shape")
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .requiredOption("--session <id>", "the session to read")
    .option(
      "--since <hours>",
      `lookback window in hours (max 720; default ${DEFAULT_SINCE_HOURS})`,
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw JSON instead of the default report")
    .addHelpText(
      "after",
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
        const sinceHours = opts.since
          ? Number(opts.since)
          : DEFAULT_SINCE_HOURS;

        const result = await deps.createTelemetryService(host).turns({
          agentId: agent.id,
          sessionId: opts.session,
          sinceHours,
          limit: 100,
          spanLimit: 1000,
          logLimit: 1000,
        });
        if (!result.ok) {
          printServiceError(result.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }
        if (!result.value.available) {
          process.stderr.write(`${result.value.reason}\n`);
          process.exit(EXIT_RUNTIME_FAILURE);
        }
        const { turns } = result.value;

        if (opts.json) {
          return writeStdoutAndExit(
            `${JSON.stringify({
              agentId: agent.id,
              sessionId: opts.session,
              sinceHours,
              turns,
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
              t.costUsd > 0 ? usd(t.costUsd) : "—",
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
      `lookback window in hours (max 720; default ${EXPORT_SINCE_HOURS})`,
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
          return process.exit(EXIT_RUNTIME_FAILURE);
        }
        const { host, agent } = await hostAndAgent(deps, ref, opts.server);

        const outcome = await deps.createExportClient(host).run({
          agentId: agent.id,
          ...(opts.session === undefined ? {} : { sessionId: opts.session }),
          signal: opts.signal,
          sinceHours: opts.since ? Number(opts.since) : EXPORT_SINCE_HOURS,
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
