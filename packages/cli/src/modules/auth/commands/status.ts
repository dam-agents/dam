import { Command } from "commander";
import type { AuthService } from "../services/auth-service.js";
import {
  EXIT_RUNTIME_FAILURE,
  EXIT_AUTH_STATUS_NO_VALID,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";

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
        process.stderr.write(
          `error: failed to read credential store: ${result.error.detail}\n`,
        );
        process.exit(EXIT_RUNTIME_FAILURE);
      }

      const report = result.value;
      if (report.entries.length === 0) {
        process.stderr.write("No hosts configured.\n");
        process.stderr.write("hint: run `dam auth login` to authenticate\n");
        process.exit(
          report.activeHostValid ? EXIT_SUCCESS : EXIT_AUTH_STATUS_NO_VALID,
        );
      }

      const lines = report.entries.map((entry) => {
        const marker = entry.isActive ? "*" : " ";
        const expires =
          entry.expiresAt !== undefined
            ? ` (expires ${entry.expiresAt.toISOString()})`
            : "";
        return `${marker} ${entry.host}  user=${entry.username}  source=${entry.source}  issuer=${entry.issuer}${expires}`;
      });
      process.stdout.write(`${lines.join("\n")}\n`);
      process.exit(
        report.activeHostValid ? EXIT_SUCCESS : EXIT_AUTH_STATUS_NO_VALID,
      );
    });
}
