import { Command, Option } from "commander";
import {
  ALL_DAYS,
  buildRRule,
  detectPreset,
  detectTimezone,
  hasVisibleOccurrence,
} from "api-server-api";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import { describeScheduleError } from "../domain/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { profileOrExit } from "./profile-ref.js";
import {
  buildPresetFromFlags,
  formatWeekdays,
  parseQuietWindow,
} from "../domain/recurrence-flags.js";
import {
  localTimeIn,
  parseAtFlag,
  recurringFlagsGiven,
} from "../domain/once-flags.js";
import { parseSettingFlags } from "../../shared/setting-flags.js";
import type {
  ScheduleService,
  ScheduleView,
} from "../services/schedule-service.js";

interface UpdateOpts {
  at?: string;
  harness?: string;
  profile?: string;
  harnessDefault?: boolean;
  model?: string;
  modelDefault?: boolean;
  setting: string[];
  settingsDefault?: boolean;
  name?: string;
  task?: string;
  daily?: string;
  every?: string;
  rrule?: string;
  weekdays?: string;
  timezone?: string;
  quietWindow: string[];
  precheck?: string;
  precheckNone?: boolean;
  sessionMode?: "fresh" | "continuous";
  server?: string;
  json?: boolean;
}

export function buildUpdateCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createScheduleService: (host: string) => ScheduleService;
  findProfile: (
    host: string,
    ref: string,
  ) => Promise<{ id: string; name: string } | null>;
  profileName: (host: string, id: string) => Promise<string | null>;
}): Command {
  return new Command("update")
    .description(
      "Update an RRULE schedule (read-merge-write). Partial — pass only the fields to change. Legacy cron schedules are read-only.",
    )
    .argument("<schedule-id>", "Schedule id (from `dam schedule list`)")
    .option("--name <name>", "new schedule name")
    .option("--task <task>", "new task prompt")
    .option(
      "--at <YYYY-MM-DD HH:MM>",
      "one-time schedules only: new local time to run at",
    )
    .option(
      "--profile <name-or-id>",
      "run it on one of your profiles, by name or id (replaces --harness, --model and --setting)",
    )
    .option(
      "--harness <name>",
      "harness its sessions run on, one the agent carries",
    )
    .option("--harness-default", "run on the agent's default harness")
    .option(
      "--model <model>",
      "model its sessions run on, as <provider>/<model id>",
    )
    .option("--model-default", "run on the agent's default model")
    .option(
      "--setting <id=value>",
      "a per-session setting of the harness, e.g. effort=high (repeatable; replaces the stored settings)",
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .option("--settings-default", "drop the schedule's per-session settings")
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
      "--precheck <command>",
      "shell command run in the workspace before each fire; exit 0 runs, exit 1 skips this occurrence, any other exit means the check broke and the task runs anyway",
    )
    .option("--precheck-none", "remove the schedule's precheck")
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
        opts.precheck !== undefined ||
        opts.precheckNone === true ||
        opts.at !== undefined ||
        choicesGiven(opts) ||
        recurrenceGiven ||
        quietGiven;
      if (!anyFlag) {
        process.stderr.write(
          "error: nothing to update — pass at least one of --name, --task, --daily/--every/--rrule, --weekdays, --timezone, --quiet-window, --session-mode, --precheck, --precheck-none\n",
        );
        process.exit(EXIT_INVALID_INPUT);
      }
      if (opts.weekdays !== undefined && !recurrenceGiven) {
        process.stderr.write(
          "error: --weekdays only applies when rebuilding the recurrence; pass it with --daily or --every\n",
        );
        process.exit(EXIT_INVALID_INPUT);
      }

      const host = await resolveActiveHost(deps, opts.server);
      const svc = deps.createScheduleService(host);

      const current = await svc.get(id);
      exitOnServiceError(current, host, describeScheduleError);
      const view = current.value;
      if (view.type === "once") {
        await updateOnce(
          svc,
          host,
          view,
          opts,
          await profileOrExit(deps, host, opts.profile),
          (saved) => noteDetach(deps, host, view, saved),
        );
      }
      if (opts.at !== undefined) {
        process.stderr.write(
          "error: --at only applies to one-time schedules\n",
        );
        process.exit(EXIT_INVALID_INPUT);
      }
      if (view.rrule === null) {
        process.stderr.write(
          "error: this is a legacy cron schedule; recreate it as an RRULE to edit\n",
        );
        process.exit(EXIT_INVALID_INPUT);
      }

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
        if (opts.weekdays === undefined && opts.rrule === undefined) {
          const old = detectPreset(view.rrule);
          if (old.kind !== "custom" && old.days.length < ALL_DAYS.length) {
            process.stderr.write(
              `note: weekday filter (${formatWeekdays(old.days)}) cleared by the new recurrence; re-pass --weekdays to keep it\n`,
            );
          }
        }
      }

      let quietHours = view.quietHours;
      if (quietGiven) {
        try {
          quietHours = opts.quietWindow.map(parseQuietWindow);
        } catch (e) {
          process.stderr.write(`error: ${(e as Error).message}\n`);
          process.exit(EXIT_INVALID_INPUT);
        }
      }

      const timezone = opts.timezone ?? view.timezone ?? detectTimezone();
      if (!hasVisibleOccurrence(rrule, timezone, quietHours)) {
        process.stderr.write(
          "error: quiet hours cover every scheduled occurrence — this schedule would never fire\n",
        );
        process.exit(EXIT_INVALID_INPUT);
      }

      const sessionMode = opts.sessionMode ?? view.sessionMode;
      const profileId = await profileOrExit(deps, host, opts.profile);
      const result = await svc.updateRRule({
        id,
        name: opts.name ?? view.name,
        rrule,
        timezone,
        quietHours,
        task: opts.task ?? view.task ?? "",
        ...(sessionMode ? { sessionMode } : {}),
        precheck: opts.precheckNone ? null : (opts.precheck ?? view.precheck),
        ...choicesOrExit(opts, view, true, profileId),
      });
      exitOnServiceError(result, host, describeScheduleError);
      await noteDetach(deps, host, view, result.value);

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

