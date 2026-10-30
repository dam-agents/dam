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
import { formatExpiry } from "../domain/credential-check.js";
import {
  defaultCell,
  defaultMarks,
  type DefaultMark,
} from "../domain/default-account.js";
import { childrenOf, parentLabel } from "../domain/github-parent.js";
import { formatScope, scopeKindOf, scopeOf } from "../domain/github-scope.js";
import type { ConnectionService } from "../services/connection-service.js";

const HEADER = [
  "ID",
  "NAME",
  "CATEGORY",
  "STATUS",
  "PROVIDER",
  "HOSTS",
  "EXPIRES",
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

function statusCell({ status, check }: ConnectionView): string {
  return check && check.status !== "passed"
    ? `${status} (check ${check.status})`
    : status;
}

function scopeCell(c: ConnectionView, children: number): string {
  if (!c.isParent) return formatScope(scopeOf(c), scopeKindOf(c));
  return children > 0
    ? `${parentLabel(c)} (never granted itself)`
    : `${parentLabel(c)} (no connection made from it yet)`;
}

function treeRows(
  views: readonly ConnectionView[],
): { view: ConnectionView; branch: string; children: number }[] {
  const listed = new Set(views.map((c) => c.id));
  const roots = sortViews(
    views.filter((c) => c.parentId === undefined || !listed.has(c.parentId)),
  );
  return roots.flatMap((root) => {
    const children = root.isParent ? childrenOf(views, root.id) : [];
    return [
      { view: root, branch: "", children: children.length },
      ...children.map((child, i) => ({
        view: child,
        branch: i === children.length - 1 ? "└─ " : "├─ ",
        children: 0,
      })),
    ];
  });
}

function tableFor(
  views: readonly ConnectionView[],
  marks?: ReadonlyMap<string, DefaultMark>,
): string {
  return renderTable([
    marks ? [...HEADER, "DEFAULT"] : HEADER,
    ...treeRows(views).map(({ view: c, branch, children }) => [
      c.id,
      `${branch}${c.name}`,
      c.category,
      statusCell(c),
      providerCell(c),
      c.hosts.join(","),
      c.check?.expiresAt ? formatExpiry(c.check.expiresAt) : "—",
      scopeCell(c, children),
      ...(marks ? [defaultCell(marks.get(c.id))] : []),
    ]),
  ]);
}

function withScope(
  views: readonly ConnectionView[],
  marks?: ReadonlyMap<string, DefaultMark>,
) {
  return views.map((c) => {
    const scope = scopeOf(c);
    const mark = marks?.get(c.id);
    return {
      ...c,
      ...(scope && { scope }),
      ...(mark && { default: mark }),
    };
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
      "emit raw JSON instead of the default table; a GitHub connection carries scope { restricted, fullAccess?, account?, repositories?, repositoryIds?, permissions? }, " +
        "with fullAccess: true when it reaches everything its sign-in or installation reaches; " +
        "a GitHub sign-in or installation carries isParent: true, and each connection made from it parentId; " +
        "a checked credential carries its last check { status: passed|failed|unchecked, account?, expiresAt?, scopes?, installedOn?, repositories?, repositoriesTruncated?, reason?, at }; " +
        "listed for an agent, a connection that shares its host with another granted one carries default { kind, scope, active }",
    )
    .addHelpText(
      "after",
      "\nA GitHub sign-in or GitHub App installation holds the credential and is never\n" +
        "granted to an agent. The connections made from it are listed under it, each\n" +
        "with its own SCOPE. FULL ACCESS marks one that reaches everything its sign-in\n" +
        "or installation reaches; limit it with `dam connection scope`.\n" +
        "\nEXPIRES is when the credential expires, as its last check found it.\n" +
        "\nPROVIDER names a model provider's alias, the harnesses that run on it, and\n" +
        "`preferred` on the one a new agent's sessions use when `dam agent create`\n" +
        "names no --provider.\n" +
        "\nListed for an agent, DEFAULT marks which of several GitHub accounts on one\n" +
        "host, or of several Object Storage connections, the agent acts as unless it\n" +
        "switches itself; change it with `dam connection default`.\n" +
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

        const [grantsRes, allRes] = await Promise.all([
          svc.agentGrants(agent.id),
          svc.list(),
        ]);
        exitOnServiceError(grantsRes, host);
        exitOnServiceError(allRes, host);

        const byId = new Map(allRes.value.map((c) => [c.id, c]));
        const granted: ConnectionView[] = [];
        const missing: string[] = [];
        for (const { connectionId } of grantsRes.value) {
          const view = byId.get(connectionId);
          if (view) granted.push(view);
          else missing.push(connectionId);
        }
        const marks = defaultMarks(granted, grantsRes.value);
        const matched = onlyProviders(granted, opts.providers);

        if (opts.json) {
          return writeStdoutAndExit(
            `${JSON.stringify(withScope(matched, marks))}\n`,
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
          return writeStdoutAndExit(tableFor(matched, marks), EXIT_SUCCESS);
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}
