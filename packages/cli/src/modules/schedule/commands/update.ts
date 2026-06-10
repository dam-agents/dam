import { Command, Option } from "commander";
import {
  ALL_DAYS,
  buildRRule,
  detectPreset,
  detectTimezone,
  hasVisibleOccurrence,
} from "api-server-api";
import { printServiceError } from "../../agent/commands/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SCHEDULE_NOT_FOUND,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import {
  buildPresetFromFlags,
  formatWeekdays,
  parseQuietWindow,
} from "../domain/recurrence-flags.js";
import type { ScheduleService } from "../services/schedule-service.js";

interface UpdateOpts {
  name?: string;
  task?: string;
  daily?: string;
  every?: string;
  rrule?: string;
  weekdays?: string;
  timezone?: string;
  quietWindow: string[];
  sessionMode?: "fresh" | "continuous";
  server?: string;
  json?: boolean;
}

export function buildUpdateCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createScheduleService: (host: string) => ScheduleService;
}): Command {
  return new Command("update")
    .description(
      "Update an RRULE schedule (read-merge-write). Partial — pass only the fields to change. Legacy cron schedules are read-only.",
    )
    .argument("<schedule-id>", "Schedule id (from `dam schedule list`)")
    .option("--name <name>", "new schedule name")
    .option("--task <task>", "new task prompt")
    .option("--daily <HH:MM>", "rebuild recurrence: daily at HH:MM")
    .option("--every <interval>", "rebuild recurrence: every Nm/Nh")
    .option("--rrule <body>", "rebuild recurrence: raw RFC 5545 RRULE body")
    .option(
      "--weekdays <days>",
      "BYDAY filter for --daily/--every, e.g. MO,WE,FR",
    )
    .option("--timezone <tz>", "new IANA timezone")
    .option(
      "--quiet-window <HH:MM-HH:MM>",
      "replace ALL quiet windows with these (repeatable)",
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .addOption(
      new Option("--session-mode <mode>", "session strategy each tick").choices(
        ["fresh", "continuous"],
      ),
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the updated schedule as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam schedule update sched-abc123 --name nightly\n" +
        "  dam schedule update sched-abc123 --every 30m --weekdays MO,WE,FR\n" +
        "  dam schedule update sched-abc123 --quiet-window 22:00-06:00\n",
    )
    .action(async (id: string, opts: UpdateOpts) => {
      const recurrenceGiven =
        opts.daily !== undefined ||
        opts.every !== undefined ||
        opts.rrule !== undefined;
      const quietGiven = opts.quietWindow.length > 0;
      const anyFlag =
        opts.name !== undefined ||
        opts.task !== undefined ||
        opts.timezone !== undefined ||
        opts.sessionMode !== undefined ||
        opts.weekdays !== undefined ||
        recurrenceGiven ||
        quietGiven;
      if (!anyFlag) {
        process.stderr.write(
          "error: nothing to update — pass at least one of --name, --task, --daily/--every/--rrule, --weekdays, --timezone, --quiet-window, --session-mode\n",
        );
        process.exit(EXIT_INVALID_INPUT);
      }
      if (opts.weekdays !== undefined && !recurrenceGiven) {
        process.stderr.write(
          "error: --weekdays only applies when rebuilding the recurrence; pass it with --daily or --every\n",
        );
        process.exit(EXIT_INVALID_INPUT);
      }

      const host = await resolveActiveHost(deps, {
        flag: opts.server ? { server: opts.server } : undefined,
        exitCodes: {
          runtimeFailure: EXIT_RUNTIME_FAILURE,
          belowFloor: EXIT_BELOW_FLOOR,
        },
      });
      const svc = deps.createScheduleService(host);

      const current = await svc.get(id);
      if (!current.ok) {
        if (current.error.kind === "schedule-not-found") {
          process.stderr.write(`error: schedule not found: ${id}\n`);
          process.exit(EXIT_SCHEDULE_NOT_FOUND);
        }
        printServiceError(current.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }
      const view = current.value;
      if (view.rrule === null) {
        process.stderr.write(
          "error: this is a legacy cron schedule; recreate it as an RRULE to edit\n",
        );
        process.exit(EXIT_INVALID_INPUT);
      }

      // Recurrence is one atomic unit: any recurrence flag rebuilds the whole
      // rrule; otherwise the current body is kept verbatim.
      let rrule = view.rrule;
      if (recurrenceGiven) {
        try {
          rrule = buildRRule(
            buildPresetFromFlags({
              daily: opts.daily,
              every: opts.every,
              rrule: opts.rrule,
              weekdays: opts.weekdays,
            }),
          );
        } catch (e) {
          process.stderr.write(`error: ${(e as Error).message}\n`);
          process.exit(EXIT_INVALID_INPUT);
        }
        // Surface a silently-dropped weekday filter (rebuilding a preset
        // recurrence without --weekdays clears any prior BYDAY).
        if (opts.weekdays === undefined && opts.rrule === undefined) {
          const old = detectPreset(view.rrule);
          if (old.kind !== "custom" && old.days.length < ALL_DAYS.length) {
            process.stderr.write(
              `note: weekday filter (${formatWeekdays(old.days)}) cleared by the new recurrence; re-pass --weekdays to keep it\n`,
            );
          }
        }
      }

      // Quiet windows replace-all: any --quiet-window replaces the set.
      let quietHours = view.quietHours;
      if (quietGiven) {
        try {
          quietHours = opts.quietWindow.map(parseQuietWindow);
        } catch (e) {
          process.stderr.write(`error: ${(e as Error).message}\n`);
          process.exit(EXIT_INVALID_INPUT);
        }
      }

      if (!hasVisibleOccurrence(rrule, quietHours)) {
        process.stderr.write(
          "error: quiet hours cover every scheduled occurrence — this schedule would never fire\n",
        );
        process.exit(EXIT_INVALID_INPUT);
      }

      const sessionMode = opts.sessionMode ?? view.sessionMode;
      const result = await svc.updateRRule({
        id,
        name: opts.name ?? view.name,
        rrule,
        timezone: opts.timezone ?? view.timezone ?? detectTimezone(),
        quietHours,
        task: opts.task ?? view.task ?? "",
        ...(sessionMode ? { sessionMode } : {}),
      });
      if (!result.ok) {
        if (result.error.kind === "schedule-not-found") {
          process.stderr.write(`error: schedule not found: ${id}\n`);
          process.exit(EXIT_SCHEDULE_NOT_FOUND);
        }
        if (result.error.kind === "invalid-input") {
          process.stderr.write(`error: ${result.error.message}\n`);
          process.exit(EXIT_INVALID_INPUT);
        }
        printServiceError(result.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result.value)}\n`);
      } else {
        process.stdout.write(
          `✓ Updated schedule ${result.value.id} (${result.value.name}).\n`,
        );
      }
      process.exit(EXIT_SUCCESS);
    });
}
