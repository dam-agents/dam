import { randomBytes } from "node:crypto";
import type {
  AgentConnections,
  Connection,
  ConnectionsService,
  ConnectionTemplateView,
  ConnectionView,
} from "api-server-api";
import type { SecretStore } from "../../secret-store/index.js";
import type { ConnectionsRepository } from "../infrastructure/connections-repository.js";
import type { ConnectionTemplateRegistry } from "../domain/connection-template.js";
import type { ContributionFanOut } from "./contribution-fanout.js";
import type { OAuthFlowService } from "./oauth-flow.js";

/**
 * Owner-scoped Connections service (ADR-051). The user-facing API the UI
 * talks to. Wraps the Connections repository + template registry +
 * SecretStore + contribution fan-out.
 *
 * Per-user scoping: every call is bound to one `ownerId` at compose time
 * (set from the authenticated request's JWT sub). No call accepts owner
 * as an argument; routing through the wrong owner is impossible by
 * construction.
 *
 * Template-driven create: the only way to create a Connection is to
 * project user inputs through `template.build()`. The Connections service
 * doesn't accept raw `auth` or `contributions` from the wire — those are
 * always template-computed.
 */
export function createConnectionsService(deps: {
  ownerId: string;
  templates: ConnectionTemplateRegistry;
  repo: ConnectionsRepository;
  secretStore: SecretStore;
  fanOut: ContributionFanOut;
  oauthFlow: OAuthFlowService;
}): ConnectionsService {
  function toView(conn: Connection): ConnectionView {
    const template = deps.templates.get(conn.templateId);
    const hosts = conn.contributions
      .filter(
        (
          c,
        ): c is Extract<
          Connection["contributions"][number],
          { kind: "egress-host" }
        > => c.kind === "egress-host",
      )
      .map((c) => c.host);
    return {
      id: conn.id,
      ownerId: conn.ownerId,
      templateId: conn.templateId,
      category: template?.category ?? "other",
      name: conn.name,
      // Status derives from the auth state. For now: oauth without an
      // expiresAt is "pending" (token never written); otherwise "active".
      // OAuth-refresh failure will flip this to "expired" in a follow-up.
      status: deriveStatus(conn),
      authKind: conn.auth.kind,
      contributions: conn.contributions,
      hosts,
    };
  }

  return {
    async listTemplates(): Promise<ConnectionTemplateView[]> {
      return deps.templates.list().map((t) => t.toView());
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

      // Find which agents had this granted so we can fan out the post-
      // delete state to them. We don't know the agent set without reading
      // the grants table — the repo's delete sweeps grants, so we read
      // first.
      // Phase A: skip per-agent re-fanout on delete; the cron sweep + the
      // agent's next `hello` will pick up the missing contribution. Mark
      // as a TODO — explicit fan-out is task #8's final piece.

      // Best-effort cleanup of the backing secret. Multiple SecretRefs
      // could point into one path (oauth has access + refresh fields under
      // one secret); dedup by path.
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

      // Validate every requested connection exists and is owned by the
      // caller. Reject the whole call on the first miss — partial grants
      // aren't worth the surprise.
      const owned = await deps.repo.listByOwner(deps.ownerId);
      const ownedById = new Map(owned.map((c) => [c.id, c]));
      for (const id of deduped) {
        if (!ownedById.has(id)) {
          throw new Error(`connection ${id} not owned by caller`);
        }
      }

      // Diff against current grants; insert + delete the changeset.
      const current = await deps.repo.listAgentGrants(agentId);
      const currentIds = new Set(current.map((c) => c.connectionId));
      const desiredIds = new Set(deduped);

      const toGrant = deduped.filter((id) => !currentIds.has(id));
      const toRevoke = current
        .map((c) => c.connectionId)
        .filter((id) => !desiredIds.has(id));

      for (const id of toGrant) await deps.repo.grant(id, agentId);
      for (const id of toRevoke) await deps.repo.revoke(id, agentId);

      // Fan-out the resulting state to all three rails.
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
      const validatedInputs = template.inputs.parse(input.inputs);
      const built = template.build({
        ownerId: deps.ownerId,
        inputs: validatedInputs,
        mintSecretRef: (purpose) =>
          deps.secretStore.mintRef({ owner: deps.ownerId, purpose }),
      });

      // Write secrets the template materialized BEFORE persisting the
      // Connection row — if a write fails partway, the Connection row
      // never exists, so no caller will see refs to half-populated paths.
      for (const [path, fields] of built.secrets) {
        await deps.secretStore.put(
          { storeId: deps.secretStore.storeId, path, field: "" },
          fields,
          { owner: deps.ownerId, purpose: `connection:${template.id}` },
        );
      }

      const id = newConnectionId();
      await deps.repo.insert({
        id,
        ownerId: deps.ownerId,
        templateId: template.id,
        name: input.name?.trim() || built.defaultName,
        inputs: validatedInputs as Record<string, unknown>,
        auth: built.auth,
        contributions: built.contributions,
      });
      return id;
    },
  };
}

function deriveStatus(conn: Connection): ConnectionView["status"] {
  switch (conn.auth.kind) {
    case "oauth":
      // Without a recorded `expiresAt`, the token has never been written
      // (created-but-not-connected). After OAuth callback the refresh
      // service populates expiresAt + tokens.
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
