import { Command } from "commander";
import { printServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_RUNTIME_FAILURE,
  EXIT_SCHEDULE_NOT_FOUND,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import type { ScheduleService } from "../services/schedule-service.js";

export function buildResetSessionCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createScheduleService: (host: string) => ScheduleService;
}): Command {
  return new Command("reset-session")
    .description(
      "Clear a continuous schedule's accumulated session so the next tick starts fresh",
    )
    .argument("<schedule-id>", "Schedule id (from `dam schedule list`)")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit { reset, id, sessionMode } as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n  dam schedule reset-session sched-abc123\n",
    )
    .action(async (id: string, opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, {
        flag: opts.server ? { server: opts.server } : undefined,
        exitCodes: {
          runtimeFailure: EXIT_RUNTIME_FAILURE,
          belowFloor: EXIT_BELOW_FLOOR,
        },
      });
      const svc = deps.createScheduleService(host);

      // get() yields both the not-found classification (resetSession never
      // throws NOT_FOUND) and the fresh-mode no-op below.
      const current = await svc.get(id);
      if (!current.ok) {
        if (current.error.kind === "schedule-not-found") {
          process.stderr.write(`error: schedule not found: ${id}\n`);
          process.exit(EXIT_SCHEDULE_NOT_FOUND);
        }
        printServiceError(current.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }

      const sessionMode = current.value.sessionMode ?? "fresh";
      if (sessionMode !== "continuous") {
        // Fresh schedules have no accumulated binding — skip the durable
        // outbox event entirely.
        if (opts.json) {
          process.stdout.write(
            `${JSON.stringify({ reset: false, id, sessionMode })}\n`,
          );
        } else {
          process.stdout.write(
            `Nothing to reset — "${current.value.name}" is a fresh-session schedule.\n`,
          );
        }
        process.exit(EXIT_SUCCESS);
      }

      const result = await svc.resetSession(id);
      if (!result.ok) {
        printServiceError(result.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }

      if (opts.json) {
        process.stdout.write(
          `${JSON.stringify({ reset: true, id, sessionMode })}\n`,
        );
      } else {
        process.stdout.write(
          `✓ Reset session for "${current.value.name}". The next tick starts fresh.\n`,
        );
      }
      process.exit(EXIT_SUCCESS);
    });
}
