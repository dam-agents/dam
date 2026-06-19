import { Command } from "commander";
import { printServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import type { EgressService } from "../services/egress-service.js";

export function buildTrustedHostsCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createEgressService: (host: string) => EgressService;
}): Command {
  return new Command("trusted-hosts")
    .description("List the platform-wide hosts seeded by the `trusted` preset")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw JSON instead of one host per line")
    .addHelpText(
      "after",
      "\nExamples:\n  dam network trusted-hosts\n  dam network trusted-hosts --json\n",
    )
    .action(async (opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, {
        flag: opts.server ? { server: opts.server } : undefined,
        exitCodes: {
          runtimeFailure: EXIT_RUNTIME_FAILURE,
          belowFloor: EXIT_BELOW_FLOOR,
        },
      });

      const result = await deps.createEgressService(host).trustedHosts();
      if (!result.ok) {
        printServiceError(result.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }

      const out = opts.json
        ? `${JSON.stringify(result.value)}\n`
        : result.value.length > 0
          ? `${result.value.join("\n")}\n`
          : "";
      return writeStdoutAndExit(out, EXIT_SUCCESS);
    });
}
