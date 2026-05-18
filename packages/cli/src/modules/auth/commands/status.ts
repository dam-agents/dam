import { Command } from "commander";
import type {
  AuthService,
  StatusEntry,
  StatusError,
} from "../services/auth-service.js";
import {
  EXIT_AUTH_RUNTIME_FAILURE,
  EXIT_AUTH_STATUS_NO_VALID,
  EXIT_AUTH_SUCCESS,
} from "./exit-codes.js";

export interface StatusCommandDeps {
  authService: AuthService;
}

export function buildStatusCommand(deps: StatusCommandDeps): Command {
  return new Command("status")
    .description(
      "List configured hosts, their credential source, and the active server",
    )
    .action(async () => {
      const result = await deps.authService.status();
      if (!result.ok) {
        printStatusError(result.error);
        process.exit(EXIT_AUTH_RUNTIME_FAILURE);
      }

      const report = result.value;
      if (report.entries.length === 0) {
        process.stderr.write("No hosts configured.\n");
        process.stderr.write("hint: run `dam auth login` to authenticate\n");
        process.exit(
          report.activeHostValid
            ? EXIT_AUTH_SUCCESS
            : EXIT_AUTH_STATUS_NO_VALID,
        );
      }

      const lines: string[] = [];
      for (const entry of report.entries) {
        lines.push(formatEntry(entry));
      }
      process.stdout.write(`${lines.join("\n")}\n`);
      process.exit(
        report.activeHostValid ? EXIT_AUTH_SUCCESS : EXIT_AUTH_STATUS_NO_VALID,
      );
    });
}

function formatEntry(entry: StatusEntry): string {
  const marker = entry.isActive ? "*" : " ";
  const expires =
    entry.expiresAt !== undefined
      ? ` (expires ${entry.expiresAt.toISOString()})`
      : "";
  // Never prints tokens — per analysis §3.10.
  return `${marker} ${entry.host}  user=${entry.username}  source=${entry.source}  issuer=${entry.issuer}${expires}`;
}

function printStatusError(e: StatusError): void {
  switch (e.kind) {
    case "auth-store":
      process.stderr.write(
        `error: failed to read credential store: ${e.detail}\n`,
      );
      return;
  }
}
