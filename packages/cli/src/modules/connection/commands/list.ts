import { Command } from "commander";
import {
  aliasForTemplateId,
  PROVIDER_TEMPLATE_IDS,
  type ConnectionView,
} from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { renderTable } from "../../shared/render-table.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { formatScope, scopeOf } from "../domain/github-scope.js";
import type { ConnectionService } from "../services/connection-service.js";

const HEADER = [
  "ID",
  "NAME",
  "CATEGORY",
  "STATUS",
  "PROVIDER",
  "HOSTS",
  "SCOPE",
];

function sortViews(
  views: readonly ConnectionView[],
): readonly ConnectionView[] {
  return [...views].sort((a, b) => {
    const c = a.category.localeCompare(b.category);
    if (c !== 0) return c;
    const n = a.name.localeCompare(b.name);
    if (n !== 0) return n;
    return a.id.localeCompare(b.id);
  });
}

function providerCell({ provider, templateId }: ConnectionView): string {
  if (!provider) return aliasForTemplateId(templateId) ?? "—";
  const harnesses =
    provider.harnesses.length > 0 ? provider.harnesses.join(",") : "no harness";
  return `${provider.alias} (${harnesses})${provider.preferred ? " preferred" : ""}`;
}

function tableFor(views: readonly ConnectionView[]): string {
  return renderTable([
    HEADER,
    ...sortViews(views).map((c) => [
      c.id,
      c.name,
      c.category,
      c.status,
      providerCell(c),
      c.hosts.join(","),
      formatScope(scopeOf(c)),
    ]),
  ]);
}

function withScope(views: readonly ConnectionView[]) {
  return views.map((c) => {
    const scope = scopeOf(c);
    return scope ? { ...c, scope } : c;
  });
}

function onlyProviders(
  views: readonly ConnectionView[],
  providers: boolean | undefined,
): readonly ConnectionView[] {
  return providers
    ? views.filter(
        (c) =>
          c.provider !== undefined || PROVIDER_TEMPLATE_IDS.has(c.templateId),
      )
    : views;
}

export function buildListCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createConnectionService: (host: string) => ConnectionService;
}): Command {
  return new Command("list")
    .description(
      "List team connections, or the connections granted to one Agent",
    )
    .argument("[agent]", "Agent Ref — name or 'agent-…' ID (optional)")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option(
      "--providers",
      "list only model-provider connections, the ones `dam agent create --provider` takes",
    )
    .option(
      "--json",
      "emit raw JSON instead of the default table; a GitHub connection carries scope { restricted, account?, repositories?, repositoryIds?, permissions? }",
    )
    .addHelpText(
      "after",
      "\nPROVIDER names a model provider's alias, the harnesses that run on it, and\n" +
        "`preferred` on the one a new agent's sessions use when `dam agent create`\n" +
        "names no --provider.\n" +
        "\nExamples:\n" +
        "  dam connection list\n" +
        "  dam connection list --providers\n" +
        "  dam connection list my-agent\n" +
        "  dam connection list --json\n",
    )
    .action(
      async (
        ref: string | undefined,
        opts: { server?: string; json?: boolean; providers?: boolean },
      ) => {
        const host = await resolveActiveHost(deps, opts.server);
        const svc = deps.createConnectionService(host);

        if (ref === undefined) {
          const result = await svc.list();
          exitOnServiceError(result, host);
          const views = onlyProviders(result.value, opts.providers);
          if (opts.json) {
            return writeStdoutAndExit(
              `${JSON.stringify(withScope(views))}\n`,
              EXIT_SUCCESS,
            );
          }
          if (views.length === 0) {
            process.stderr.write(
              opts.providers
                ? "No model providers. See `dam connection templates --providers` for options, then `dam connection connect <id>`.\n"
                : "No connections. See `dam connection templates` for options, then `dam connection connect <id>`.\n",
            );
            process.exit(EXIT_SUCCESS);
          }
          return writeStdoutAndExit(tableFor(views), EXIT_SUCCESS);
        }

        const agent = await resolveAgentOrExit(
          deps.createAgentService(host),
          ref,
          host,
        );

        const [idsRes, allRes] = await Promise.all([
          svc.agentConnectionIds(agent.id),
          svc.list(),
        ]);
        exitOnServiceError(idsRes, host);
        exitOnServiceError(allRes, host);

        const byId = new Map(allRes.value.map((c) => [c.id, c]));
        const granted: ConnectionView[] = [];
        const missing: string[] = [];
        for (const id of idsRes.value) {
          const view = byId.get(id);
          if (view) granted.push(view);
          else missing.push(id);
        }
        const matched = onlyProviders(granted, opts.providers);

        if (opts.json) {
          return writeStdoutAndExit(
            `${JSON.stringify(withScope(matched))}\n`,
            EXIT_SUCCESS,
          );
        }
        if (matched.length === 0 && missing.length === 0) {
          process.stderr.write(
            `Agent ${ref} has no ${opts.providers ? "model providers" : "connections"}. Grant one with \`dam connection grant ${ref} --connection <id>\`.\n`,
          );
          process.exit(EXIT_SUCCESS);
        }
        if (missing.length > 0) {
          process.stderr.write(
            `note: ${missing.length} granted connection(s) no longer exist: ${missing.join(", ")}\n`,
          );
        }
        if (matched.length > 0) {
          return writeStdoutAndExit(tableFor(matched), EXIT_SUCCESS);
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}
