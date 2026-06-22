import { cancel, isCancel } from "@clack/prompts";
import { Command } from "commander";
import { printServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { promptSecret } from "../../shared/prompt-secret.js";
import { resolveConnectionRef } from "../domain/connection-ref.js";
import type { ConnectionService } from "../services/connection-service.js";

export function buildUpdateCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createConnectionService: (host: string) => ConnectionService;
}): Command {
  return new Command("update")
    .description("Replace a connection's stored credential value")
    .argument(
      "<id-or-name>",
      "Connection id ('conn-…') or unique name (from `dam connection list`)",
    )
    .option(
      "--value <value>",
      "the new credential value (prompts securely if omitted)",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit { ok, id, name } as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam connection update conn-61cc7b9137b0 --value sk-ant-...\n" +
        "  dam connection update anthropic   # prompts for the value\n",
    )
    .action(
      async (
        ref: string,
        opts: { value?: string; server?: string; json?: boolean },
      ) => {
        const host = await resolveActiveHost(deps, {
          flag: opts.server ? { server: opts.server } : undefined,
          exitCodes: {
            runtimeFailure: EXIT_RUNTIME_FAILURE,
            belowFloor: EXIT_BELOW_FLOOR,
          },
        });

        const svc = deps.createConnectionService(host);

        const listed = await svc.list();
        if (!listed.ok) {
          printServiceError(listed.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }
        const match = resolveConnectionRef(listed.value, ref);
        if (!match) {
          process.stderr.write(
            `error: no connection with id or name '${ref}'\n`,
          );
          process.stderr.write(
            "hint: run `dam connection list` to see ids and names\n",
          );
          process.exit(EXIT_INVALID_INPUT);
        }

        if (match.authKind !== "header") {
          process.stderr.write(
            `error: only header-credential connections can be updated; '${match.name}' uses ${match.authKind} auth\n`,
          );
          process.exit(EXIT_INVALID_INPUT);
        }

        let value = opts.value;
        if (value === undefined) {
          if (!process.stdin.isTTY) {
            process.stderr.write(
              "error: pass --value <value> when not running interactively\n",
            );
            process.exit(EXIT_INVALID_INPUT);
          }
          const entered = await promptSecret(
            `New credential value for ${match.name}`,
          );
          if (isCancel(entered)) {
            cancel("Cancelled");
            process.exit(EXIT_SUCCESS);
          }
          value = entered;
        }

        const result = await svc.update(match.id, value);
        if (!result.ok) {
          printServiceError(result.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        if (opts.json) {
          process.stdout.write(
            `${JSON.stringify({ ok: true, id: match.id, name: match.name })}\n`,
          );
        } else {
          process.stdout.write(`✓ Updated ${match.name} (${match.id}).\n`);
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}
