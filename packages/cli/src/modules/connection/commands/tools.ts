import { Command } from "commander";
import type { ConnectionToolAccess, ConnectionView } from "api-server-api";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import {
  resolveConnectionRef,
  unresolvedConnectionRef,
} from "../domain/connection-ref.js";
import { formatToolMode } from "../domain/tool-mode.js";
import type { ConnectionService } from "../services/connection-service.js";

export function buildToolsCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createConnectionService: (host: string) => ConnectionService;
}): Command {
  return new Command("tools")
    .description(
      "List the tools of an MCP connection's server, grouped into read and write tools",
    )
    .argument(
      "<id-or-name>",
      "Connection id ('conn-…') or unique name (from `dam connection list`)",
    )
    .option(
      "--refresh",
      "read the tool list from the server again, with the connection's own credential",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option(
      "--json",
      "emit { id, name, toolAccess: { mode, modes, defaultMode, tools, listedAt, listError } } as JSON",
    )
    .addHelpText(
      "after",
      "\nA read tool is one the server marks as reading (readOnlyHint), or one on the\n" +
        "template's own read list, as for a Slack Account. In read only, only the read\n" +
        "tools pass. The list is read when the connection is made; --refresh reads it\n" +
        "again. Only an MCP server connected with a credential has a list to read.\n" +
        "\nExamples:\n" +
        "  dam connection tools slack\n" +
        "  dam connection tools my-mcp --refresh\n",
    )
    .action(
      async (
        ref: string,
        opts: { refresh?: boolean; server?: string; json?: boolean },
      ) => {
        const host = await resolveActiveHost(deps, opts.server);
        const svc = deps.createConnectionService(host);
        const listed = await svc.list();
        exitOnServiceError(listed, host);
        const match = resolveConnectionRef(listed.value, ref);
        if (!match) {
          process.stderr.write(unresolvedConnectionRef(listed.value, ref));
          process.exit(EXIT_INVALID_INPUT);
        }
        if (!match.toolAccess) {
          process.stderr.write(
            `error: '${match.name}' is not an MCP connection, so it has no tools to list\n`,
          );
          process.exit(EXIT_INVALID_INPUT);
        }
        let toolAccess = match.toolAccess;
        if (opts.refresh) {
          const refreshed = await svc.refreshTools(match.id);
          exitOnServiceError(refreshed, host);
          toolAccess = refreshed.value;
        }
        if (opts.json) {
          return writeStdoutAndExit(
            `${JSON.stringify({ id: match.id, name: match.name, toolAccess })}\n`,
            EXIT_SUCCESS,
          );
        }
        if (toolAccess.listError) {
          process.stderr.write(
            `warning: the last read of the tool list failed: ${toolAccess.listError}\n`,
          );
        }
        return writeStdoutAndExit(toolLines(match, toolAccess), EXIT_SUCCESS);
      },
    );
}

function toolLines(
  connection: Pick<ConnectionView, "id" | "name">,
  toolAccess: ConnectionToolAccess,
): string {
  const head = `${connection.name} (${connection.id}): ${formatToolMode(toolAccess.mode)}`;
  if (toolAccess.tools === null) {
    return (
      `${head}\nNo tool list yet; ` +
      `\`dam connection tools ${connection.name} --refresh\` reads it from the server.\n`
    );
  }
  const read = toolAccess.tools.filter((t) => t.readOnly).map((t) => t.name);
  const write = toolAccess.tools.filter((t) => !t.readOnly).map((t) => t.name);
  const group = (title: string, names: readonly string[]) => [
    `${title} (${names.length}):`,
    ...(names.length > 0 ? names.map((n) => `  ${n}`) : ["  none"]),
  ];
  return `${[
    head,
    ...(toolAccess.listedAt ? [`Listed at ${toolAccess.listedAt}`] : []),
    ...group("Read tools", read),
    ...group("Write tools", write),
  ].join("\n")}\n`;
}
