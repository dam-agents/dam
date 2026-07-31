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

/** What `value` means per auth kind — the server dispatches on the same
 *  distinction, so the prompt has to name the right secret. */
const SECRET_LABELS: Record<string, string> = {
  header: "New credential value",
  "client-credentials": "New client secret",
  "github-app": "New private key (PEM)",
  // Its own client secret, not its tokens — those come from `reauth`. Only
  // connections carrying their own qualify; the server rejects the rest.
  oauth: "New OAuth client secret",
};

export function buildUpdateCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createConnectionService: (host: string) => ConnectionService;
}): Command {
  return new Command("update")
    .description("Replace a connection's stored credential")
    .argument(
      "<id-or-name>",
      "Connection id ('conn-…') or unique name (from `dam connection list`)",
    )
    .option(
      "--value <value>",
      "the new secret — the injected value, client secret, or private key, " +
        "depending on the connection's auth kind (prompts securely if omitted)",
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
        "  dam connection update anthropic   # prompts for the value\n" +
        '  dam connection update my-github-app --value "$(cat app.pem)"\n' +
        "\nA multi-line secret (a PEM private key) can't be typed at the\n" +
        "prompt — pass it with --value, as in the last example.\n" +
        "\nOn an OAuth connection this rotates its *client secret* (only when the\n" +
        "connection carries its own). To replace expired tokens, re-consent:\n" +
        "  dam connection reauth <id-or-name>\n",
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

        // The server is the authority on which kinds accept an update (and
        // rejects the rest with its own message); only "nothing is stored" is
        // decidable here.
        if (match.authKind === "none") {
          process.stderr.write(
            `error: '${match.name}' stores no credential to update\n`,
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
          if (match.authKind === "github-app") {
            process.stderr.write(
              "note: a PEM key can't be typed at the prompt — " +
                'pass --value "$(cat app.pem)" instead\n',
            );
          }
          const label = SECRET_LABELS[match.authKind] ?? "New credential value";
          const entered = await promptSecret(`${label} for ${match.name}`);
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
