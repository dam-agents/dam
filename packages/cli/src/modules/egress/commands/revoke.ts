import { Command } from "commander";
import { printServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import type { EgressService } from "../services/egress-service.js";

export function buildRevokeCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createEgressService: (host: string) => EgressService;
}): Command {
  return new Command("revoke")
    .description(
      "Delete a network access rule. Idempotent — unknown IDs exit 0.",
    )
    .argument("<rule-id>", "Rule UUID (copy from `dam network list`)")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit { ok, id } as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n  dam network revoke 3f2a8c0e-2b91-4d6a-9c1b-7e8a1f0a2b3c\n",
    )
    .action(async (id: string, opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, {
        flag: opts.server ? { server: opts.server } : undefined,
        exitCodes: {
          runtimeFailure: EXIT_RUNTIME_FAILURE,
          belowFloor: EXIT_BELOW_FLOOR,
        },
      });

      const result = await deps.createEgressService(host).revoke(id);
      if (!result.ok) {
        printServiceError(result.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }

      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ ok: true, id })}\n`);
      } else {
        process.stdout.write(`✓ Revoked rule ${id}.\n`);
      }
      process.exit(EXIT_SUCCESS);
    });
}
