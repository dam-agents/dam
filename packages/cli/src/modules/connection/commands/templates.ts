import { Command } from "commander";
import type { ConnectionTemplateView } from "api-server-api";
import { printServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { renderTable } from "../../shared/render-table.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import type { ConnectionService } from "../services/connection-service.js";

const HEADER = ["ID", "NAME", "CATEGORY", "AUTH", "DESCRIPTION"];

function sortViews(
  views: readonly ConnectionTemplateView[],
): readonly ConnectionTemplateView[] {
  return [...views].sort((a, b) => {
    const c = a.category.localeCompare(b.category);
    if (c !== 0) return c;
    const n = a.name.localeCompare(b.name);
    if (n !== 0) return n;
    return a.id.localeCompare(b.id);
  });
}

function tableFor(views: readonly ConnectionTemplateView[]): string {
  return renderTable([
    HEADER,
    ...sortViews(views).map((t) => [
      t.id,
      t.name,
      t.category,
      t.authKind,
      t.description ?? "",
    ]),
  ]);
}

export function buildTemplatesCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createConnectionService: (host: string) => ConnectionService;
}): Command {
  return new Command("templates")
    .description(
      "List the connection providers you can create a connection from",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw JSON instead of the default table")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam connection templates\n" +
        "  dam connection templates --json\n",
    )
    .action(async (opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, {
        flag: opts.server ? { server: opts.server } : undefined,
        exitCodes: {
          runtimeFailure: EXIT_RUNTIME_FAILURE,
          belowFloor: EXIT_BELOW_FLOOR,
        },
      });
      const svc = deps.createConnectionService(host);

      const result = await svc.listTemplates();
      if (!result.ok) {
        printServiceError(result.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }

      // Every listed id must be a valid `dam connection connect <id>` argument.
      // `connect` rejects mcp-category ids and demands a URL, so listing them
      // would break the list-then-connect workflow this command exists for.
      const connectable = result.value.filter((t) => t.category !== "mcp");

      if (opts.json) {
        return writeStdoutAndExit(
          `${JSON.stringify(connectable)}\n`,
          EXIT_SUCCESS,
        );
      }

      process.stderr.write(
        "\nMCP servers are added by URL: dam connection connect https://your-mcp-server\n",
      );
      return writeStdoutAndExit(tableFor(connectable), EXIT_SUCCESS);
    });
}
