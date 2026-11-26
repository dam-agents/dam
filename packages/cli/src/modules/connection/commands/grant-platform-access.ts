import {
  OWN_PLATFORM_ACCESS,
  type ConnectionView,
  type PlatformAccess,
} from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import type { ConnectionService } from "../services/connection-service.js";
import { readBackWarning } from "./connect-from.js";

export type PlatformAccessChange = "as-itself" | "as-owner";

function describe(agent: string, access: PlatformAccess | null): string {
  return access === null
    ? `${agent} acts as you: it can do on the platform whatever you can`
    : `${agent} acts as itself: it can read itself and change nothing`;
}

/** UNIT_BOUNDARY_DESCRIPTION: shows or sets the Platform Access of one Agent on the platform Connection it holds: whether it calls the platform as itself, with its own Agent Key and only what its access names, or as its owner, with the Connection's own key. The server lets only a signed-in owner set it, so the same command run by an Agent is refused there. */
export async function scopeGrantPlatformAccess(deps: {
  createAgentService: (host: string) => AgentService;
  svc: ConnectionService;
  host: string;
  connection: ConnectionView;
  agentRef: string;
  change: PlatformAccessChange | null;
  json: boolean;
}): Promise<never> {
  const { svc, host, connection, change, json } = deps;
  const agent = await resolveAgentOrExit(
    deps.createAgentService(host),
    deps.agentRef,
    host,
  );
  const stored = async (): Promise<PlatformAccess | null | undefined> => {
    const grants = await svc.agentGrants(agent.id);
    exitOnServiceError(grants, host);
    const grant = grants.value.find((g) => g.connectionId === connection.id);
    return grant === undefined ? undefined : (grant.platformAccess ?? null);
  };
  const current = await stored();
  if (current === undefined) {
    process.stderr.write(
      `error: ${agent.name} does not hold ${connection.name}\n` +
        `hint: grant it with \`dam connection grant ${agent.name} --connection ${connection.name}\`\n`,
    );
    process.exit(EXIT_INVALID_INPUT);
  }

  let access = current;
  if (change) {
    const sent = change === "as-itself" ? OWN_PLATFORM_ACCESS : null;
    const res = await svc.setGrantPlatformAccess({
      agentId: agent.id,
      connectionId: connection.id,
      access: sent,
    });
    exitOnServiceError(res, host);
    const read = await stored();
    if (read === undefined)
      process.stderr.write(
        readBackWarning(
          connection.name,
          "its grant to the agent was not found",
          "changing",
        ),
      );
    access = read === undefined ? sent : read;
  }

  if (json) {
    return writeStdoutAndExit(
      `${JSON.stringify({ ...(change ? { ok: true } : {}), id: connection.id, name: connection.name, kind: "grant-platform-access", agentId: agent.id, agentName: agent.name, platformAccess: access })}\n`,
      EXIT_SUCCESS,
    );
  }
  if (!change) {
    process.stderr.write(
      `hint: \`dam connection scope ${connection.name} --agent ${agent.name} --as-itself\` ` +
        "makes it call the platform as itself, and `--as-owner` as you\n",
    );
  }
  return writeStdoutAndExit(
    `${change ? "✓ Set " : ""}${connection.name} (${connection.id}): ${describe(agent.name, access)}\n`,
    EXIT_SUCCESS,
  );
}
