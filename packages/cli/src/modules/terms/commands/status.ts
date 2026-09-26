import { Command } from "commander";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_SUCCESS,
  EXIT_TERMS_NOT_ACCEPTED,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
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
      const host = await resolveActiveHost(deps, opts.server);
      const service = deps.createTermsService(host);
      const [current, latest] = await Promise.all([
        service.current(),
        service.latestAcceptance(),
      ]);
      exitOnServiceError(current, host);
      exitOnServiceError(latest, host);

      const acceptedVersion = latest.value?.version ?? null;
      const accepted = acceptedVersion === current.value.version;
      const exitCode = accepted ? EXIT_SUCCESS : EXIT_TERMS_NOT_ACCEPTED;

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
