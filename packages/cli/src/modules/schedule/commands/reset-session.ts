import { Command } from "commander";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import { describeScheduleError } from "../domain/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_SUCCESS } from "../../shared/exit-codes.js";
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
      const host = await resolveActiveHost(deps, opts.server);
      const svc = deps.createScheduleService(host);

      const current = await svc.get(id);
      exitOnServiceError(current, host, describeScheduleError);

      const sessionMode = current.value.sessionMode ?? "fresh";
      if (sessionMode !== "continuous") {
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
      exitOnServiceError(result, host);

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
