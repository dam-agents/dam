import { Command } from "commander";
import type {
  AuthService,
  StatusEntry,
  StatusReport,
} from "../services/auth-service.js";
import {
  EXIT_RUNTIME_FAILURE,
  EXIT_AUTH_STATUS_NO_VALID,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";

export interface StatusCommandDeps {
  authService: AuthService;
}

function describeSession(entry: StatusEntry): string {
  switch (entry.session) {
    case "expired":
      return " (session expired; run `dam auth login`)";
    case "unchecked":
      return ` (could not check the session: ${entry.uncheckedReason})`;
    case "valid":
      return entry.expiresAt !== undefined
        ? ` (expires ${entry.expiresAt.toISOString()})`
        : "";
    case "env":
      return "";
  }
}

function toJson(report: StatusReport): string {
  return JSON.stringify({
    activeServer: report.activeHost ?? null,
    servers: report.entries.map((entry) => ({
      server: entry.host,
      active: entry.isActive,
      username: entry.username,
      issuer: entry.issuer,
      source: entry.source,
      session: entry.session,
      expiresAt: entry.expiresAt?.toISOString() ?? null,
      ...(entry.uncheckedReason !== undefined && {
        uncheckedReason: entry.uncheckedReason,
      }),
    })),
  });
}

export function buildStatusCommand(deps: StatusCommandDeps): Command {
  return new Command("status")
    .description(
      "List the saved servers, their credential source and session, and the active server",
    )
    .option(
      "--json",
      "emit { activeServer, servers: [{ server, active, username, issuer, source, session, expiresAt }] } as JSON; session is valid, expired, unchecked or env",
    )
    .action(async (opts: { json?: boolean }) => {
      const result = await deps.authService.status();
      if (!result.ok) {
        process.stderr.write(
          `error: failed to read credential store: ${result.error.detail}\n`,
        );
        process.exit(EXIT_RUNTIME_FAILURE);
      }

      const report = result.value;
      const exitCode = report.activeHostValid
        ? EXIT_SUCCESS
        : EXIT_AUTH_STATUS_NO_VALID;
      if (opts.json) {
        return writeStdoutAndExit(`${toJson(report)}\n`, exitCode);
      }

      if (report.entries.length === 0) {
        process.stderr.write("No hosts configured.\n");
        process.stderr.write("hint: run `dam auth login` to authenticate\n");
        process.exit(exitCode);
      }

      const lines = report.entries.map((entry) => {
        const marker = entry.isActive ? "*" : " ";
        return `${marker} ${entry.host}  user=${entry.username}  source=${entry.source}  issuer=${entry.issuer}${describeSession(entry)}`;
      });
      process.stdout.write(`${lines.join("\n")}\n`);
      if (report.uncheckedReason !== undefined) {
        process.stderr.write(
          `warning: could not check the active session: ${report.uncheckedReason}\n`,
        );
      }
      if (report.entries.length > 1) {
        process.stderr.write(
          "hint: run `dam auth switch <server>` to make another saved server active\n",
        );
      }
      process.exit(exitCode);
    });
}
