import { Command } from "commander";
import { ChannelType } from "api-server-api";
import { printServiceError } from "../../agent/commands/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import type { ChannelService } from "../services/channel-service.js";

// Stable display order, independent of the order the server returns keys in.
const PROVIDER_ORDER: readonly ChannelType[] = [
  ChannelType.Slack,
  ChannelType.Telegram,
];

export function buildAvailableCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createChannelService: (host: string) => ChannelService;
}): Command {
  return new Command("available")
    .description(
      "List the messenger providers the operator enabled on this host",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the raw { slack?, telegram? } object as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam channel available\n" +
        "  dam channel available --json\n",
    )
    .action(async (opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, {
        flag: opts.server ? { server: opts.server } : undefined,
        exitCodes: {
          runtimeFailure: EXIT_RUNTIME_FAILURE,
          belowFloor: EXIT_BELOW_FLOOR,
        },
      });
      const svc = deps.createChannelService(host);

      const res = await svc.available();
      if (!res.ok) {
        printServiceError(res.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }

      if (opts.json) {
        return writeStdoutAndExit(
          `${JSON.stringify(res.value)}\n`,
          EXIT_SUCCESS,
        );
      }

      const enabled = PROVIDER_ORDER.filter((p) => res.value[p]);
      if (enabled.length === 0) {
        process.stderr.write("No messenger channels enabled on this host.\n");
        process.exit(EXIT_SUCCESS);
      }
      const lines = enabled.map((p) => `${p.padEnd(10)}enabled`).join("\n");
      return writeStdoutAndExit(`${lines}\n`, EXIT_SUCCESS);
    });
}
