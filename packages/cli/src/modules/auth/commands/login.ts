import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import type { ConfigService } from "../../cli/index.js";
import type { AuthEnvReader } from "../infrastructure/auth-env-reader.js";
import type { AuthService, LoginError } from "../services/auth-service.js";
import {
  EXIT_AUTH_BELOW_FLOOR,
  EXIT_AUTH_INVALID_INPUT,
  EXIT_AUTH_RUNTIME_FAILURE,
} from "./exit-codes.js";

const EXIT_AUTH_SUCCESS_OR_ABORT = 0;

export interface LoginCommandDeps {
  authService: AuthService;
  configService: ConfigService;
  authEnvReader: AuthEnvReader;
}

export function buildLoginCommand(deps: LoginCommandDeps): Command {
  return new Command("login")
    .description(
      "Authenticate against a Platform deployment via OAuth 2.0 Device Authorization Grant",
    )
    .option(
      "--server <url>",
      "Platform server URL — persisted as the active host",
    )
    .option(
      "--no-browser",
      "Do not auto-open the browser; print the verification URL instead",
    )
    .option(
      "--force",
      "Skip the re-login confirm prompt when already logged in",
    )
    .action(
      async (opts: { server?: string; browser?: boolean; force?: boolean }) => {
        // Resolve target host: explicit flag → env/file via ConfigService.
        let host = opts.server;
        if (!host) {
          const resolved = await deps.configService.getResolved({});
          if (!resolved.ok) {
            // Distinguish "no server configured" from "config.toml is broken"
            // so the remediation hint matches the underlying cause —
            // matches ping's handling (review §3).
            if (resolved.error.kind === "malformed-config") {
              process.stderr.write(`error: ${resolved.error.reason}\n`);
            } else {
              process.stderr.write(
                "error: no server configured; pass `--server <url>` or run `dam config set server <url>`\n",
              );
            }
            process.exit(EXIT_AUTH_INVALID_INPUT);
          }
          host = resolved.value.server;
        }

        // DAM_TOKEN warning (analysis §3.9): if env shadowing is active,
        // the login still proceeds but the saved creds will be hidden.
        if (deps.authEnvReader.damToken() !== undefined) {
          process.stderr.write(
            `warning: DAM_TOKEN is set; the saved credentials will be shadowed by the env var on every command until you unset it\n`,
          );
        }

        // Re-login confirm prompt is owned by the command — service only
        // signals whether `--force` is required.
        const isTty = Boolean(process.stdin.isTTY);
        const onPromptUser = (info: {
          userCode: string;
          verificationUri: string;
          openedBrowser: boolean;
        }): void => {
          process.stdout.write(
            `Open this URL in a browser to authorize:\n  ${info.verificationUri}\n`,
          );
          process.stdout.write(
            `Confirm the user code:\n  ${info.userCode}\n\n`,
          );
          process.stdout.write(
            info.openedBrowser
              ? "Opened your browser. Waiting for authorization...\n"
              : "Waiting for authorization...\n",
          );
        };
        const attemptLogin = (force: boolean) =>
          deps.authService.login({
            host: host!,
            openBrowser: opts.browser !== false,
            force,
            isTty,
            persistServer: opts.server,
            onPromptUser,
          });

        let result = await attemptLogin(opts.force ?? false);

        // Handle re-login confirm — retry with force after user agreement.
        if (!result.ok && result.error.kind === "aborted") {
          const rl = createInterface({
            input: process.stdin,
            output: process.stderr,
          });
          const answer = (
            await rl.question(
              `Already logged in to ${host}. Reauthorize? [y/N] `,
            )
          )
            .trim()
            .toLowerCase();
          rl.close();
          if (answer !== "y" && answer !== "yes") {
            process.stdout.write("Aborted.\n");
            process.exit(EXIT_AUTH_SUCCESS_OR_ABORT);
          }
          result = await attemptLogin(true);
        }

        if (!result.ok) {
          printLoginError(result.error);
          process.exit(exitCodeFor(result.error));
        }

        for (const w of result.value.warnings) {
          process.stderr.write(`warning: ${w}\n`);
        }
        process.stdout.write(
          `✓ Logged in to ${result.value.host} as ${result.value.username}\n`,
        );
      },
    );
}

function exitCodeFor(e: LoginError): number {
  switch (e.kind) {
    case "below-floor":
      return EXIT_AUTH_BELOW_FLOOR;
    case "requires-force":
      return EXIT_AUTH_INVALID_INPUT;
    case "aborted":
      return EXIT_AUTH_SUCCESS_OR_ABORT;
    case "preflight":
    case "device-flow":
    case "transport":
    case "auth-store":
      return EXIT_AUTH_RUNTIME_FAILURE;
  }
}

function printLoginError(e: LoginError): void {
  switch (e.kind) {
    case "below-floor":
      process.stderr.write(
        `error: CLI ${e.localCli} is below the server's minimum ${e.serverMinClient}; upgrade and retry\n`,
      );
      return;
    case "requires-force":
      process.stderr.write(
        "error: already logged in; pass `--force` to re-authorize without a prompt (non-TTY)\n",
      );
      return;
    case "aborted":
      return;
    case "preflight":
      switch (e.reason) {
        case "compat":
          process.stderr.write(`error: pre-flight failed: ${e.detail}\n`);
          return;
        case "server-unreachable":
          process.stderr.write(`error: cannot reach server: ${e.detail}\n`);
          return;
        case "missing-cli-client-id":
          process.stderr.write(
            `error: server's /api/auth/config does not advertise cliClientId — upgrade the platform server\n`,
          );
          return;
        case "missing-device-endpoint":
          process.stderr.write(
            `error: the configured IdP realm is not enabled for the OAuth 2.0 Device Authorization Grant (${e.detail})\n`,
          );
          return;
        case "discovery-failed":
          process.stderr.write(`error: IdP discovery failed: ${e.detail}\n`);
          return;
      }
      return;
    case "device-flow":
      switch (e.reason) {
        case "access-denied":
          process.stderr.write(
            `error: authorization was denied${e.detail ? ` (${e.detail})` : ""}\n`,
          );
          return;
        case "expired-token":
          process.stderr.write(
            "error: device code expired before authorization completed; run `dam auth login` again\n",
          );
          return;
        case "unexpected-response":
          process.stderr.write(
            `error: unexpected response from token endpoint${e.detail ? ` (${e.detail})` : ""}\n`,
          );
          return;
      }
      return;
    case "transport":
      process.stderr.write(`error: ${e.detail}\n`);
      return;
    case "auth-store":
      process.stderr.write(
        `error: failed to update credential store: ${e.detail}\n`,
      );
      return;
  }
}
