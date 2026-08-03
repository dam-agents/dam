import { Command } from "commander";
import { rruleToText } from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { createAgentResolver } from "../../agent/index.js";
import {
  exitCodeForResolveError,
  printResolveError,
} from "../../agent/commands/errors.js";
import { printServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { renderTable } from "../../shared/render-table.js";
import type {
  ScheduleService,
  ScheduleView,
} from "../services/schedule-service.js";

function recurrenceText(view: ScheduleView): string {
  // rrule rows render human-readable; a legacy cron row renders its raw string.
  return view.rrule !== null ? rruleToText(view.rrule) : (view.cron ?? "");
}

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
      "\nExamples:\n  dam schedule list my-agent\n  dam schedule list agent-abc123 --json\n",
    )
    .action(async (ref: string, opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, {
        flag: opts.server ? { server: opts.server } : undefined,
        exitCodes: {
          runtimeFailure: EXIT_RUNTIME_FAILURE,
          belowFloor: EXIT_BELOW_FLOOR,
        },
      });

      const resolver = createAgentResolver({
        agentService: deps.createAgentService(host),
      });
      const resolved = await resolver.resolve(ref);
      if (!resolved.ok) {
        printResolveError(resolved.error, host);
        process.exit(exitCodeForResolveError(resolved.error));
      }

      const result = await deps
        .createScheduleService(host)
        .list(resolved.value.id);
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
            recurrenceText(v),
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
