import { Command } from "commander";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { confirm, exitCancelled } from "../../shared/prompt.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { printServiceError } from "../../shared/trpc/print.js";
import type { TermsService } from "../services/terms-service.js";

export function buildAcceptCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createTermsService: (host: string) => TermsService;
}): Command {
  return new Command("accept")
    .description(
      "Accept the current Terms of Use — interactive on a TTY, use --yes for CI/headless",
    )
    .option(
      "--yes",
      "accept without the interactive confirmation (required on a non-TTY)",
    )
    .option(
      "--expect-version <version>",
      "assert the version you reviewed; fails if it differs from the server's current version (not named --version, which is reserved for the CLI's own version)",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the acceptance result as JSON")
    .action(
      async (opts: {
        yes?: boolean;
        expectVersion?: string;
        server?: string;
        json?: boolean;
      }) => {
        const host = await resolveActiveHost(deps, {
          flag: opts.server ? { server: opts.server } : undefined,
          exitCodes: {
            runtimeFailure: EXIT_RUNTIME_FAILURE,
            belowFloor: EXIT_BELOW_FLOOR,
          },
        });
        if (!opts.yes && !process.stdin.isTTY) {
          process.stderr.write(
            "error: refusing to accept the Terms of Use non-interactively without --yes\nhint: re-run with --yes to accept in a script or CI\n",
          );
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        const service = deps.createTermsService(host);
        const doc = await service.document();
        if (!doc.ok) {
          printServiceError(doc.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }
        const currentVersion = doc.value.version;

        if (opts.expectVersion && opts.expectVersion !== currentVersion) {
          process.stderr.write(
            `error: reviewed version ${opts.expectVersion} does not match the server's current version ${currentVersion}; re-review before accepting\n`,
          );
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        if (!opts.yes) {
          process.stderr.write(
            `Terms of Use — version ${currentVersion}\n\n${doc.value.text}\n\n`,
          );
          if (
            !(await confirm("Accept the Terms of Use?", {
              timeoutMs: 15 * 60_000,
            }))
          )
            exitCancelled({ json: opts.json });
        }

        const accepted = await service.accept(currentVersion);
        if (!accepted.ok) {
          if (
            accepted.error.kind === "transport" &&
            accepted.error.serverCode === "PRECONDITION_FAILED"
          ) {
            process.stderr.write(
              "error: the Terms of Use changed while you were reviewing; re-run `dam terms accept` to review the current version\n",
            );
          } else {
            printServiceError(accepted.error, host);
          }
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        if (opts.json) {
          return writeStdoutAndExit(
            `${JSON.stringify({ accepted: true, version: currentVersion })}\n`,
            EXIT_SUCCESS,
          );
        }
        return writeStdoutAndExit(
          `Accepted Terms of Use ${currentVersion}.\n`,
          EXIT_SUCCESS,
        );
      },
    );
}
