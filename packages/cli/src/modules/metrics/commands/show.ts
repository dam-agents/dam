import { Command } from "commander";
import {
  METRICS_MAX_LIMIT,
  METRICS_MAX_SINCE_HOURS,
  SPEND_SESSIONS_MAX,
} from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import type { TokenProvider } from "../../auth/index.js";
import type { SessionsPort } from "../../chat/services/sessions-service.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { renderFittedTable, renderTable } from "../../shared/render-table.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import {
  callCostText,
  formatAt,
  formatDayWindow,
  hourWindow,
  NO_CALL_TELEMETRY,
  readWindowLabel,
  spendText,
  spendWindow,
} from "../domain/spend-window.js";
import type { MetricsService } from "../services/metrics-service.js";

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

const wholeNumberUpTo = (raw: string, max: number): number | null => {
  const n = /^\d+$/.test(raw) ? Number(raw) : 0;
  return n >= 1 && n <= max ? n : null;
};

export function buildMetricsCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  tokenProvider: TokenProvider;
  createAgentService: (host: string) => AgentService;
  createSessionsPort: (host: string, token: string) => SessionsPort;
  createMetricsService: (host: string) => MetricsService;
}): Command {
  return new Command("metrics")
    .description(
      "Show an Agent's measured spend — by model and by session — and its recent calls",
    )
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--since <hours>",
      `lookback window in hours; spend older than 30 days counts whole UTC days (max ${METRICS_MAX_SINCE_HOURS}; default: every measured day)`,
    )
    .option("--session <id>", "narrow to one session")
    .option(
      "--limit <n>",
      `max recent calls to include (default 100, max ${METRICS_MAX_LIMIT})`,
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw JSON instead of the default report")
    .addHelpText(
      "after",
      "\nExamples:\n  dam metrics my-agent\n  dam metrics my-agent --session sess-abc123\n  dam metrics agent-3f9c2b7e41d08a65 --since 168 --json\n",
    )
    .action(
      async (
        ref: string,
        opts: {
          since?: string;
          session?: string;
          limit?: string;
          server?: string;
          json?: boolean;
        },
      ) => {
        const sinceHours =
          opts.since === undefined
            ? undefined
            : wholeNumberUpTo(opts.since, METRICS_MAX_SINCE_HOURS);
        if (sinceHours === null) {
          process.stderr.write(
            `--since must be a whole number of hours from 1 to ${METRICS_MAX_SINCE_HOURS}, got "${opts.since}"\n`,
          );
          return process.exit(EXIT_INVALID_INPUT);
        }
        const limit =
          opts.limit === undefined
            ? 100
            : wholeNumberUpTo(opts.limit, METRICS_MAX_LIMIT);
        if (limit === null) {
          process.stderr.write(
            `--limit must be a whole number from 1 to ${METRICS_MAX_LIMIT}, got "${opts.limit}"\n`,
          );
          return process.exit(EXIT_INVALID_INPUT);
        }
        const host = await resolveActiveHost(deps, opts.server);
        const agent = await resolveAgentOrExit(
          deps.createAgentService(host),
          ref,
          host,
        );

        const fetchTitles = async (): Promise<Map<string, string>> => {
          const tok = await deps.tokenProvider.getValidAccessToken(host);
          if (!tok.ok) return new Map();
          const sessions = await deps
            .createSessionsPort(host, tok.value)
            .list(agent.id);
          if (!sessions.ok) return new Map();
          return new Map(
            sessions.value
              .filter((s) => s.title)
              .map((s) => [s.sessionId, s.title as string]),
          );
        };
        const metrics = deps.createMetricsService(host);
        const metering = await metrics.metering();
        exitOnServiceError(metering, host);
        const now = new Date();
        const days = spendWindow({ startDay: metering.value.startDay, now });
        const range =
          sinceHours === undefined ? days : { at: hourWindow(sinceHours, now) };
        const [breakdown, sessions, overview, titles] = await Promise.all([
          metrics.breakdown({ agentId: agent.id, ...range }),
          metrics.sessions({
            agentId: agent.id,
            ...range,
            ...(opts.session && { sessionIds: [opts.session] }),
            limit: SPEND_SESSIONS_MAX,
          }),
          metrics.overview({
            agentId: agent.id,
            sessionId: opts.session,
            sinceHours,
            limit,
          }),
          fetchTitles().catch(() => new Map<string, string>()),
        ]);
        exitOnServiceError(breakdown, host);
        exitOnServiceError(sessions, host);
        const noTelemetry =
          !overview.ok &&
          overview.error.kind === "transport" &&
          overview.error.serverCode === "PRECONDITION_FAILED";
        if (!noTelemetry) exitOnServiceError(overview, host);
        const routerCallIds = overview.ok
          ? overview.value.contextPerCall.flatMap((call) =>
              call.routerCallId ? [call.routerCallId] : [],
            )
          : [];
        const costs =
          routerCallIds.length > 0
            ? await metrics.calls({ agentId: agent.id, routerCallIds })
            : null;
        const costOf = new Map(
          (costs?.ok ? costs.value.calls : []).map((c) => [c.routerCallId, c]),
        );
        const calls = overview.ok
          ? overview.value.contextPerCall.map(
              ({ costUsd: _cost, routerCallId, ...call }) => {
                const cost = costOf.get(routerCallId);
                return {
                  ...call,
                  cost: cost
                    ? {
                        unit: cost.unit,
                        costMicros: cost.costMicros,
                        estimated: cost.estimated,
                      }
                    : null,
                };
              },
            )
          : null;
        const sessionRows = sessions.value.rows.map((r) => ({
          ...r,
          title: titles.get(r.sessionId) ?? null,
        }));
        const narrowed = opts.session ? (sessionRows[0] ?? null) : undefined;
        const totals =
          narrowed === undefined
            ? breakdown.value.totals
            : (narrowed?.amounts ?? []);
        const byModel = narrowed === undefined ? breakdown.value.byModel : null;

        if (opts.json) {
          return writeStdoutAndExit(
            `${JSON.stringify({
              agentId: agent.id,
              window: breakdown.value.window ?? days,
              measuredSince: metering.value.startedAt,
              totals,
              byModel,
              sessions: sessionRows,
              calls,
            })}\n`,
            EXIT_SUCCESS,
          );
        }

        const read = breakdown.value.window;
        const shownDays = read
          ? {
              from: read.fromAt.slice(0, 10),
              to: new Date(Date.parse(read.toAt) - 1)
                .toISOString()
                .slice(0, 10),
            }
          : days;
        const windowLabel = `${
          read && sinceHours !== undefined
            ? readWindowLabel(read, shownDays, sinceHours)
            : `${formatDayWindow(days)}, UTC days`
        }${opts.session ? ` · session ${opts.session}` : ""}`;
        if (totals.length === 0 && (calls?.length ?? 0) === 0) {
          process.stderr.write(
            `No measured spend for ${agent.name} in ${windowLabel}.\n`,
          );
          process.exit(EXIT_SUCCESS);
        }

        const callCount =
          narrowed === undefined
            ? breakdown.value.totals.reduce((n, r) => n + r.calls, 0)
            : (narrowed?.calls ?? 0);
        const modelTimeMs =
          narrowed === undefined
            ? breakdown.value.modelTimeMs
            : (narrowed?.durationMs ?? 0);
        const summary = renderTable([
          ["AGENT", `${agent.name} (${agent.id})`],
          ["WINDOW", windowLabel],
          ["API CALLS", String(callCount)],
          [
            "SESSIONS",
            `${sessionRows.length}${sessions.value.truncated ? "+" : ""}`,
          ],
          ["MODEL TIME", secs(modelTimeMs)],
          ["SPEND", spendText(totals)],
        ]);
        const models = byModel
          ? `SPEND BY MODEL\n${renderTable([
              [
                "MODEL",
                "CALLS",
                "INPUT",
                "OUTPUT",
                "CACHE R",
                "CACHE W",
                "SPEND",
              ],
              ...byModel.map((r) => [
                r.model,
                String(r.calls),
                r.uncachedInputTokens.toLocaleString(),
                r.outputTokens.toLocaleString(),
                r.cacheReadTokens.toLocaleString(),
                (r.cacheWrite5mTokens + r.cacheWrite1hTokens).toLocaleString(),
                spendText([r]),
              ]),
            ])}\n`
          : "";
        const bySession = renderFittedTable(
          [
            "SESSION",
            "CALLS",
            "MODEL TIME",
            "INPUT",
            "OUTPUT",
            "CACHE R",
            "CACHE W",
            "SPEND",
            "LAST",
          ],
          sessionRows.map((r) => [
            r.title ?? r.sessionId,
            String(r.calls),
            secs(r.durationMs),
            r.uncachedInputTokens.toLocaleString(),
            r.outputTokens.toLocaleString(),
            r.cacheReadTokens.toLocaleString(),
            (r.cacheWrite5mTokens + r.cacheWrite1hTokens).toLocaleString(),
            spendText(r.amounts),
            r.lastAt ? formatAt(r.lastAt) : r.lastDay,
          ]),
          0,
        );
        const recent = calls
          ? renderTable([
              [
                "TIME",
                "MODEL",
                "CONTEXT",
                "INPUT",
                "CACHE R",
                "OUTPUT",
                "COST",
              ],
              ...calls.map((r) => [
                r.at,
                r.model,
                r.contextTokens.toLocaleString(),
                r.inputTokens.toLocaleString(),
                r.cacheReadTokens.toLocaleString(),
                r.outputTokens.toLocaleString(),
                callCostText(r.cost),
              ]),
            ])
          : `${NO_CALL_TELEMETRY}\n`;
        return writeStdoutAndExit(
          `${summary}\n${models}SESSIONS\n${bySession}\nRECENT CALLS (context per call)\n${recent}`,
          EXIT_SUCCESS,
        );
      },
    );
}
