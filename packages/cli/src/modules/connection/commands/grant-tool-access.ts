import type {
  ConnectionToolAccess,
  ConnectionView,
  GrantToolAccess,
} from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import type { AgentView } from "../../agent/domain/agent-view.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import {
  changeToolAccess,
  formatToolAccess,
  toolAccessLines,
  type ToolAccessChange,
  unlistedNames,
  writesWithoutAsking,
  writesWithoutAskingNote,
} from "../domain/grant-tool-access.js";
import type { ConnectionService } from "../services/connection-service.js";
import { readBackWarning } from "./connect-from.js";

type McpConnection = ConnectionView & { toolAccess: ConnectionToolAccess };

/** UNIT_BOUNDARY_DESCRIPTION: finds the Agent and its grant of one MCP Connection, and exits with the reason when the Agent does not hold the Connection or the grant has no tool access, as on a server with no auth whose requests the gateway does not read. `scope --agent` and `tools --agent` both start here, so they refuse the same cases in the same words. */
export async function resolveGrantToolAccessOrExit(deps: {
  createAgentService: (host: string) => AgentService;
  svc: ConnectionService;
  host: string;
  connection: McpConnection;
  agentRef: string;
}): Promise<{ agent: AgentView; access: GrantToolAccess }> {
  const { connection, host } = deps;
  const agent = await resolveAgentOrExit(
    deps.createAgentService(host),
    deps.agentRef,
    host,
  );
  const grants = await deps.svc.agentGrants(agent.id);
  exitOnServiceError(grants, host);
  const grant = grants.value.find((g) => g.connectionId === connection.id);
  if (!grant) {
    process.stderr.write(
      `error: ${agent.name} does not hold ${connection.name}\n` +
        `hint: grant it with \`dam connection grant ${agent.name} --connection ${connection.name}\`\n`,
    );
    process.exit(EXIT_INVALID_INPUT);
  }
  if (!grant.toolAccess) {
    process.stderr.write(
      `error: ${connection.name} has no tool access to set: it is an MCP server with no auth, ` +
        "whose requests the gateway does not read, so every tool call passes\n",
    );
    process.exit(EXIT_INVALID_INPUT);
  }
  return { agent, access: grant.toolAccess };
}

export async function scopeGrantToolAccess(deps: {
  createAgentService: (host: string) => AgentService;
  svc: ConnectionService;
  host: string;
  connection: McpConnection;
  agentRef: string;
  change: ToolAccessChange | null;
  json: boolean;
}): Promise<never> {
  const { svc, host, connection, change, json } = deps;
  const { agent, access: current } = await resolveGrantToolAccessOrExit(deps);
  const tools = connection.toolAccess.tools;

  let access = current;
  if (change) {
    const unlisted = unlistedNames(
      [...change.tools.keys(), ...change.reset],
      tools,
    );
    if (unlisted.length > 0) {
      process.stderr.write(
        `warning: ${unlisted.join(", ")} ${unlisted.length === 1 ? "is" : "are"} not in the tool list of ${connection.name}; ` +
          `check the name with \`dam connection tools ${connection.name} --refresh\`\n`,
      );
    }
    const sent = changeToolAccess(current, change);
    const res = await svc.setGrantToolAccess({
      agentId: agent.id,
      connectionId: connection.id,
      access: sent,
    });
    exitOnServiceError(res, host);
    access = await readBack(svc, agent, connection, sent);
  }

  if (json) {
    return writeStdoutAndExit(
      `${JSON.stringify({ ...(change ? { ok: true } : {}), id: connection.id, name: connection.name, kind: "grant-tool-access", agentId: agent.id, agentName: agent.name, grantToolAccess: access })}\n`,
      EXIT_SUCCESS,
    );
  }
  if (writesWithoutAsking(access, tools)) {
    process.stderr.write(writesWithoutAskingNote(agent.name, connection.name));
  }
  if (!change) {
    process.stderr.write(
      `hint: \`dam connection scope ${connection.name} --agent ${agent.name} --write <allow|ask|block>\` ` +
        "changes a group, and `--tool <name>=<allow|ask|block>` one tool\n",
    );
  }
  return writeStdoutAndExit(
    `${[
      `${change ? "✓ Set " : ""}${connection.name} (${connection.id}) for ${agent.name}: ${formatToolAccess(access)}`,
      ...toolAccessLines(access),
    ].join("\n")}\n`,
    EXIT_SUCCESS,
  );
}

async function readBack(
  svc: ConnectionService,
  agent: AgentView,
  connection: ConnectionView,
  sent: GrantToolAccess,
): Promise<GrantToolAccess> {
  const grants = await svc.agentGrants(agent.id);
  const stored = grants.ok
    ? grants.value.find((g) => g.connectionId === connection.id)?.toolAccess
    : undefined;
  if (stored) return stored;
  process.stderr.write(
    readBackWarning(
      connection.name,
      grants.ok ? "its grant to the agent was not found" : grants.error.reason,
      "changing",
    ),
  );
  return sent;
}
