import { Command } from "commander";
import { rruleToText } from "api-server-api";
import { printServiceError } from "../../agent/commands/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_RUNTIME_FAILURE,
  EXIT_SCHEDULE_NOT_FOUND,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import type {
  ScheduleService,
  ScheduleView,
} from "../services/schedule-service.js";

function renderSchedule(view: ScheduleView): string {
  const lines: string[] = [];
  lines.push(`ID:          ${view.id}`);
  lines.push(
    `Name:        ${view.createdBy === "agent" ? `${view.name} (agent)` : view.name}`,
  );
  if (view.rrule !== null) {
    lines.push(`Recurrence:  ${rruleToText(view.rrule)}`);
    lines.push(`RRULE:       ${view.rrule}`);
    lines.push(`Timezone:    ${view.timezone ?? "—"}`);
    if (view.quietHours.length > 0) {
      const windows = view.quietHours
        .map(
          (q) => `${q.startTime}-${q.endTime}${q.enabled ? "" : " (disabled)"}`,
        )
        .join(", ");
      lines.push(`Quiet hours: ${windows}`);
    }
  } else {
    lines.push(`Cron:        ${view.cron ?? ""}`);
  }
  lines.push(`Session:     ${view.sessionMode ?? "fresh"}`);
  lines.push(`Enabled:     ${view.enabled}`);
  lines.push(`Created by:  ${view.createdBy}`);
  if (view.status?.lastRun) lines.push(`Last run:    ${view.status.lastRun}`);
  if (view.status?.nextRun) lines.push(`Next run:    ${view.status.nextRun}`);
  if (view.status?.lastResult) {
    lines.push(`Last result: ${view.status.lastResult}`);
  }
  return `${lines.join("\n")}\n`;
}

export function buildGetCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createScheduleService: (host: string) => ScheduleService;
}): Command {
  return new Command("get")
    .description("Show one schedule, expanded")
    .argument("<schedule-id>", "Schedule id (from `dam schedule list`)")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the raw schedule as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n  dam schedule get sched-abc123\n  dam schedule get sched-abc123 --json\n",
    )
    .action(async (id: string, opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, {
        flag: opts.server ? { server: opts.server } : undefined,
        exitCodes: {
          runtimeFailure: EXIT_RUNTIME_FAILURE,
          belowFloor: EXIT_BELOW_FLOOR,
        },
      });

      const result = await deps.createScheduleService(host).get(id);
      if (!result.ok) {
        if (result.error.kind === "schedule-not-found") {
          process.stderr.write(`error: schedule not found: ${id}\n`);
          process.exit(EXIT_SCHEDULE_NOT_FOUND);
        }
        printServiceError(result.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result.value)}\n`);
      } else {
        process.stdout.write(renderSchedule(result.value));
      }
      process.exit(EXIT_SUCCESS);
    });
}
