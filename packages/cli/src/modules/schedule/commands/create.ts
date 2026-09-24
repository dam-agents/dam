import { Command, Option } from "commander";
import {
  buildRRule,
  detectTimezone,
  hasVisibleOccurrence,
} from "api-server-api";
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
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import {
  buildPresetFromFlags,
  parseQuietWindow,
} from "../domain/recurrence-flags.js";
import {
  localTimeIn,
  parseAtFlag,
  recurringFlagsGiven,
} from "../domain/once-flags.js";
import type { ScheduleService } from "../services/schedule-service.js";

interface CreateOpts {
  name: string;
  task: string;
  once?: boolean;
  at?: string;
  now?: boolean;
  model?: string;
  daily?: string;
  every?: string;
  rrule?: string;
  weekdays?: string;
  timezone?: string;
  quietWindow: string[];
  precheck?: string;
  sessionMode?: "fresh" | "continuous";
  server?: string;
  json?: boolean;
}

export function buildCreateCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createScheduleService: (host: string) => ScheduleService;
}): Command {
  return new Command("create")
    .description(
      "Create an RRULE schedule on an Agent, or with --once a one-time task",
    )
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .requiredOption("--name <name>", "schedule name")
    .requiredOption("--task <task>", "task prompt to run each tick")
    .option(
      "--once",
      "run the task exactly once, at --at or --now, in a fresh session",
    )
    .option(
      "--at <YYYY-MM-DD HH:MM>",
      "with --once: the local time (in --timezone) to run at",
    )
    .option("--now", "with --once: run immediately")
    .option(
      "--model <model>",
      "with --once: the model its session runs on (default: the agent's)",
    )
    .option("--daily <HH:MM>", "run daily at HH:MM (24h)")
    .option("--every <interval>", "run every N minutes (Nm) or hours (Nh)")
    .option(
      "--rrule <body>",
      "raw RFC 5545 RRULE body (mutually exclusive with --daily/--every/--weekdays)",
    )
    .option(
      "--weekdays <days>",
      "limit --daily/--every to these days, e.g. MO,WE,FR",
    )
    .option("--timezone <tz>", "IANA timezone (default: host zone)")
    .option(
      "--quiet-window <HH:MM-HH:MM>",
      "suppress fires inside this daily window (repeatable)",
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .addOption(
      new Option(
        "--session-mode <mode>",
        "session strategy each tick (default: fresh)",
      ).choices(["fresh", "continuous"]),
    )
    .option(
      "--precheck <command>",
      "shell command run in the workspace before each fire; exit 0 runs, exit 1 skips this occurrence, any other exit means the check broke and the task runs anyway",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the created schedule as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam schedule create my-agent --name nightly --task 'Check dashboards' --daily 22:00\n" +
        "  dam schedule create my-agent --name standup --task 'Summarize' --every 30m --weekdays MO,WE,FR --quiet-window 22:00-06:00\n" +
        "  dam schedule create my-agent --name custom --task 'Run' --rrule 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=7;BYMINUTE=0'\n" +
        "  dam schedule create my-agent --name notes --task 'Prepare release notes' --once --at '2026-10-01 08:30'\n" +
        "  dam schedule create my-agent --name export --task 'Run the export' --once --now\n",
    )
    .action(async (ref: string, opts: CreateOpts) => {
      let at: string | undefined;
      if (opts.once) {
        const conflicting = recurringFlagsGiven(opts);
        if (conflicting.length > 0) {
          process.stderr.write(
            `error: --once does not take ${conflicting.join(", ")}\n`,
          );
          process.exit(EXIT_INVALID_INPUT);
        }
        if ((opts.at === undefined) === (opts.now !== true)) {
          process.stderr.write(
            "error: --once needs exactly one of --at or --now\n",
          );
          process.exit(EXIT_INVALID_INPUT);
        }
        try {
          at = opts.at === undefined ? undefined : parseAtFlag(opts.at);
        } catch (e) {
          process.stderr.write(`error: ${(e as Error).message}\n`);
          process.exit(EXIT_INVALID_INPUT);
        }
      } else if (
        opts.at !== undefined ||
        opts.now ||
        opts.model !== undefined
      ) {
        process.stderr.write("error: --at, --now and --model need --once\n");
        process.exit(EXIT_INVALID_INPUT);
      }

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

      if (opts.once) {
        const timezone = opts.timezone ?? detectTimezone();
        const created = await deps.createScheduleService(host).createOnce({
          name: opts.name,
          agentId: resolved.value.id,
          task: opts.task,
          timezone,
          ...(at ? { at } : {}),
          ...(opts.model ? { model: opts.model } : {}),
        });
        if (!created.ok) {
          if (created.error.kind === "invalid-input") {
            process.stderr.write(`error: ${created.error.message}\n`);
            process.exit(EXIT_INVALID_INPUT);
          }
          printServiceError(created.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }
        if (opts.json) {
          process.stdout.write(`${JSON.stringify(created.value)}\n`);
        } else {
          const fireAt = created.value.at ?? "";
          process.stdout.write(
            `✓ Created one-time schedule ${created.value.id} (${created.value.name}) on ${ref}, running at ${localTimeIn(fireAt, timezone)} ${timezone} (${fireAt}).\n`,
          );
        }
        process.exit(EXIT_SUCCESS);
      }

      let rrule: string;
      let quietHours;
      try {
        rrule = buildRRule(
          buildPresetFromFlags({
            daily: opts.daily,
            every: opts.every,
            rrule: opts.rrule,
            weekdays: opts.weekdays,
          }),
        );
        quietHours = opts.quietWindow.map(parseQuietWindow);
      } catch (e) {
        process.stderr.write(`error: ${(e as Error).message}\n`);
        process.exit(EXIT_INVALID_INPUT);
      }
      const timezone = opts.timezone ?? detectTimezone();

      if (!hasVisibleOccurrence(rrule, quietHours)) {
        process.stderr.write(
          "error: quiet hours cover every scheduled occurrence — this schedule would never fire\n",
        );
        process.exit(EXIT_INVALID_INPUT);
      }

      const result = await deps.createScheduleService(host).createRRule({
        name: opts.name,
        agentId: resolved.value.id,
        rrule,
        timezone,
        quietHours,
        task: opts.task,
        ...(opts.sessionMode ? { sessionMode: opts.sessionMode } : {}),
        ...(opts.precheck ? { precheck: opts.precheck } : {}),
      });
      if (!result.ok) {
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
          `✓ Created schedule ${result.value.id} (${result.value.name}) on ${ref}.\n`,
        );
      }
      process.exit(EXIT_SUCCESS);
    });
}
