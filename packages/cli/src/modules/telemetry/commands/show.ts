import { Command } from "commander";
import type { AgentService } from "../../agent/index.js";
import { createAgentResolver } from "../../agent/index.js";
import {
  exitCodeForResolveError,
  printResolveError,
} from "../../agent/commands/errors.js";
import type { TokenProvider } from "../../auth/index.js";
import type { SessionsPort } from "../../chat/services/sessions-service.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { renderFittedTable, renderTable } from "../../shared/render-table.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { printServiceError } from "../../shared/trpc/print.js";
import type { TelemetryService } from "../services/telemetry-service.js";

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function buildTelemetryCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  tokenProvider: TokenProvider;
  createAgentService: (host: string) => AgentService;
  createSessionsPort: (host: string, token: string) => SessionsPort;
  createTelemetryService: (host: string) => TelemetryService;
}): Command {
  return new Command("telemetry")
    .description(
      "Show an Agent's run telemetry — token spend, runtime, and context usage",
    )
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .option("--since <hours>", "lookback window in hours (default 24, max 720)")
    .option(
      "--limit <n>",
      "max recent calls to include (default 100, max 1000)",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw JSON instead of the default report")
    .addHelpText(
      "after",
      "\nExamples:\n  dam telemetry my-agent\n  dam telemetry agent-abc123 --since 168 --json\n",
    )
    .action(
      async (
        ref: string,
        opts: {
          since?: string;
          limit?: string;
          server?: string;
          json?: boolean;
        },
      ) => {
        const host = await resolveActiveHost(deps, {
          flag: opts.server ? { server: opts.server } : undefined,
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
        const agent = resolved.value;

        // Session titles live on the agent (over ACP), not in telemetry —
        // fetch them alongside the overview to label sessions as the UI does.
        // Best-effort: telemetry can outlive sessions or the agent may be
        // unreachable, so a failure degrades to raw session ids.
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
        const sinceHours = opts.since ? Number(opts.since) : 24;
        const [result, titles] = await Promise.all([
          deps.createTelemetryService(host).overview({
            agentId: agent.id,
            sinceHours,
            limit: opts.limit ? Number(opts.limit) : 100,
          }),
          fetchTitles().catch(() => new Map<string, string>()),
        ]);
        if (!result.ok) {
          printServiceError(result.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }
        const { tokenSpendByModel, contextPerCall } = result.value;
        const runtimeBySession = result.value.runtimeBySession.map((r) => ({
          ...r,
          title: titles.get(r.sessionId) ?? null,
        }));

        if (opts.json) {
          return writeStdoutAndExit(
            `${JSON.stringify({
              agentId: agent.id,
              sinceHours,
              tokenSpendByModel,
              runtimeBySession,
              contextPerCall,
            })}\n`,
            EXIT_SUCCESS,
          );
        }

        if (tokenSpendByModel.length === 0) {
          process.stderr.write(
            `No telemetry for ${agent.name} in the last ${sinceHours}h.\n`,
          );
          process.exit(EXIT_SUCCESS);
        }

        const totalCalls = tokenSpendByModel.reduce((n, r) => n + r.calls, 0);
        const totalCost = tokenSpendByModel.reduce((n, r) => n + r.costUsd, 0);
        const totalApiMs = runtimeBySession.reduce(
          (n, r) => n + r.totalDurationMs,
          0,
        );
        const summary = renderTable([
          ["AGENT", `${agent.name} (${agent.id})`],
          ["WINDOW", `last ${sinceHours}h`],
          ["API CALLS", String(totalCalls)],
          ["SESSIONS", String(runtimeBySession.length)],
          ["API TIME", secs(totalApiMs)],
          ["COST USD", totalCost.toFixed(4)],
        ]);
        const byModel = renderTable([
          [
            "MODEL",
            "CALLS",
            "INPUT",
            "OUTPUT",
            "CACHE R",
            "CACHE W",
            "COST USD",
          ],
          ...tokenSpendByModel.map((r) => [
            r.model,
            String(r.calls),
            r.inputTokens.toLocaleString(),
            r.outputTokens.toLocaleString(),
            r.cacheReadTokens.toLocaleString(),
            r.cacheCreationTokens.toLocaleString(),
            r.costUsd.toFixed(4),
          ]),
        ]);
        const bySession = renderFittedTable(
          [
            "SESSION",
            "CALLS",
            "API TIME",
            "INPUT",
            "OUTPUT",
            "CACHE R",
            "CACHE W",
            "COST USD",
            "LAST",
          ],
          runtimeBySession.map((r) => [
            r.title ?? r.sessionId,
            String(r.calls),
            secs(r.totalDurationMs),
            r.inputTokens.toLocaleString(),
            r.outputTokens.toLocaleString(),
            r.cacheReadTokens.toLocaleString(),
            r.cacheCreationTokens.toLocaleString(),
            r.costUsd.toFixed(4),
            r.lastAt,
          ]),
          0,
        );
        const recent = renderTable([
          [
            "TIME",
            "MODEL",
            "CONTEXT",
            "INPUT",
            "CACHE R",
            "OUTPUT",
            "COST USD",
          ],
          ...contextPerCall.map((r) => [
            r.at,
            r.model,
            r.contextTokens.toLocaleString(),
            r.inputTokens.toLocaleString(),
            r.cacheReadTokens.toLocaleString(),
            r.outputTokens.toLocaleString(),
            r.costUsd.toFixed(4),
          ]),
        ]);
        return writeStdoutAndExit(
          `${summary}\nTOKEN SPEND BY MODEL\n${byModel}\nSESSIONS\n${bySession}\nRECENT CALLS (context per call)\n${recent}`,
          EXIT_SUCCESS,
        );
      },
    );
}
