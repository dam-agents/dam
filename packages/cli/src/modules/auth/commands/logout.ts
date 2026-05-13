import { Command } from "commander";
import type { ConfigService } from "../../cli/index.js";
import type { AuthService, LogoutError } from "../services/auth-service.js";
import {
  EXIT_AUTH_INVALID_INPUT,
  EXIT_AUTH_RUNTIME_FAILURE,
} from "./exit-codes.js";

export interface LogoutCommandDeps {
  authService: AuthService;
  configService: ConfigService;
}

export function buildLogoutCommand(deps: LogoutCommandDeps): Command {
  return new Command("logout")
    .description("Clear local credentials and best-effort revoke the refresh token")
    .option("--server <url>", "host to log out of; defaults to the active server")
    .action(async (opts: { server?: string }) => {
      let host = opts.server;
      if (!host) {
        const resolved = await deps.configService.getResolved({});
        if (!resolved.ok) {
          // Same distinction as login (review §3): a malformed config.toml
          // needs a different remediation than an unset server.
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

      const result = await deps.authService.logout(host);
      if (!result.ok) {
        printLogoutError(result.error);
        process.exit(EXIT_AUTH_RUNTIME_FAILURE);
      }

      if (result.value.alreadyLoggedOut) {
        process.stdout.write(`Not logged in to ${result.value.host}.\n`);
        return;
      }
      if (result.value.revokeWarning) {
        process.stderr.write(`warning: ${result.value.revokeWarning}\n`);
      }
      process.stdout.write(
        `✓ Logged out of ${result.value.host}${result.value.revoked ? "" : " (local clear only)"}\n`,
      );
    });
}

function printLogoutError(e: LogoutError): void {
  switch (e.kind) {
    case "auth-store":
      process.stderr.write(`error: failed to update credential store: ${e.detail}\n`);
      return;
  }
}
