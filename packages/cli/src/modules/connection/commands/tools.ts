import { Command } from "commander";
import type {
  ConnectionToolAccess,
  ConnectionView,
  GrantToolAccess,
} from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import type { AgentView } from "../../agent/domain/agent-view.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import {
  resolveConnectionRef,
  unresolvedConnectionRef,
} from "../domain/connection-ref.js";
import {
  formatToolAccess,
  isException,
  ruleOfTool,
  unlistedNames,
} from "../domain/grant-tool-access.js";
import { formatToolMode } from "../domain/tool-mode.js";
import type { ConnectionService } from "../services/connection-service.js";
import { resolveGrantToolAccessOrExit } from "./grant-tool-access.js";

interface ToolsOpts {
  agent?: string;
  refresh?: boolean;
  server?: string;
  json?: boolean;
}

export function buildToolsCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createConnectionService: (host: string) => ConnectionService;
}): Command {
  return new Command("tools")
    .description(
      "List the tools of an MCP connection's server, grouped into read and write tools, " +
        "with each tool's rule for one agent",
    )
    .argument(
      "<id-or-name>",
      "Connection id ('conn-…') or unique name (from `dam connection list`)",
    )
    .option(
      "--agent <agent>",
      "show each tool's rule for this agent: allow, ask or block (Agent Ref: name or 'agent-…' ID)",
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
      "emit { id, name, toolAccess: { mode, modes, defaultMode, tools, listedAt, listError } } as JSON; " +
        "with --agent also agentId, agentName, grantToolAccess { read, write, overrides } and rules, the rule of each listed tool by name",
    )
    .addHelpText(
      "after",
      "\nA read tool is one the server marks as reading (readOnlyHint), or one on the\n" +
        "template's own read list, as for a Slack Account. In read only, only the read\n" +
        "tools pass. The list is read when the connection is made; --refresh reads it\n" +
        "again. Only an MCP server connected with a credential has a list to read.\n" +
        "\nWith --agent, each tool shows its rule for that agent; `exception` marks a\n" +
        "tool with its own rule. `dam connection scope <connection> --agent <agent>`\n" +
        "changes the rules.\n" +
        "\nExamples:\n" +
        "  dam connection tools slack\n" +
        "  dam connection tools slack --agent standup\n" +
        "  dam connection tools my-mcp --refresh\n",
    )
    .action(async (ref: string, opts: ToolsOpts) => {
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
      const grant =
        opts.agent === undefined
          ? undefined
          : await resolveGrantToolAccessOrExit({
              createAgentService: deps.createAgentService,
              svc,
              host,
              connection: { ...match, toolAccess: match.toolAccess },
              agentRef: opts.agent,
            });
      let toolAccess = match.toolAccess;
      if (opts.refresh) {
        const refreshed = await svc.refreshTools(match.id);
        exitOnServiceError(refreshed, host);
        toolAccess = refreshed.value;
      }
      if (grant) {
        return agentTools(match, toolAccess, grant, opts.json ?? false);
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
    });
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

function agentTools(
  connection: Pick<ConnectionView, "id" | "name">,
  toolAccess: ConnectionToolAccess,
  grant: { agent: AgentView; access: GrantToolAccess },
  json: boolean,
): Promise<never> {
  const { agent, access } = grant;
  const tools = toolAccess.tools ?? [];
  if (json) {
    const rules = Object.fromEntries(
      tools.map((t) => [t.name, ruleOfTool(access, t)]),
    );
    return writeStdoutAndExit(
      `${JSON.stringify({ id: connection.id, name: connection.name, agentId: agent.id, agentName: agent.name, toolAccess, grantToolAccess: access, rules })}\n`,
      EXIT_SUCCESS,
    );
  }
  if (toolAccess.listError) {
    process.stderr.write(
      `warning: the last read of the tool list failed: ${toolAccess.listError}\n`,
    );
  }
  const head = `${connection.name} (${connection.id}) for ${agent.name}: ${formatToolAccess(access)}`;
  const unlisted =
    toolAccess.tools === null
      ? Object.keys(access.overrides)
      : unlistedNames(Object.keys(access.overrides), toolAccess.tools);
  const width = Math.max(
    0,
    ...tools.map((t) => t.name.length),
    ...unlisted.map((n) => n.length),
  );
  const row = (name: string, rule: string, exception: boolean) =>
    `  ${name.padEnd(width)}  ${rule}${exception ? " (exception)" : ""}`;
  const group = (title: string, readOnly: boolean, rule: string) => {
    const members = tools.filter((t) => t.readOnly === readOnly);
    return [
      `${title} (${members.length}): ${rule}`,
      ...(members.length > 0
        ? members.map((t) =>
            row(t.name, ruleOfTool(access, t), isException(access, t)),
          )
        : ["  none"]),
    ];
  };
  const lines =
    toolAccess.tools === null
      ? [
          head,
          `No tool list yet; read tools ${access.read}, every other tool ${access.write}; ` +
            `\`dam connection tools ${connection.name} --refresh\` reads it from the server.`,
        ]
      : [
          head,
          ...(toolAccess.listedAt ? [`Listed at ${toolAccess.listedAt}`] : []),
          ...group("Read tools", true, access.read),
          ...group("Write tools", false, access.write),
          `A tool not in the list follows the write tools: ${access.write}.`,
        ];
  if (unlisted.length > 0) {
    lines.push(
      `Exceptions for tools not in the list (${unlisted.length}):`,
      ...unlisted.map((name) =>
        row(name, access.overrides[name] ?? access.write, false),
      ),
    );
  }
  return writeStdoutAndExit(`${lines.join("\n")}\n`, EXIT_SUCCESS);
}
