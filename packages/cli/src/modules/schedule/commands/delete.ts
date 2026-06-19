import { Command } from "commander";
import { printServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { confirm, exitCancelled } from "../../shared/prompt.js";
import type { ScheduleService } from "../services/schedule-service.js";

export function buildDeleteCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createScheduleService: (host: string) => ScheduleService;
}): Command {
  return new Command("delete")
    .description("Delete a schedule. Idempotent — unknown ids exit 0.")
    .argument("<schedule-id>", "Schedule id (from `dam schedule list`)")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("-y, --yes", "skip the confirmation prompt")
    .option("--json", "emit { deleted, id } as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n  dam schedule delete sched-abc123\n  dam schedule delete sched-abc123 --yes\n",
    )
    .action(
      async (
        id: string,
        opts: { server?: string; yes?: boolean; json?: boolean },
      ) => {
        const host = await resolveActiveHost(deps, {
          flag: opts.server ? { server: opts.server } : undefined,
          exitCodes: {
            runtimeFailure: EXIT_RUNTIME_FAILURE,
            belowFloor: EXIT_BELOW_FLOOR,
          },
        });

        if (!opts.yes) {
          if (!process.stdin.isTTY) {
            process.stderr.write(
              "error: refusing to delete without --yes on non-interactive stdin\n",
            );
            process.exit(EXIT_INVALID_INPUT);
          }
          if (!(await confirm(`Delete schedule ${id}?`))) exitCancelled(opts);
        }

        const result = await deps.createScheduleService(host).delete(id);
        if (!result.ok) {
          printServiceError(result.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        if (opts.json) {
          process.stdout.write(`${JSON.stringify({ deleted: true, id })}\n`);
        } else {
          process.stdout.write(`✓ Deleted schedule ${id}.\n`);
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}
