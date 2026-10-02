import { cancel, isCancel, text } from "@clack/prompts";
import { Command } from "commander";
import type {
  ConnectionAuthKind,
  ConnectionSigv4KeyPair,
} from "api-server-api";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { promptSecret } from "../../shared/prompt-secret.js";
import { resolveConnectionRef } from "../domain/connection-ref.js";
import type { ConnectionService } from "../services/connection-service.js";

const SECRET_LABELS: Record<
  Exclude<ConnectionAuthKind, "none" | "sigv4">,
  string
> = {
  header: "New credential value",
  "client-credentials": "New client secret",
  "github-app": "New private key (PEM)",
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
      "--access-key-id <id>",
      "the new HMAC access key ID (S3-compatible storage; prompts if omitted)",
    )
    .option(
      "--secret-access-key <key>",
      "the new HMAC secret access key (S3-compatible storage; prompts securely if omitted)",
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
        "  dam connection update my-bucket --access-key-id ... --secret-access-key ...\n" +
        "\nA multi-line secret (a PEM private key) can't be typed at the\n" +
        "prompt — pass it with --value, as in the last example.\n" +
        "\nOn an OAuth connection this rotates its *client secret* (only when the\n" +
        "connection carries its own). To replace expired tokens, re-consent:\n" +
        "  dam connection reauth <id-or-name>\n",
    )
    .action(
      async (
        ref: string,
        opts: {
          value?: string;
          accessKeyId?: string;
          secretAccessKey?: string;
          server?: string;
          json?: boolean;
        },
      ) => {
        const host = await resolveActiveHost(deps, opts.server);

        const svc = deps.createConnectionService(host);

        const listed = await svc.list();
        exitOnServiceError(listed, host);
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

        if (match.authKind === "none") {
          process.stderr.write(
            `error: '${match.name}' stores no credential to update\n`,
          );
          process.exit(EXIT_INVALID_INPUT);
        }

        let credential: string | ConnectionSigv4KeyPair;
        if (match.authKind === "sigv4") {
          let accessKeyId = opts.accessKeyId;
          let secretAccessKey = opts.secretAccessKey;
          if (accessKeyId === undefined || secretAccessKey === undefined) {
            if (!process.stdin.isTTY) {
              process.stderr.write(
                "error: pass --access-key-id and --secret-access-key when not running interactively\n",
              );
              process.exit(EXIT_INVALID_INPUT);
            }
            if (accessKeyId === undefined) {
              const entered = await text({
                message: `New access key ID for ${match.name}`,
                validate: (v) =>
                  !v || v.trim() === "" ? "Required" : undefined,
              });
              if (isCancel(entered)) {
                cancel("Cancelled");
                process.exit(EXIT_SUCCESS);
              }
              accessKeyId = entered;
            }
            if (secretAccessKey === undefined) {
              const entered = await promptSecret(
                `New secret access key for ${match.name}`,
              );
              if (isCancel(entered)) {
                cancel("Cancelled");
                process.exit(EXIT_SUCCESS);
              }
              secretAccessKey = entered;
            }
          }
          credential = {
            accessKeyId: accessKeyId.trim(),
            secretAccessKey: secretAccessKey.trim(),
          };
        } else {
          credential = await await resolveSingleValue(
            match.authKind,
            match.name,
            opts.value,
          );
        }

        const result = await svc.update(match.id, credential);
        exitOnServiceError(result, host);

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

async function resolveSingleValue(
  authKind: Exclude<ConnectionAuthKind, "none" | "sigv4">,
  name: string,
  given: string | undefined,
): Promise<string> {
  if (given !== undefined) return given;
  if (!process.stdin.isTTY) {
    process.stderr.write(
      "error: pass --value <value> when not running interactively\n",
    );
    process.exit(EXIT_INVALID_INPUT);
  }
  if (authKind === "github-app") {
    process.stderr.write(
      "note: a PEM key can't be typed at the prompt — " +
        'pass --value "$(cat app.pem)" instead\n',
    );
  }
  const entered = await promptSecret(`${SECRET_LABELS[authKind]} for ${name}`);
  if (isCancel(entered)) {
    cancel("Cancelled");
    process.exit(EXIT_SUCCESS);
  }
  return entered;
}
