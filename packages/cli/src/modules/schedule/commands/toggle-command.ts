import { Command } from "commander";
import { printServiceError } from "../../agent/commands/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_RUNTIME_FAILURE,
  EXIT_SCHEDULE_NOT_FOUND,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import type { ScheduleService } from "../services/schedule-service.js";

export interface ToggleDeps {
  compatService: CompatService;
  configService: ConfigService;
  createScheduleService: (host: string) => ScheduleService;
}

/**
 * Shared body for `enable`/`disable`. The router exposes a single `toggle`
 * mutation that flips `enabled`, so the CLI reads current state and calls it
 * only when the target differs — idempotent and scriptable. The read-then-
 * toggle race is accepted (solo-CLI assumption).
 */
export function buildToggleCommand(deps: ToggleDeps, enable: boolean): Command {
  const verb = enable ? "enable" : "disable";
  return new Command(verb)
    .description(
      `${enable ? "Enable" : "Disable"} a schedule (idempotent — a no-op if already ${verb}d)`,
    )
    .argument("<schedule-id>", "Schedule id (from `dam schedule list`)")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the resulting schedule as JSON")
    .addHelpText("after", `\nExamples:\n  dam schedule ${verb} sched-abc123\n`)
    .action(async (id: string, opts: { server?: string; json?: boolean }) => {
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

      if (current.value.enabled === enable) {
        if (opts.json) {
          process.stdout.write(`${JSON.stringify(current.value)}\n`);
        } else {
          process.stdout.write(`Schedule ${id} is already ${verb}d.\n`);
        }
        process.exit(EXIT_SUCCESS);
      }

      const result = await svc.toggle(id);
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
        process.stdout.write(`✓ ${enable ? "Enabled" : "Disabled"} ${id}.\n`);
      }
      process.exit(EXIT_SUCCESS);
    });
}
