import { cancel, isCancel, text } from "@clack/prompts";
import { Command, Option } from "commander";
import type {
  ConnectionAuthKind,
  ConnectionCredentialUpdate,
  ConnectionView,
  CredentialCheck,
} from "api-server-api";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { BrowserOpener } from "../../auth/index.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { promptSecret } from "../../shared/prompt-secret.js";
import {
  resolveConnectionRef,
  unresolvedConnectionRef,
} from "../domain/connection-ref.js";
import { parentLabel, parentOf } from "../domain/github-parent.js";
import { credentialCheckWarning } from "../domain/credential-check.js";
import type { ConnectionService } from "../services/connection-service.js";
import { enterSecretOnPage, PAGE_SECRET_FIELDS } from "./secret-page.js";

const DEFAULT_TIMEOUT_SECONDS = 300;
const SECRETS_GROUP = "Secrets (for scripts; agents leave these out):";

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
  browser?: boolean;
  prompt?: boolean;
  timeout?: string;
}

export function buildUpdateCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createConnectionService: (host: string) => ConnectionService;
  browserOpener: BrowserOpener;
}): Command {
  return new Command("update")
    .description("Replace a connection's stored credential")
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
      "emit { ok, id, name, check? } as JSON; check is the token check, as in `dam connection test`",
    )
    .option("--no-browser", "print the secret-entry link instead of opening it")
    .option(
      "--prompt",
      "ask for the secret at a hidden terminal prompt instead of on a web page",
    )
    .option(
      "--timeout <seconds>",
      "how long to wait for the secret to be entered on the web page",
      String(DEFAULT_TIMEOUT_SECONDS),
    )
    .addOption(
      new Option(
        "--value <value>",
        "the new secret — the injected value, client secret, or private key, " +
          "depending on the connection's auth kind — omit to enter it on a DAM web page " +
          "(an OAuth client secret: at a hidden prompt)",
      ).helpGroup(SECRETS_GROUP),
    )
    .addOption(
      new Option(
        "--access-key-id <id>",
        "the new access key ID of an Object Storage connection " +
          "— omit both keys to enter them on a DAM web page",
      ).helpGroup(SECRETS_GROUP),
    )
    .addOption(
      new Option(
        "--secret-access-key <key>",
        "the new secret access key of an Object Storage connection " +
          "— omit both keys to enter them on a DAM web page",
      ).helpGroup(SECRETS_GROUP),
    )
    .addHelpText(
      "after",
      "\nWithout the secret, the command opens a DAM web page where the user\n" +
        "enters it, waits until it is saved, and reports the result. Sign in\n" +
        "there as the same user. The page also takes a multi-line PEM key.\n" +
        "\nExamples:\n" +
        "  dam connection update anthropic   # the user enters the value on a DAM web page\n" +
        "  dam connection update conn-61cc7b9137b0 --no-browser   # prints the page link\n" +
        "  dam connection update anthropic --prompt   # asks at a hidden prompt\n" +
        "  dam connection update my-bucket   # both keys, on the page\n" +
        "\nAn Object Storage connection rotates both HMAC keys at once, on the page\n" +
        "or at the prompts. The new pair is verified against the endpoint before\n" +
        "it is stored.\n" +
        "\nThe secret flags are for scripts with nobody at a browser, which read the\n" +
        "secret from their environment; an agent leaves them out:\n" +
        '  dam connection update anthropic --value "$ANTHROPIC_API_KEY" --json\n' +
        "\nA GitHub sign-in or GitHub App installation holds the credential of the\n" +
        "connections made from it: update the sign-in or installation, by its id.\n" +
        "\nOn an OAuth connection this rotates its *client secret* (only when the\n" +
        "connection carries its own). To replace expired tokens, re-consent:\n" +
        "  dam connection reauth <id-or-name>\n",
    )
    .action(async (ref: string, opts: UpdateOptions) => {
      const timeoutSeconds = parseTimeout(opts.timeout);
      const host = await resolveActiveHost(deps, opts.server);

      const svc = deps.createConnectionService(host);

      const listed = await svc.list();
      exitOnServiceError(listed, host);
      const match = resolveConnectionRef(listed.value, ref);
      if (!match) {
        process.stderr.write(unresolvedConnectionRef(listed.value, ref));
        process.exit(EXIT_INVALID_INPUT);
      }
      const parent = parentOf(listed.value, match);
      if (parent) {
        process.stderr.write(
          `error: '${match.name}' was made from the ${parentLabel(parent)} ${parent.name} (${parent.id}), ` +
            "which holds its credential\n" +
            (parent.authKind === "github-app"
              ? `hint: replace the private key with \`dam connection update ${parent.id}\`; ` +
                "every connection made from it gets a new token\n"
              : `hint: sign in again with \`dam connection reauth ${match.name}\`, ` +
                `or rotate the client secret of your own OAuth app with \`dam connection update ${parent.id}\`\n`),
        );
        process.exit(EXIT_INVALID_INPUT);
      }

      if (match.authKind === "none") {
        process.stderr.write(
          `error: '${match.name}' stores no credential to update\n`,
        );
        process.exit(EXIT_INVALID_INPUT);
      }

      if (
        !opts.prompt &&
        opts.value === undefined &&
        opts.accessKeyId === undefined &&
        opts.secretAccessKey === undefined &&
        PAGE_SECRET_FIELDS[match.authKind]
      ) {
        const entered = await enterSecretOnPage({
          svc,
          host,
          browserOpener: deps.browserOpener,
          input: { action: "update", connectionId: match.id },
          noBrowser: opts.browser === false,
          timeoutSeconds,
        });
        if (entered.kind === "saved") {
          emitUpdated(match, opts, entered.check);
          process.exit(EXIT_SUCCESS);
        }
        process.stderr.write(
          "note: this server has no secret-entry page; asking here instead\n",
        );
      }

      const credential =
        match.authKind === "sigv4"
          ? await collectKeyPair(match, opts)
          : await collectValue(match, SECRET_LABELS[match.authKind], opts);

      const result = await svc.update(match.id, credential);
      exitOnServiceError(result, host);

      const updated = await svc.getConnection(match.id);
      emitUpdated(match, opts, updated.ok ? updated.value?.check : undefined);
      process.exit(EXIT_SUCCESS);
    });
}

function emitUpdated(
  match: ConnectionView,
  opts: UpdateOptions,
  check: CredentialCheck | undefined,
): void {
  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        id: match.id,
        name: match.name,
        ...(check ? { check } : {}),
      })}\n`,
    );
  } else {
    process.stdout.write(
      `✓ Updated ${match.name} (${match.id})` +
        (check?.account ? ` as ${check.account}` : "") +
        ".\n",
    );
  }
  const warning = credentialCheckWarning(match.name, check);
  if (warning && !opts.json) process.stderr.write(warning);
}

function parseTimeout(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_TIMEOUT_SECONDS;
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0) return n;
  process.stderr.write("error: --timeout must be a positive integer\n");
  process.exit(EXIT_INVALID_INPUT);
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
  requireTty(
    opts.prompt
      ? "--prompt needs a terminal; drop it to enter the secret on a web page"
      : "pass --value <value> when not running interactively",
  );
  if (match.authKind === "github-app") {
    process.stderr.write(
      "note: a PEM key can't be typed at the prompt — " +
        (opts.prompt
          ? "drop --prompt to paste it on a DAM web page instead\n"
          : "this server has no page for it; pass the key with --value in your own terminal\n"),
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
