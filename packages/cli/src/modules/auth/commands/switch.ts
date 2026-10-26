import { Command } from "commander";
import type { AuthService, SwitchError } from "../services/auth-service.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
} from "../../shared/exit-codes.js";

export interface SwitchCommandDeps {
  authService: AuthService;
}

export function buildSwitchCommand(deps: SwitchCommandDeps): Command {
  return new Command("switch")
    .description("Make a saved server the active one, without signing in again")
    .argument(
      "<server>",
      "a server you signed in to: its URL, with or without a trailing slash, or its host name",
    )
    .addHelpText(
      "after",
      "\n`dam auth status` lists the saved servers.\n\nExamples:\n  dam auth switch https://dam.example.com\n  dam auth switch dam.example.com\n",
    )
    .action(async (server: string) => {
      const result = await deps.authService.switchTo(server);
      if (!result.ok) {
        printSwitchError(result.error);
        process.exit(
          result.error.kind === "unknown-server" ||
            result.error.kind === "ambiguous-server"
            ? EXIT_INVALID_INPUT
            : EXIT_RUNTIME_FAILURE,
        );
      }

      for (const w of result.value.warnings) {
        process.stderr.write(`warning: ${w}\n`);
      }
      process.stdout.write(`✓ Active server is now ${result.value.host}\n`);
      switch (result.value.session) {
        case "expired":
          process.stderr.write(
            "warning: the session there expired; run `dam auth login` to sign in again\n",
          );
          return;
        case "unchecked":
          process.stderr.write(
            `warning: could not check the session there: ${result.value.uncheckedReason}\n`,
          );
          return;
        case "valid":
        case "env":
          return;
      }
    });
}

function printSwitchError(e: SwitchError): void {
  switch (e.kind) {
    case "unknown-server":
      process.stderr.write(
        e.saved.length === 0
          ? `error: not signed in to ${e.input}, and no servers are saved\nhint: run \`dam auth login --server <url>\` first\n`
          : `error: not signed in to ${e.input}; saved servers:\n${e.saved.map((h) => `  ${h}\n`).join("")}hint: run \`dam auth login --server <url>\` to sign in to a new one\n`,
      );
      return;
    case "ambiguous-server":
      process.stderr.write(
        `error: ${e.input} matches more than one saved server; pass its full URL:\n${e.candidates.map((h) => `  ${h}\n`).join("")}`,
      );
      return;
    case "auth-store":
      process.stderr.write(
        `error: failed to read credential store: ${e.detail}\n`,
      );
      return;
    case "config":
      process.stderr.write(
        `error: failed to save the active server: ${e.detail}\n`,
      );
      return;
  }
}
