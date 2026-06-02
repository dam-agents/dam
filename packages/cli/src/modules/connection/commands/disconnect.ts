import { Command } from "commander";
import { printServiceError } from "../../agent/commands/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { resolveConnectionRef } from "../domain/connection-ref.js";
import type { ConnectionService } from "../services/connection-service.js";

export function buildDisconnectCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createConnectionService: (host: string) => ConnectionService;
}): Command {
  return new Command("disconnect")
    .description("Remove a team connection (deletes the stored credential)")
    .argument(
      "<id-or-name>",
      "Connection id ('conn-…') or unique name (from `dam connection list`)",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit { ok, id, name } as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam connection disconnect conn-61cc7b9137b0\n" +
        "  dam connection disconnect my-mcp-server\n",
    )
    .action(async (ref: string, opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, {
        flag: opts.server ? { server: opts.server } : undefined,
        exitCodes: {
          runtimeFailure: EXIT_RUNTIME_FAILURE,
          belowFloor: EXIT_BELOW_FLOOR,
        },
      });

      const svc = deps.createConnectionService(host);

      // Resolve the ref to a real connection first — the server's delete is
      // idempotent (an unknown id succeeds), so without this an id-typo or a
      // name would report a false "Disconnected".
      const listed = await svc.list();
      if (!listed.ok) {
        printServiceError(listed.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }
      const match = resolveConnectionRef(listed.value, ref);
      if (!match) {
        process.stderr.write(`error: no connection with id or name '${ref}'\n`);
        process.stderr.write(
          "hint: run `dam connection list` to see ids and names\n",
        );
        process.exit(EXIT_INVALID_INPUT);
      }

      const result = await svc.disconnect(match.id);
      if (!result.ok) {
        printServiceError(result.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }

      if (opts.json) {
        process.stdout.write(
          `${JSON.stringify({ ok: true, id: match.id, name: match.name })}\n`,
        );
      } else {
        process.stdout.write(`✓ Disconnected ${match.name} (${match.id}).\n`);
      }
      process.exit(EXIT_SUCCESS);
    });
}
