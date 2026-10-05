import { cancel, isCancel, text } from "@clack/prompts";
import { Command } from "commander";
import type {
  ConnectionAuthKind,
  ConnectionCredentialUpdate,
  ConnectionView,
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

interface UpdateOptions {
  value?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  server?: string;
  json?: boolean;
}

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
      "the new access key ID of an Object Storage connection " +
        "(prompts if omitted)",
    )
    .option(
      "--secret-access-key <key>",
      "the new secret access key of an Object Storage connection " +
        "(prompts securely if omitted)",
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
        "  dam connection update my-bucket --access-key-id … --secret-access-key …\n" +
        "\nA multi-line secret (a PEM private key) can't be typed at the\n" +
        "prompt — pass it with --value, as in the third example.\n" +
        "\nAn Object Storage connection rotates both HMAC keys at once:\n" +
        "pass --access-key-id and --secret-access-key, or answer the prompts.\n" +
        "The new pair is verified against the endpoint before it is stored.\n" +
        "\nOn an OAuth connection this rotates its *client secret* (only when the\n" +
        "connection carries its own). To replace expired tokens, re-consent:\n" +
        "  dam connection reauth <id-or-name>\n",
    )
    .action(async (ref: string, opts: UpdateOptions) => {
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

      if (match.authKind === "none") {
        process.stderr.write(
          `error: '${match.name}' stores no credential to update\n`,
        );
        process.exit(EXIT_INVALID_INPUT);
      }

      const credential =
        match.authKind === "sigv4"
          ? await collectKeyPair(match, opts)
          : await collectValue(match, SECRET_LABELS[match.authKind], opts);

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
    });
}

async function collectValue(
  match: ConnectionView,
  label: string,
  opts: UpdateOptions,
): Promise<ConnectionCredentialUpdate> {
  if (opts.accessKeyId !== undefined || opts.secretAccessKey !== undefined) {
    process.stderr.write(
      `error: '${match.name}' stores a single credential — pass it with --value\n`,
    );
    process.exit(EXIT_INVALID_INPUT);
  }
  if (opts.value !== undefined) return { value: opts.value };
  requireTty("pass --value <value> when not running interactively");
  if (match.authKind === "github-app") {
    process.stderr.write(
      "note: a PEM key can't be typed at the prompt — " +
        'pass --value "$(cat app.pem)" instead\n',
    );
  }
  const entered = await promptSecret(`${label} for ${match.name}`);
  if (isCancel(entered)) exitCancelled();
  return { value: entered };
}

async function collectKeyPair(
  match: ConnectionView,
  opts: UpdateOptions,
): Promise<ConnectionCredentialUpdate> {
  if (opts.value !== undefined) {
    process.stderr.write(
      `error: '${match.name}' stores a key pair — pass --access-key-id and --secret-access-key\n`,
    );
    process.exit(EXIT_INVALID_INPUT);
  }
  let accessKeyId = opts.accessKeyId;
  if (accessKeyId === undefined) {
    requireTty("pass --access-key-id <id> when not running interactively");
    const entered = await text({
      message: `New access key ID for ${match.name}`,
      validate: (v) => (v && v.trim().length > 0 ? undefined : "Required"),
    });
    if (isCancel(entered)) exitCancelled();
    accessKeyId = String(entered).trim();
  }
  let secretAccessKey = opts.secretAccessKey;
  if (secretAccessKey === undefined) {
    requireTty("pass --secret-access-key <key> when not running interactively");
    const entered = await promptSecret(
      `New secret access key for ${match.name}`,
    );
    if (isCancel(entered)) exitCancelled();
    secretAccessKey = entered;
  }
  return { accessKeyId, secretAccessKey };
}

function requireTty(hint: string): void {
  if (process.stdin.isTTY) return;
  process.stderr.write(`error: ${hint}\n`);
  process.exit(EXIT_INVALID_INPUT);
}

function exitCancelled(): never {
  cancel("Cancelled");
  process.exit(EXIT_SUCCESS);
}
