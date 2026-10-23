import type {
  ConnectionRequestSecretInput,
  SecretRequestState,
  SecretRequestTicket,
} from "api-server-api";
import type { ConnectionsRepository } from "../infrastructure/connections-repository.js";
import { isSecretRequestAuthKind } from "../domain/secret-request.js";
import {
  agentPresetHosts,
  issueSecretRequest,
  secretRequestStatus,
  type SecretRequestIssuerDeps,
} from "./secret-request-issuer.js";

export interface AgentSecretTemplate {
  templateId: string;
  name: string;
  authKind: string;
  description?: string;
  hosts: string[];
  configInputs?: {
    name: string;
    label: string;
    hint?: string;
    values?: readonly string[];
  }[];
}

export interface AgentSecretConnection {
  connectionId: string;
  name: string;
  templateId: string;
  authKind: string;
}

export interface AgentSecretRequests {
  options(): Promise<{
    templates: AgentSecretTemplate[];
    connections: AgentSecretConnection[];
  }>;
  request(input: ConnectionRequestSecretInput): Promise<SecretRequestTicket>;
  status(requestId: string): Promise<SecretRequestState>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Secret Requests an Agent makes through its
 * platform MCP server, for its owner to answer on the same page. They are
 * narrower than the CLI's: a new connection must send its secret only to the
 * hosts its template presets, a rotation only names a connection granted to
 * the Agent, and a connection the page creates is granted to the Agent. The
 * status the Agent polls is its own request's alone.
 */
export function createAgentSecretRequests(
  deps: Omit<SecretRequestIssuerDeps, "now" | "repo"> & {
    agentId: string;
    repo: Pick<
      ConnectionsRepository,
      "get" | "listAgentsForConnection" | "listConnectionsForAgent"
    >;
    now?: () => number;
  },
): AgentSecretRequests {
  const issuer = { ...deps, now: deps.now ?? (() => Date.now()) };
  return {
    async options() {
      const templates = deps.templates.list().flatMap((t) => {
        const hosts = isSecretRequestAuthKind(t.authKind)
          ? agentPresetHosts(t)
          : null;
        if (!hosts) return [];
        const inputs = t.authKind === "header" ? (t.configInputs ?? []) : [];
        return [
          {
            templateId: t.id,
            name: t.name,
            authKind: t.authKind,
            ...(t.description ? { description: t.description } : {}),
            hosts: [...hosts],
            ...(inputs.length > 0
              ? {
                  configInputs: inputs.map((i) => ({
                    name: i.inputName,
                    label: i.label,
                    ...(i.hint ? { hint: i.hint } : {}),
                    ...(i.enumValues ? { values: i.enumValues } : {}),
                  })),
                }
              : {}),
          },
        ];
      });
      const granted = await deps.repo.listConnectionsForAgent(deps.agentId);
      return {
        templates,
        connections: granted
          .filter((c) => isSecretRequestAuthKind(c.auth.kind))
          .map((c) => ({
            connectionId: c.id,
            name: c.name,
            templateId: c.templateId,
            authKind: c.auth.kind,
          })),
      };
    },
    request: (input) => issueSecretRequest(issuer, input, deps.agentId),
    status: (requestId) => secretRequestStatus(issuer, requestId, deps.agentId),
  };
}
