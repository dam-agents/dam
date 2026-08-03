import { Command } from "commander";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { printServiceError } from "../../shared/trpc/print.js";
import type { TermsService } from "../services/terms-service.js";

export function buildShowCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createTermsService: (host: string) => TermsService;
}): Command {
  return new Command("show")
    .description(
      "Print the current Terms of Use text, version, and your acceptance state",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the raw Terms of Use document as JSON")
    .action(async (opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, {
        flag: opts.server ? { server: opts.server } : undefined,
        exitCodes: {
          runtimeFailure: EXIT_RUNTIME_FAILURE,
          belowFloor: EXIT_BELOW_FLOOR,
        },
      });
      const service = deps.createTermsService(host);
      const [doc, latest] = await Promise.all([
        service.document(),
        service.latestAcceptance(),
      ]);
      if (!doc.ok) {
        printServiceError(doc.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }
      if (!latest.ok) {
        printServiceError(latest.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }

      if (opts.json) {
        return writeStdoutAndExit(
          `${JSON.stringify(doc.value)}\n`,
          EXIT_SUCCESS,
        );
      }

      const acceptState = !latest.value
        ? "Not accepted."
        : latest.value.version === doc.value.version
          ? `Accepted on ${new Date(latest.value.acceptedAt).toISOString()}.`
          : `You accepted version ${latest.value.version}; version ${doc.value.version} is current and not yet accepted.`;
      return writeStdoutAndExit(
        `Terms of Use — version ${doc.value.version}\n${acceptState}\n\n${doc.value.text}\n`,
        EXIT_SUCCESS,
      );
    });
}
