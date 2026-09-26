import { Command } from "commander";
import { rruleToText } from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import { printServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_RUNTIME_FAILURE, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { renderTable } from "../../shared/render-table.js";
import type { ScheduleService } from "../services/schedule-service.js";

export function buildListCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createScheduleService: (host: string) => ScheduleService;
}): Command {
  return new Command("list")
    .description("List the schedules attached to an Agent")
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw JSON instead of the default table")
    .addHelpText(
      "after",
      "\nExamples:\n  dam schedule list my-agent\n  dam schedule list agent-3f9c2b7e41d08a65 --json\n",
    )
    .action(async (ref: string, opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, opts.server);

      const agent = await resolveAgentOrExit(
        deps.createAgentService(host),
        ref,
        host,
      );

      const result = await deps.createScheduleService(host).list(agent.id);
      if (!result.ok) {
        printServiceError(result.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result.value)}\n`);
        process.exit(EXIT_SUCCESS);
      }

      if (result.value.length === 0) {
        process.stderr.write(
          `No schedules. Add one with \`dam schedule create ${ref} --name <n> --task <t> --daily HH:MM\`.\n`,
        );
        process.exit(EXIT_SUCCESS);
      }

      process.stdout.write(
        renderTable([
          [
            "ID",
            "NAME",
            "RECURRENCE",
            "TZ",
            "ENABLED",
            "NEXT-RUN",
            "LAST-RESULT",
          ],
          ...result.value.map((v) => [
            v.id,
            v.createdBy === "agent" ? `${v.name} (agent)` : v.name,
            v.rrule !== null ? rruleToText(v.rrule) : (v.cron ?? ""),
            v.timezone ?? "—",
            String(v.enabled),
            v.status?.nextRun ?? "—",
            v.status?.lastResult ?? "—",
          ]),
        ]),
      );
      process.exit(EXIT_SUCCESS);
    });
}
