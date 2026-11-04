import type { ConnectionView } from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import type { AgentView } from "../../agent/domain/agent-view.js";
import type { ConnectionService } from "../services/connection-service.js";

export type ConnectionCommandDeps = {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createConnectionService: (host: string) => ConnectionService;
};

/** UNIT_BOUNDARY_DESCRIPTION: what grant and revoke need before they read the refs they were given — the host, the Agent, the service and every connection on the instance — resolved and exited on the same way in both, so each differs only in how it reads a ref and what it sends. */
export async function resolveAgentConnections(
  deps: ConnectionCommandDeps,
  ref: string,
  server: string | undefined,
): Promise<{
  host: string;
  agent: AgentView;
  svc: ConnectionService;
  connections: readonly ConnectionView[];
}> {
  const host = await resolveActiveHost(deps, server);
  const agent = await resolveAgentOrExit(
    deps.createAgentService(host),
    ref,
    host,
  );
  const svc = deps.createConnectionService(host);
  const allRes = await svc.list();
  exitOnServiceError(allRes, host);
  return { host, agent, svc, connections: allRes.value };
}
