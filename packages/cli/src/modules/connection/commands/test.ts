import { Command } from "commander";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { resolveConnectionRef } from "../domain/connection-ref.js";
import { credentialCheckSummary } from "../domain/credential-check.js";
import type { ConnectionService } from "../services/connection-service.js";

export function buildTestCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createConnectionService: (host: string) => ConnectionService;
}): Command {
  return new Command("test")
    .description("Check a connection's stored credential again")
    .argument(
      "<id-or-name>",
      "Connection id ('conn-…') or unique name (from `dam connection list`)",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option(
      "--json",
      "emit { id, name, check } as JSON; check { status: passed|failed|unchecked, account?, expiresAt?, scopes?, reason?, at }",
    )
    .addHelpText(
      "after",
      "\nThe server uses the stored credential the way an agent does: a GitHub token\n" +
        "against GitHub's user endpoint, a Kubernetes token in a SelfSubjectReview on\n" +
        "its cluster's API server, a model provider key against the provider.\n" +
        "The result replaces the one `dam connection list --json` shows.\n" +
        "\nExit codes: 0 the check passed, 1 it failed or could not run,\n" +
        "2 the connection has no check.\n" +
        "\nExamples:\n" +
        "  dam connection test github-pat\n" +
        "  dam connection test conn-61cc7b9137b0 --json\n",
    )
    .action(async (ref: string, opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, opts.server);
      const svc = deps.createConnectionService(host);

      const listed = await svc.list();
      exitOnServiceError(listed, host);
      const match = resolveConnectionRef(listed.value, ref);
      if (!match) {
        process.stderr.write(`error: no connection with id or name '${ref}'\n`);
        process.stderr.write(
          "hint: run `dam connection list` to see ids and names\n",
        );
        process.exit(EXIT_INVALID_INPUT);
      }

      const res = await svc.checkCredential(match.id);
      exitOnServiceError(res, host);
      const check = res.value;
      if (!check) {
        process.stderr.write(
          `error: '${match.name}' has no credential check; ` +
            "GitHub and Kubernetes tokens and model provider keys have one\n",
        );
        process.exit(EXIT_INVALID_INPUT);
      }

      const code =
        check.status === "passed" ? EXIT_SUCCESS : EXIT_RUNTIME_FAILURE;
      if (opts.json) {
        return writeStdoutAndExit(
          `${JSON.stringify({ id: match.id, name: match.name, check })}\n`,
          code,
        );
      }
      if (check.status !== "passed") {
        process.stderr.write(
          `hint: replace it with \`dam connection update ${match.name}\`\n`,
        );
      }
      return writeStdoutAndExit(
        `${match.name} (${match.id}): ${credentialCheckSummary(check)}\n`,
        code,
      );
    });
}
