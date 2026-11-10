import { Command } from "commander";
import { firstResultKindSchema } from "api-server-api";

import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { OnboardingService } from "../services/onboarding-service.js";

const KINDS = firstResultKindSchema.options;

export function buildFirstResultCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createOnboardingService: (host: string) => OnboardingService;
}): Command {
  return new Command("first-result")
    .description(
      `Record the person's first result — ${KINDS.join(", ")} — once; a later call is a no-op answered with the first one`,
    )
    .argument("<kind>", `one of: ${KINDS.join(", ")}`)
    .option(
      "--ref <ref>",
      "what the result is, for the person reading it later",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the recorded result as JSON")
    .action(
      async (
        kind: string,
        opts: { ref?: string; server?: string; json?: boolean },
      ) => {
        const parsed = firstResultKindSchema.safeParse(kind);
        if (!parsed.success) {
          process.stderr.write(
            `unknown kind "${kind}": expected one of ${KINDS.join(", ")}\n`,
          );
          process.exit(EXIT_INVALID_INPUT);
        }
        const host = await resolveActiveHost(deps, opts.server);
        const service = deps.createOnboardingService(host);
        const result = await service.recordFirstResult({
          kind: parsed.data,
          ...(opts.ref === undefined ? {} : { ref: opts.ref }),
        });
        exitOnServiceError(result, host);
        const first = result.value;
        if (opts.json)
          return writeStdoutAndExit(`${JSON.stringify(first)}\n`, EXIT_SUCCESS);
        return writeStdoutAndExit(
          first === null
            ? "Nothing recorded: this person has no onboarding to record a first result on.\n"
            : `First result recorded: ${first.kind}${first.ref ? ` (${first.ref})` : ""}, ${first.at}.\n`,
          EXIT_SUCCESS,
        );
      },
    );
}
