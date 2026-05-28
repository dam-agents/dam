import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type {
  AgentConnections,
  Connection,
  ConnectionsService,
  ConnectionTemplateView,
  ConnectionView,
  Contribution,
} from "api-server-api";
import type { SecretStore } from "../../secret-store/index.js";
import type { ConnectionsRepository } from "../infrastructure/connections-repository.js";
import type { ConnectionTemplateRegistry } from "../domain/connection-template.js";
import { templateToView } from "../domain/connection-template.js";
import { buildConnection } from "../domain/build-connection.js";
import {
  buildConnectionSdsFields,
  CONNECTION_TOKEN_PLACEHOLDER,
} from "../domain/connection-sds.js";
import { discoverMcpAuth } from "../infrastructure/mcp-discovery.js";
import type { ContributionFanOut } from "./contribution-fanout.js";
import type { OAuthFlowService } from "./oauth-flow.js";
import { emit, EventType } from "../../../events.js";

export function createConnectionsService(deps: {
  ownerId: string;
  templates: ConnectionTemplateRegistry;
  repo: ConnectionsRepository;
  secretStore: SecretStore;
  fanOut: ContributionFanOut;
  oauthFlow: OAuthFlowService;
  oauthCallbackUrl: string;
  brandName: string;
}): ConnectionsService {
  function toView(conn: Connection): ConnectionView {
    const template = deps.templates.get(conn.templateId);
    const hosts = conn.contributions
      .filter(
        (
          c,
        ): c is Extract<
          Connection["contributions"][number],
          { kind: "egress-allow" | "egress-inject" }
        > => c.kind === "egress-allow" || c.kind === "egress-inject",
      )
      .map((c) => c.host);
    const oauthExtras =
      conn.auth.kind === "oauth"
        ? {
            ...(conn.auth.host ? { host: conn.auth.host } : {}),
            ...(conn.auth.appSlug ? { appSlug: conn.auth.appSlug } : {}),
          }
        : {};
    return {
      id: conn.id,
      ownerId: conn.ownerId,
      templateId: conn.templateId,
      category: template?.category ?? "other",
      name: conn.name,
      status: deriveStatus(conn),
      authKind: conn.auth.kind,
      contributions: conn.contributions,
      hosts,
      ...oauthExtras,
    };
  }

  return {
    async listTemplates(): Promise<ConnectionTemplateView[]> {
      return deps.templates.list().map(templateToView);
    },

    async listConnections(): Promise<ConnectionView[]> {
      const conns = await deps.repo.listByOwner(deps.ownerId);
      return conns.map(toView);
    },

    async getConnection(id: string): Promise<ConnectionView | null> {
      const conn = await deps.repo.get(id, deps.ownerId);
      return conn ? toView(conn) : null;
    },

    startOAuth(connectionId: string): Promise<{ authUrl: string }> {
      return deps.oauthFlow.startOAuth(connectionId);
    },

    async deleteConnection(id: string): Promise<void> {
      const conn = await deps.repo.get(id, deps.ownerId);
      if (!conn) return;

      const affectedAgents = await deps.repo.listAgentsForConnection(id);

      const paths = new Set<string>();
      switch (conn.auth.kind) {
        case "oauth":
          paths.add(conn.auth.accessTokenRef.path);
          if (conn.auth.refreshTokenRef) {
            paths.add(conn.auth.refreshTokenRef.path);
          }
          break;
        case "header":
          paths.add(conn.auth.valueRef.path);
          break;
        case "none":
          break;
      }
      for (const path of paths) {
        await deps.secretStore.delete({ path });
      }

      await deps.repo.delete(id, deps.ownerId);

      if (affectedAgents.length > 0) {
        const ownerConnsAfter = await deps.repo.listByOwner(deps.ownerId);
        const allOwnerConnectionIds = new Set(ownerConnsAfter.map((c) => c.id));
        for (const agentId of affectedAgents) {
          const grantedConnections =
            await deps.repo.listConnectionsForAgent(agentId);
          await deps.fanOut.apply({
            agentId,
            ownerId: deps.ownerId,
            grantedConnections,
            allOwnerConnectionIds,
          });
        }
      }

      const template = deps.templates.get(conn.templateId);
      emit({
        type: EventType.ConnectionRemoved,
        actorSub: deps.ownerId,
        connectionKey: conn.id,
        kind: template?.category === "mcp" ? "mcp" : "oauth_app",
      });
    },

    async getAgentConnections(agentId: string): Promise<AgentConnections> {
      const grants = await deps.repo.listAgentGrants(agentId);
      return {
        agentId,
        connections: grants.map((g) => ({
          connectionId: g.connectionId,
          grantedAt: g.grantedAt.toISOString(),
        })),
      };
    },

    async setAgentConnections(
      agentId: string,
      connectionIds: string[],
    ): Promise<void> {
      const deduped = Array.from(new Set(connectionIds));

      const owned = await deps.repo.listByOwner(deps.ownerId);
      const ownedById = new Map(owned.map((c) => [c.id, c]));
      for (const id of deduped) {
        if (!ownedById.has(id)) {
          throw new Error(`connection ${id} not owned by caller`);
        }
      }

      const current = await deps.repo.listAgentGrants(agentId);
      const currentIds = new Set(current.map((c) => c.connectionId));
      const desiredIds = new Set(deduped);

      const toGrant = deduped.filter((id) => !currentIds.has(id));
      const toRevoke = current
        .map((c) => c.connectionId)
        .filter((id) => !desiredIds.has(id));

      for (const id of toGrant) await deps.repo.grant(id, agentId);
      for (const id of toRevoke) await deps.repo.revoke(id, agentId);

      const grantedConnections = deduped
        .map((id) => ownedById.get(id))
        .filter((c): c is Connection => c !== undefined);
      await deps.fanOut.apply({
        agentId,
        ownerId: deps.ownerId,
        grantedConnections,
        allOwnerConnectionIds: new Set(owned.map((c) => c.id)),
      });
    },

    async createFromTemplate(input): Promise<string> {
      const template = deps.templates.get(input.templateId);
      if (!template) {
        throw new Error(`unknown template ${input.templateId}`);
      }
      const built = await buildConnection(
        template,
        input,
        (purpose) => deps.secretStore.mintRef({ owner: deps.ownerId, purpose }),
        deps.oauthCallbackUrl,
        deps.brandName,
      );

      const id = newConnectionId();
      const contributions = built.contributions.map(
        (c): Contribution =>
          c.kind === "mcp-entry" ? { ...c, name: input.name } : c,
      );
      const secretPath = connectionSecretPath(built.auth);

      if (secretPath) {
        const placeholderSds = buildConnectionSdsFields(
          contributions,
          CONNECTION_TOKEN_PLACEHOLDER,
        );
        await deps.secretStore.put(
          { storeId: deps.secretStore.storeId, path: secretPath, field: "" },
          { ...placeholderSds, ...(built.secrets.get(secretPath) ?? {}) },
          {
            owner: deps.ownerId,
            purpose: `connection:${template.id}`,
            extraLabels: {
              "agent-platform.ai/secret-type": "connection",
              "agent-platform.ai/connection": id,
            },
            extraAnnotations: connectionSecretAnnotations(contributions),
          },
        );
      }

      try {
        await deps.repo.insert({
          id,
          ownerId: deps.ownerId,
          templateId: template.id,
          name: input.name,
          inputs: stripSecretsFromInputs(input),
          auth: built.auth,
          contributions,
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A connection named "${input.name}" already exists. Names must be unique per user.`,
          });
        }
        throw err;
      }
      return id;
    },

    async discoverMcp(input): Promise<{ auth: "oauth" | "none" }> {
      try {
        const meta = await discoverMcpAuth(new URL(input.url));
        return {
          auth: meta && meta.registrationEndpoint ? "oauth" : "none",
        };
      } catch {
        return { auth: "none" };
      }
    },
  };
}

function stripSecretsFromInputs(input: {
  authKind: "oauth" | "header" | "none";
  [k: string]: unknown;
}): Record<string, unknown> {
  const SECRET_KEYS = ["value", "clientSecret"];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (SECRET_KEYS.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

function deriveStatus(conn: Connection): ConnectionView["status"] {
  switch (conn.auth.kind) {
    case "oauth":
      return conn.auth.expiresAt ? "active" : "pending";
    case "header":
      return "active";
    case "none":
      return "active";
  }
}

function newConnectionId(): string {
  return `conn-${randomBytes(6).toString("hex")}`;
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  return e.code === "23505" || e.cause?.code === "23505";
}

function connectionSecretPath(auth: Connection["auth"]): string | null {
  switch (auth.kind) {
    case "oauth":
      return auth.accessTokenRef.path;
    case "header":
      return auth.valueRef.path;
    case "none":
      return null;
  }
}

function connectionSecretAnnotations(
  contributions: Connection["contributions"],
): Record<string, string> {
  const envMappings = contributions
    .filter(
      (c): c is Extract<Connection["contributions"][number], { kind: "env" }> =>
        c.kind === "env",
    )
    .map((c) => ({ envName: c.name, placeholder: c.placeholder }));

  const injectionHosts = contributions
    .filter(
      (
        c,
      ): c is Extract<
        Connection["contributions"][number],
        { kind: "egress-inject" }
      > => c.kind === "egress-inject",
    )
    .map((c) => ({
      host: c.host,
      ...(c.pathPattern ? { pathPattern: c.pathPattern } : {}),
      headerName: c.headerName,
      valueFormat: c.valueFormat,
      ...(c.encoding ? { encoding: c.encoding } : {}),
    }));

  const out: Record<string, string> = {};
  if (envMappings.length > 0) {
    out["agent-platform.ai/env-mappings"] = JSON.stringify(envMappings);
  }
  if (injectionHosts.length > 0) {
    out["agent-platform.ai/injection-hosts"] = JSON.stringify(injectionHosts);
  }
  return out;
}