async function updateOnce(
  svc: ScheduleService,
  host: string,
  view: ScheduleView,
  opts: UpdateOpts,
  profileId: string | null,
  note: (saved: ScheduleView) => Promise<void>,
): Promise<never> {
  const conflicting = recurringFlagsGiven(opts);
  if (conflicting.length > 0) {
    process.stderr.write(
      `error: a one-time schedule does not take ${conflicting.join(", ")}\n`,
    );
    process.exit(EXIT_INVALID_INPUT);
  }
  const timezone = opts.timezone ?? view.timezone ?? detectTimezone();
  let at: string;
  try {
    at =
      opts.at !== undefined
        ? parseAtFlag(opts.at)
        : parseAtFlag(localTimeIn(view.at ?? "", timezone));
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`);
    process.exit(EXIT_INVALID_INPUT);
  }
  const result = await svc.updateOnce({
    id: view.id,
    name: opts.name ?? view.name,
    task: opts.task ?? view.task ?? "",
    at,
    timezone,
    ...choicesOrExit(opts, view, false, profileId),
  });
  exitOnServiceError(result, host, describeScheduleError);
  await note(result.value);
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result.value)}\n`);
  } else {
    process.stdout.write(
      `✓ Updated one-time schedule ${result.value.id} (${result.value.name}).\n`,
    );
  }
  process.exit(EXIT_SUCCESS);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: an inline flag on a schedule that names a profile
 * detaches it, and a detach nobody asked for is worth one line: the schedule
 * keeps running on the values it had, under its own name now.
 */
async function noteDetach(
  deps: {
    profileName: (host: string, id: string) => Promise<string | null>;
  },
  host: string,
  view: ScheduleView,
  saved: ScheduleView,
): Promise<void> {
  /* UNIT_BOUNDARY_DESCRIPTION: the server decides what detached — a blank or
   * unchanged value keeps the profile — so the note follows the schedule that
   * came back, never the flag that was passed. */
  if (view.profile === null || saved.profile !== null) return;
  const name = (await deps.profileName(host, view.profile)) ?? view.profile;
  process.stderr.write(`note: detached from profile ${name}\n`);
}

function choicesGiven(opts: UpdateOpts): boolean {
  return (
    opts.profile !== undefined ||
    opts.harness !== undefined ||
    opts.harnessDefault === true ||
    opts.model !== undefined ||
    opts.modelDefault === true ||
    opts.setting.length > 0 ||
    opts.settingsDefault === true
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a flag replaces the stored choice, its
 * `-default` twin clears it, and silence keeps it. The recurring update
 * sends null for a cleared choice, the one-time update omits it, as their
 * inputs differ.
 */
interface NullableChoices {
  harness?: string | null;
  model?: string | null;
  settings?: Record<string, string> | null;
}
interface PresentChoices {
  harness?: string;
  model?: string;
  settings?: Record<string, string>;
}
interface ProfiledChoices {
  profile: string;
}
function choicesOrExit(
  opts: UpdateOpts,
  view: ScheduleView,
  nullable: true,
  profileId: string | null,
): NullableChoices | ProfiledChoices;
function choicesOrExit(
  opts: UpdateOpts,
  view: ScheduleView,
  nullable: false,
  profileId: string | null,
): PresentChoices | ProfiledChoices;
function choicesOrExit(
  opts: UpdateOpts,
  view: ScheduleView,
  nullable: boolean,
  profileId: string | null,
): NullableChoices | ProfiledChoices {
  /* UNIT_BOUNDARY_DESCRIPTION: naming a profile replaces the inline values; an
   * inline flag detaches by sending the values the schedule runs on now, so a
   * detach keeps what was running instead of dropping it. */
  if (profileId !== null) return { profile: profileId };
  let given: Record<string, string> | undefined;
  try {
    given = parseSettingFlags(opts.setting);
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`);
    process.exit(EXIT_INVALID_INPUT);
  }
  const harness = opts.harnessDefault ? null : (opts.harness ?? view.harness);
  const model = opts.modelDefault ? null : (opts.model ?? view.model);
  const settings = opts.settingsDefault ? null : (given ?? view.settings);
  const keep = <T>(key: string, value: T | null) =>
    value !== null ? { [key]: value } : nullable ? { [key]: null } : {};
  return {
    ...keep("harness", harness),
    ...keep("model", model),
    ...keep(
      "settings",
      settings && Object.keys(settings).length ? settings : null,
    ),
  };
}
