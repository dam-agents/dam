import { Command } from "commander";
import { renderTable } from "../../shared/render-table.js";
import type { ChatService } from "../services/chat-service.js";
import { exitCodeFor, printError } from "./chat.js";

export function buildSessionListCommand(deps: {
  chatService: ChatService;
}): Command {
  return new Command("list")
    .description("List sessions for an Instance")
    .argument("<instance>", "instance name or ID")
    .option("--server <url>", "override the configured server URL")
    .option("--json", "emit raw JSON instead of the default table")
    .action(
      async (
        instanceRef: string,
        opts: { server?: string; json?: boolean },
      ) => {
        const result = await deps.chatService.listSessions({
          instanceRef,
          serverFlag: opts.server,
        });
        if (!result.ok) {
          printError(result.error);
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

        const sorted = [...result.value].sort((a, b) =>
          a.createdAt.localeCompare(b.createdAt),
        );
        const rows = [
          ["SESSION ID", "MODE", "TYPE", "CREATED"],
          ...sorted.map((s) => [s.sessionId, s.mode, s.type, s.createdAt]),
        ];
        process.stdout.write(renderTable(rows));
      },
    );
}
