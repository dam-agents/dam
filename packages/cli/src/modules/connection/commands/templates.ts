import { Command } from "commander";
import {
  aliasForTemplateId,
  PROVIDER_TEMPLATE_IDS,
  type ConnectionTemplateView,
} from "api-server-api";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { renderTable } from "../../shared/render-table.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import type { ConnectionService } from "../services/connection-service.js";

const HEADER = ["ID", "NAME", "CATEGORY", "AUTH", "PROVIDER", "DESCRIPTION"];

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

function providerCell({ provider, id }: ConnectionTemplateView): string {
  if (!provider) return aliasForTemplateId(id) ?? "—";
  return provider.harnesses.length > 0
    ? `${provider.alias} (${provider.harnesses.join(",")})`
    : `${provider.alias} (no harness)`;
}

function tableFor(views: readonly ConnectionTemplateView[]): string {
  return renderTable([
    HEADER,
    ...sortViews(views).map((t) => [
      t.id,
      t.name,
      t.category,
      t.authKind,
      providerCell(t),
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
    .option("--providers", "list only model-provider templates")
    .option("--json", "emit raw JSON instead of the default table")
    .addHelpText(
      "after",
      "\nPROVIDER names a model provider's alias and the harnesses that run on it.\n" +
        "\nExamples:\n" +
        "  dam connection templates\n" +
        "  dam connection templates --providers\n" +
        "  dam connection templates --json\n",
    )
    .action(
      async (opts: {
        server?: string;
        json?: boolean;
        providers?: boolean;
      }) => {
        const host = await resolveActiveHost(deps, opts.server);
        const svc = deps.createConnectionService(host);

        const result = await svc.listTemplates();
        exitOnServiceError(result, host);

        const connectable = result.value.filter((t) =>
          opts.providers
            ? t.provider !== undefined || PROVIDER_TEMPLATE_IDS.has(t.id)
            : t.category !== "mcp",
        );

        if (opts.json) {
          return writeStdoutAndExit(
            `${JSON.stringify(connectable)}\n`,
            EXIT_SUCCESS,
          );
        }

        if (!opts.providers)
          process.stderr.write(
            "\nMCP servers are added by URL: dam connection connect https://your-mcp-server\n",
          );
        return writeStdoutAndExit(tableFor(connectable), EXIT_SUCCESS);
      },
    );
}
