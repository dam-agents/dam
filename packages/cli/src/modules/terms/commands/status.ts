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

export function buildStatusCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createTermsService: (host: string) => TermsService;
}): Command {
  return new Command("status")
    .description(
      "Check whether you've accepted the current Terms of Use — no text dump; exits non-zero when not accepted, so it works as a CI gate",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the acceptance state as JSON")
    .action(async (opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, {
        flag: opts.server ? { server: opts.server } : undefined,
        exitCodes: {
          runtimeFailure: EXIT_RUNTIME_FAILURE,
          belowFloor: EXIT_BELOW_FLOOR,
        },
      });
      const service = deps.createTermsService(host);
      const [current, latest] = await Promise.all([
        service.current(),
        service.latestAcceptance(),
      ]);
      if (!current.ok) {
        printServiceError(current.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }
      if (!latest.ok) {
        printServiceError(latest.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }

      const acceptedVersion = latest.value?.version ?? null;
      const accepted = acceptedVersion === current.value.version;
      const exitCode = accepted ? EXIT_SUCCESS : EXIT_RUNTIME_FAILURE;

      if (opts.json) {
        return writeStdoutAndExit(
          `${JSON.stringify({ currentVersion: current.value.version, acceptedVersion, accepted })}\n`,
          exitCode,
        );
      }

      const line = accepted
        ? `Terms of Use ${current.value.version}: accepted.`
        : acceptedVersion
          ? `Terms of Use ${current.value.version}: NOT accepted (you accepted ${acceptedVersion}).`
          : `Terms of Use ${current.value.version}: NOT accepted (no acceptance on record).`;
      return writeStdoutAndExit(`${line}\n`, exitCode);
    });
}
