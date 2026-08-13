import { Command } from "commander";
import { printServiceError } from "../../shared/trpc/print.js";
import type { BrowserOpener } from "../../auth/index.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { resolveConnectionRef } from "../domain/connection-ref.js";
import type { ConnectionService } from "../services/connection-service.js";

const POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_SECONDS = 300;

export function buildReauthCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createConnectionService: (host: string) => ConnectionService;
  browserOpener: BrowserOpener;
}): Command {
  return new Command("reauth")
    .description("Re-run login and consent for an existing OAuth connection")
    .argument(
      "<id-or-name>",
      "Connection id ('conn-…') or unique name (from `dam connection list`)",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit { ok, id, name } as JSON")
    .option("--no-browser", "print the authorize URL instead of opening it")
    .option(
      "--timeout <seconds>",
      "how long to wait for authorization",
      String(DEFAULT_TIMEOUT_SECONDS),
    )
    .addHelpText(
      "after",
      "\nRe-authentication keeps the connection's identity and every sandbox\n" +
        "grant; only its tokens are replaced. Use it when a connection shows\n" +
        "expired, or to re-consent after its template gained scopes.\n" +
        "\nExamples:\n" +
        "  dam connection reauth github\n" +
        "  dam connection reauth conn-61cc7b9137b0 --no-browser\n" +
        "\nConnections that store their own secret take a new one instead:\n" +
        "  dam connection update <id-or-name>\n",
    )
    .action(
      async (
        ref: string,
        opts: {
          server?: string;
          json?: boolean;
          browser?: boolean;
          timeout?: string;
        },
      ) => {
        const json = opts.json ?? false;
        const timeoutSeconds = parseTimeout(opts.timeout);
        if (timeoutSeconds === null) {
          process.stderr.write("error: --timeout must be a positive integer\n");
          process.exit(EXIT_INVALID_INPUT);
        }

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
        if (match.authKind !== "oauth") {
          process.stderr.write(
            `error: '${match.name}' uses ${match.authKind} auth, which has no login flow\n`,
          );
          process.stderr.write(
            `hint: replace its stored credential with \`dam connection update ${match.name}\`\n`,
          );
          process.exit(EXIT_INVALID_INPUT);
        }

        const connectedAtBefore = match.connectedAt;

        const started = await svc.startOAuth(match.id);
        if (!started.ok) {
          printServiceError(started.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }
        const { authUrl } = started.value;

        const noBrowser = opts.browser === false;
        if (noBrowser) {
          process.stderr.write(`Open this URL to authorize:\n  ${authUrl}\n`);
        } else {
          const opened = await deps.browserOpener.open(authUrl);
          if (!opened.ok) {
            process.stderr.write(
              `Couldn't open a browser. Open this URL to authorize:\n  ${authUrl}\n`,
            );
          }
        }
        process.stderr.write("Waiting for authorization…\n");

        const landed = await pollUntilReconnected(
          svc,
          match.id,
          connectedAtBefore,
          timeoutSeconds,
        );
        if (!landed) {
          process.stderr.write(
            `error: couldn't confirm the re-authentication finished within ${timeoutSeconds}s; ` +
              "it may still complete — check `dam connection list`\n",
          );
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        if (json) {
          process.stdout.write(
            `${JSON.stringify({ ok: true, id: match.id, name: match.name })}\n`,
          );
        } else {
          process.stdout.write(
            `✓ Re-authenticated ${match.name} (${match.id}).\n`,
          );
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}

async function pollUntilReconnected(
  svc: ConnectionService,
  id: string,
  connectedAtBefore: string | undefined,
  timeoutSeconds: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (true) {
    const res = await svc.getConnection(id);
    if (res.ok && res.value && res.value.connectedAt !== connectedAtBefore) {
      return true;
    }
    if (Date.now() + POLL_INTERVAL_MS >= deadline) return false;
    await sleep(POLL_INTERVAL_MS);
  }
}

function parseTimeout(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_TIMEOUT_SECONDS;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
