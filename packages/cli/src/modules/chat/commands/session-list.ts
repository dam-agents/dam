import { Command } from "commander";
import type { SessionView } from "api-server-api";
import type { ChatService } from "../services/chat-service.js";
import { exitCodeFor, printError } from "./chat.js";

export function buildSessionListCommand(deps: { chatService: ChatService; serverEnvVar: string }): Command {
  return new Command("list")
    .description("List sessions for an Instance")
    .argument("<instance>", "instance name or ID")
    .option("--server <url>", "override the configured server URL")
    .option("--json", "emit raw JSON instead of the default table")
    .action(async (instanceRef: string, opts: { server?: string; json?: boolean }) => {
      const result = await deps.chatService.listSessions({ instanceRef, serverFlag: opts.server });
      if (!result.ok) {
        printError(result.error, deps.serverEnvVar);
        process.exit(exitCodeFor(result.error));
      }

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result.value)}\n`);
        return;
      }

      if (result.value.length === 0) {
        process.stderr.write("No sessions.\n");
        return;
      }

      process.stdout.write(renderTable(result.value));
    });
}

function renderTable(sessions: readonly SessionView[]): string {
  const rows = [
    ["SESSION ID", "MODE", "TYPE", "CREATED"],
    ...[...sessions].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((s) => [s.sessionId, s.mode, s.type, s.createdAt]),
  ];
  const widths = rows[0]!.map((_, col) => Math.max(...rows.map((r) => r[col]!.length)));
  return rows
    .map((row) => row.map((cell, col) => col === row.length - 1 ? cell : cell + " ".repeat(widths[col]! - cell.length)).join("   "))
    .join("\n") + "\n";
}
