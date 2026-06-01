import { Command } from "commander";
import { printServiceError } from "../../agent/commands/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import type { ConnectionService } from "../services/connection-service.js";

export function buildDisconnectCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createConnectionService: (host: string) => ConnectionService;
}): Command {
  return new Command("disconnect")
    .description("Remove a team connection (deletes the stored credential)")
    .argument("<id>", "Connection id (copy from `dam connection list`)")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit { ok, id } as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n  dam connection disconnect conn-61cc7b9137b0\n",
    )
    .action(async (id: string, opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, {
        flag: opts.server ? { server: opts.server } : undefined,
        exitCodes: {
          runtimeFailure: EXIT_RUNTIME_FAILURE,
          belowFloor: EXIT_BELOW_FLOOR,
        },
      });

      const result = await deps.createConnectionService(host).disconnect(id);
      if (!result.ok) {
        printServiceError(result.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }

      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ ok: true, id })}\n`);
      } else {
        process.stdout.write(`✓ Disconnected ${id}.\n`);
      }
      process.exit(EXIT_SUCCESS);
    });
}
