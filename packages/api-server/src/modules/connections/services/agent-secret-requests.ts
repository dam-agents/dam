import {
  secretlessConnectionCreateInputSchema,
  type ConnectionRequestSecretInput,
  type SecretRequestState,
  type SecretRequestTicket,
} from "api-server-api";
import type { ConnectionTemplate } from "../domain/connection-template.js";
import type { ConnectionsRepository } from "../infrastructure/connections-repository.js";
import { isSecretRequestAuthKind } from "../domain/secret-request.js";
import {
  agentPresetHosts,
  badRequest,
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
  inputs?: AgentSecretInput[];
}

interface AgentSecretInput {
  name: string;
  label: string;
  required?: true;
  hint?: string;
  values?: readonly string[];
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
  requestNew(input: {
    templateId: string;
    name: string;
    inputs?: Record<string, string>;
  }): Promise<SecretRequestTicket>;
  status(requestId: string): Promise<SecretRequestState>;
}

const GITHUB_APP_INPUTS: AgentSecretInput[] = [
  { name: "appId", label: "App ID", required: true },
  { name: "installationId", label: "Installation ID", required: true },
  {
    name: "repositories",
    label: "Repositories",
    hint: "the repository names the connection reaches, space- or comma-separated; without repositories or permissions the installation is saved and no connection is made from it",
  },
  {
    name: "permissions",
    label: "Permissions",
    hint: "name:level pairs the connection takes, e.g. contents:read issues:write",
  },
];

function inputsOf(template: ConnectionTemplate): AgentSecretInput[] {
  if (template.authKind === "github-app") return GITHUB_APP_INPUTS;
  if (template.authKind !== "header") return [];
  return (template.configInputs ?? []).map((i) => ({
    name: i.inputName,
    label: i.label,
    ...(i.hint ? { hint: i.hint } : {}),
    ...(i.enumValues ? { values: i.enumValues } : {}),
  }));
}

function connectionOf(
  template: ConnectionTemplate,
  name: string,
  inputs: Record<string, string>,
): ConnectionRequestSecretInput {
  const configNames = new Set(
    template.authKind === "header"
      ? (template.configInputs ?? []).map((i) => i.inputName)
      : [],
  );
  const configInputs = Object.fromEntries(
    Object.entries(inputs).filter(([key]) => configNames.has(key)),
  );
  const fields = Object.fromEntries(
    Object.entries(inputs).filter(([key]) => !configNames.has(key)),
  );
  const parsed = secretlessConnectionCreateInputSchema.safeParse({
    ...fields,
    templateId: template.id,
    name,
    authKind: template.authKind,
    ...(configNames.size > 0 ? { configInputs } : {}),
  });
  if (!parsed.success) {
    throw badRequest(
      parsed.error.issues
        .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
        .join("; "),
    );
  }
  return { action: "create", connection: parsed.data };
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
        const inputs = inputsOf(t);
        return [
          {
            templateId: t.id,
            name: t.name,
            authKind: t.authKind,
            ...(t.description ? { description: t.description } : {}),
            hosts: [...hosts],
            ...(inputs.length > 0 ? { inputs } : {}),
          },
        ];
      });
      const granted = await deps.repo.listConnectionsForAgent(deps.agentId);
      return {
        templates,
        connections: granted
          .filter((c) => isSecretRequestAuthKind(c.auth.kind) && !c.parentId)
          .map((c) => ({
            connectionId: c.id,
            name: c.name,
            templateId: c.templateId,
            authKind: c.auth.kind,
          })),
      };
    },
    request: (input) => issueSecretRequest(issuer, input, deps.agentId),
    async requestNew({ templateId, name, inputs }) {
      const template = deps.templates.get(templateId);
      if (!template) throw badRequest(`unknown template ${templateId}`);
      return issueSecretRequest(
        issuer,
        connectionOf(template, name, inputs ?? {}),
        deps.agentId,
      );
    },
    status: (requestId) => secretRequestStatus(issuer, requestId, deps.agentId),
  };
}
