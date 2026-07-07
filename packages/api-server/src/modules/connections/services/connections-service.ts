import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type {
  AgentConnections,
  Connection,
  ConnectionCreateInput,
  ConnectionsService,
  ConnectionTemplateView,
  ConnectionView,
  Contribution,
  SecretRef,
} from "api-server-api";
import type { SecretStore } from "../../secret-store/index.js";
import type { ConnectionsRepository } from "../infrastructure/connections-repository.js";
import type {
  ConnectionTemplate,
  ConnectionTemplateRegistry,
} from "../domain/connection-template.js";
import {
  inheritsFamily,
  templateToView,
} from "../domain/connection-template.js";
import { buildConnection } from "../domain/build-connection.js";
import {
  buildConnectionSdsFields,
  connectionSecretAnnotations,
  CONNECTION_TOKEN_PLACEHOLDER,
} from "../domain/connection-sds.js";
import { discoverMcpAuth } from "../infrastructure/mcp-discovery.js";
import { probeClusterCa } from "../infrastructure/cluster-ca-probe.js";
import type { ContributionFanOut } from "./contribution-fanout.js";
import type { OAuthFlowService } from "./oauth-flow.js";
import { emit, EventType } from "../../../events.js";
import { securityLog } from "../../../core/security-log.js";
import { isUniqueViolation } from "../../../core/db-errors.js";

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
            ...(conn.auth.connectedAt
              ? {
                  connectedAt: new Date(
                    conn.auth.connectedAt * 1000,
                  ).toISOString(),
                }
              : {}),
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

  // Client creds the user already registered on a sibling connection, keyed
  // by `credentialFamily` (e.g. all Google services share one Google Cloud
  // client). First stored creds per family wins.
  async function familyClientCreds(): Promise<
    Map<string, { clientId: string; clientSecretRef?: SecretRef }>
  > {
    const out = new Map<
      string,
      { clientId: string; clientSecretRef?: SecretRef }
    >();
    const conns = await deps.repo.listByOwner(deps.ownerId);
    for (const conn of conns) {
      if (conn.auth.kind !== "oauth" || !conn.auth.clientId) continue;
      const t = deps.templates.get(conn.templateId);
      const family = t?.authKind === "oauth" ? t.credentialFamily : undefined;
      if (!family || out.has(family)) continue;
      out.set(family, {
        clientId: conn.auth.clientId,
        ...(conn.auth.clientSecretRef
          ? { clientSecretRef: conn.auth.clientSecretRef }
          : {}),
      });
    }
    return out;
  }

  async function applyFamilyCreds(
    template: ConnectionTemplate,
    input: ConnectionCreateInput,
  ): Promise<ConnectionCreateInput> {
    if (
      input.authKind !== "oauth" ||
      !inheritsFamily(template) ||
      input.clientId
    ) {
      return input;
    }
    const creds = (await familyClientCreds()).get(template.credentialFamily!);
    if (!creds) return input;
    const clientSecret =
      !input.clientSecret && creds.clientSecretRef
        ? await deps.secretStore.getField(creds.clientSecretRef)
        : input.clientSecret;
    return {
      ...input,
      clientId: creds.clientId,
      ...(clientSecret ? { clientSecret } : {}),
    };
  }

  return {
    async listTemplates(): Promise<ConnectionTemplateView[]> {
      const templates = deps.templates.list();
      const family = templates.some(inheritsFamily)
        ? await familyClientCreds()
        : null;
      return templates.map((t) => {
        const creds =
          family && inheritsFamily(t) ? family.get(t.credentialFamily!) : null;
        const preset = creds
          ? { clientId: creds.clientId, hasSecret: !!creds.clientSecretRef }
          : undefined;
        return templateToView(t, deps.oauthCallbackUrl, preset);
      });
    },

    async listConnections(): Promise<ConnectionView[]> {
      const conns = await deps.repo.listByOwner(deps.ownerId);
      return conns.map(toView);
    },

    async getConnection(id: string): Promise<ConnectionView | null> {
      const conn = await deps.repo.get(id, deps.ownerId);
      return conn ? toView(conn) : null;
    },

    startOAuth(
      connectionId: string,
      opts?: { returnTo?: string; popup?: boolean },
    ): Promise<{ authUrl: string }> {
      return deps.oauthFlow.startOAuth(connectionId, opts);
    },

    async update(id: string, value: string): Promise<void> {
      const conn = await deps.repo.get(id, deps.ownerId);
      if (!conn) throw new TRPCError({ code: "NOT_FOUND" });
      if (conn.auth.kind !== "header") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only header-credential connections support value update",
        });
      }

      const sdsFields = buildConnectionSdsFields(conn.contributions, value);
      await deps.secretStore.putFields(conn.auth.valueRef, {
        value,
        ...sdsFields,
      });

      securityLog("info", "connection.update", {
        category: "credential",
        actor: deps.ownerId,
        actorKind: "user",
        target: conn.id,
        result: "success",
        detail: { templateId: conn.templateId, authKind: conn.auth.kind },
      });
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
        // The fan-out's egress sweep only revokes rules whose source id is in
        // this owned set; `id` is already gone from `ownerConnsAfter`, so keep
        // it here or the deleted connection's egress-allow rows would leak onto
        // every affected agent.
        const allOwnerConnectionIds = new Set([
          ...ownerConnsAfter.map((c) => c.id),
          id,
        ]);
        for (const agentId of affectedAgents) {
          try {
            const grantedConnections =
              await deps.repo.listConnectionsForAgent(agentId);
            await deps.fanOut.apply({
              agentId,
              ownerId: deps.ownerId,
              grantedConnections,
              allOwnerConnectionIds,
            });
          } catch (err) {
            securityLog("warn", "connection.delete.fanout_failed", {
              category: "credential",
              actor: deps.ownerId,
              actorKind: "user",
              agentId,
              target: conn.id,
              result: "failure",
              reason: err instanceof Error ? err.message : "unknown",
            });
          }
        }
      }

      const template = deps.templates.get(conn.templateId);
      securityLog("info", "connection.delete", {
        category: "credential",
        actor: deps.ownerId,
        actorKind: "user",
        target: conn.id,
        result: "success",
        detail: {
          templateId: conn.templateId,
          authKind: conn.auth.kind,
          secretsDeleted: paths.size,
          affectedAgents: affectedAgents.length,
        },
      });
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
          securityLog("warn", "authz.owner_mismatch", {
            category: "authz",
            actor: deps.ownerId,
            actorKind: "user",
            agentId,
            decision: "deny",
            reason: "connection-not-owned",
            target: id,
            detail: { surface: "connection.grants_set" },
          });
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

      if (toGrant.length > 0 || toRevoke.length > 0) {
        // Links "credential granted" to "agent that may inject it".
        securityLog("info", "connection.grants_set", {
          category: "authz-list",
          actor: deps.ownerId,
          actorKind: "user",
          agentId,
          result: "success",
          detail: { granted: toGrant, revoked: toRevoke },
        });
      }

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
      const effectiveInput = await applyFamilyCreds(template, input);
      const built = await buildConnection(
        template,
        effectiveInput,
        (purpose) => deps.secretStore.mintRef({ owner: deps.ownerId, purpose }),
        deps.oauthCallbackUrl,
        deps.brandName,
      );

      // The migration supplies a deterministic id (derived from the legacy
      // secret) so re-runs are idempotent; interactive callers omit it.
      const id = input.id ?? newConnectionId();
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
      // Header-auth connections store a credential at rest here with no
      // ConnectionCreated event (that fires only on OAuth-callback completion).
      securityLog("info", "connection.create", {
        category: "credential",
        actor: deps.ownerId,
        actorKind: "user",
        target: id,
        result: "success",
        detail: { templateId: template.id, authKind: built.auth.kind },
      });
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

    probeClusterCa(input) {
      return probeClusterCa(input.host);
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
      // `expiresAt` stays in the OR for back-compat: connections created
      // before `connectedAt` existed have an expiry but no marker.
      return conn.auth.connectedAt || conn.auth.expiresAt
        ? "active"
        : "pending";
    case "header":
      return "active";
    case "none":
      return "active";
  }
}

function newConnectionId(): string {
  return `conn-${randomBytes(6).toString("hex")}`;
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
