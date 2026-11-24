import { Command } from "commander";
import { securityCheckReportInputSchema } from "api-server-api";

import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { SecurityCheckService } from "../services/security-check-service.js";

const collect = (value: string, previous: string[]): string[] => [
  ...previous,
  value,
];

export function buildReportCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createSecurityCheckService: (host: string) => SecurityCheckService;
}): Command {
  return new Command("report")
    .description(
      "Report what the security check of the person's setup found: one --problem per problem, or none when the setup is fine, which clears the alert",
    )
    .option(
      "--problem <title>",
      "a short title of one problem, for the alert the person reads; repeat it for each problem",
      collect,
      [],
    )
    .option(
      "--update",
      "say what is left of the same check after a fix, so an alert the person dismissed stays dismissed",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the recorded report as JSON")
    .action(
      async (opts: {
        problem: string[];
        update?: boolean;
        server?: string;
        json?: boolean;
      }) => {
        const parsed = securityCheckReportInputSchema.safeParse({
          problems: opts.problem,
          ...(opts.update === true ? { update: true } : {}),
        });
        if (!parsed.success) {
          process.stderr.write(
            `invalid report: ${parsed.error.issues.map((issue) => issue.message).join("; ")}\n`,
          );
          process.exit(EXIT_INVALID_INPUT);
        }
        const host = await resolveActiveHost(deps, opts.server);
        const service = deps.createSecurityCheckService(host);
        const result = await service.report(parsed.data);
        exitOnServiceError(result, host);
        const report = result.value;
        if (opts.json)
          return writeStdoutAndExit(
            `${JSON.stringify(report)}\n`,
            EXIT_SUCCESS,
          );
        return writeStdoutAndExit(
          report === null
            ? "Nothing recorded: this person has no security check to report on.\n"
            : report.problems.length === 0
              ? "Reported: no problems. The alert is cleared.\n"
              : `Reported: ${String(report.problems.length)} problem(s). The person gets an alert that opens this check's chat.\n`,
          EXIT_SUCCESS,
        );
      },
    );
}
