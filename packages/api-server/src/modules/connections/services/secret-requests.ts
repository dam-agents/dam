import { TRPCError } from "@trpc/server";
import type {
  Connection,
  ConnectionsService,
  SecretRequestsService,
  SecretRequestView,
} from "api-server-api";
import { CredentialCheckNotPassed } from "../domain/credential-check.js";
import { securityLog } from "../../../core/security-log.js";
import type { TtlStore } from "../../../core/ttl-store.js";
import type { ConnectionTemplateRegistry } from "../domain/connection-template.js";
import {
  credentialUpdateOf,
  destinationsOf,
  envNamesOf,
  githubAppAccessOf,
  isSecretRequestAuthKind,
  planConnection,
  presetHostsOf,
  readSecretFields,
  secretFieldsFor,
  unexpectedHostsOf,
  withSecret,
  type PendingSecretRequest,
  type SecretRequestOutcome,
} from "../domain/secret-request.js";
import type { ConnectionsRepository } from "../infrastructure/connections-repository.js";
import {
  badRequest,
  issueSecretRequest,
  secretRequestStatus,
} from "./secret-request-issuer.js";

export {
  SECRET_REQUEST_PATH,
  SECRET_REQUEST_TTL_MS,
} from "./secret-request-issuer.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a Secret Request lets the user's own agent run
 * `dam connection connect` or `update` itself while the user types the secret
 * on a page of the web app instead. The CLI creates the request with every
 * non-secret input; the page shows them and takes the secret; the CLI polls
 * the status. The link carries a random id only. The page and the submit
 * check that the signed-in user owns the request, so a link sent to another
 * user is no use to the sender. A request is used once, and expires after ten
 * minutes. Nobody can read a secret back: the status says only saved,
 * cancelled, expired or pending, and stays pending while a submit is saving.
 * A credential whose template names a check is checked before it is saved:
 * one that does not pass is held, and the link stays usable, until the user
 * fixes it or confirms the save anyway; the saved status carries the result.
 */
export function createSecretRequestsService(deps: {
  ownerId: string;
  uiBaseUrl: string;
  pending: TtlStore<PendingSecretRequest>;
  outcomes: TtlStore<SecretRequestOutcome>;
  templates: ConnectionTemplateRegistry;
  repo: Pick<
    ConnectionsRepository,
    "get" | "listAgentsForConnection" | "listChildren"
  >;
  connections: Pick<
    ConnectionsService,
    "createFromTemplate" | "update" | "getConnection" | "updateAgentConnections"
  >;
  agentName: (agentId: string) => Promise<string | null>;
  now?: () => number;
}): SecretRequestsService {
  const now = deps.now ?? (() => Date.now());
  const issuer = { ...deps, now };

  async function owned(requestId: string): Promise<PendingSecretRequest> {
    const pending = await deps.pending.peek(requestId);
    if (!pending || pending.expiresAt <= now()) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "This link has expired or was already used.",
      });
    }
    if (pending.ownerId !== deps.ownerId) {
      securityLog("warn", "connection.secret_request_foreign", {
        category: "credential",
        actor: deps.ownerId,
        actorKind: "user",
        result: "failure",
        reason: "request belongs to another user",
      });
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "This link was created by another user. Sign in as the user who ran the command.",
      });
    }
    return pending;
  }

  async function grantedAgents(
    conn: Connection,
  ): Promise<{ id: string; name: string }[]> {
    const holders = conn.isParent
      ? (await deps.repo.listChildren(conn.id)).map((c) => c.id)
      : [conn.id];
    const ids = [
      ...new Set(
        (
          await Promise.all(
            holders.map((id) => deps.repo.listAgentsForConnection(id)),
          )
        ).flat(),
      ),
    ];
    return Promise.all(
      ids.map(async (id) => ({ id, name: (await deps.agentName(id)) ?? id })),
    );
  }

  async function grantTo(
    agentId: string,
    connectionId: string,
  ): Promise<boolean> {
    try {
      await deps.connections.updateAgentConnections(agentId, {
        grant: [connectionId],
        revoke: [],
      });
      return true;
    } catch (err) {
      securityLog("warn", "connection.secret_request_grant_failed", {
        category: "credential",
        actor: deps.ownerId,
        actorKind: "user",
        agentId,
        target: connectionId,
        result: "failure",
        reason: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  return {
    request: (input) => issueSecretRequest(issuer, input),

    status: (requestId) => secretRequestStatus(issuer, requestId),

    async get(requestId) {
      const pending = await owned(requestId);
      const expiresAt = new Date(pending.expiresAt).toISOString();
      const requestedBy = pending.agentId
        ? {
            requestedBy: {
              id: pending.agentId,
              name: (await deps.agentName(pending.agentId)) ?? pending.agentId,
            },
          }
        : {};
      if (pending.action === "update") {
        const conn = await deps.repo.get(pending.connectionId, deps.ownerId);
        if (!conn || !isSecretRequestAuthKind(conn.auth.kind)) return null;
        const template = deps.templates.get(conn.templateId);
        const destinations = destinationsOf(conn.contributions);
        return {
          action: "update",
          connectionName: conn.name,
          connectionId: conn.id,
          templateId: conn.templateId,
          templateName: template?.name ?? conn.templateId,
          ...(template?.iconSlug ? { iconSlug: template.iconSlug } : {}),
          authKind: conn.auth.kind,
          destinations,
          unexpectedHosts: [],
          customDestination: template?.isCustom ?? false,
          envNames: envNamesOf(conn.contributions),
          ...(conn.isParent ? { isParent: true as const } : {}),
          grantedAgents: await grantedAgents(conn),
          ...requestedBy,
          fields: secretFieldsFor(conn.auth.kind),
          expiresAt,
        } satisfies SecretRequestView;
      }
      const template = deps.templates.get(pending.connection.templateId);
      if (!template) return null;
      const planned = planConnection(template, pending.connection);
      const destinations = destinationsOf(planned.contributions);
      const configInputs =
        pending.connection.authKind === "header"
          ? pending.connection.configInputs
          : undefined;
      const preset = presetHostsOf(template, configInputs);
      return {
        action: "create",
        connectionName: pending.connection.name,
        templateId: template.id,
        templateName: template.name,
        ...(template.iconSlug ? { iconSlug: template.iconSlug } : {}),
        authKind: pending.connection.authKind,
        destinations,
        unexpectedHosts: unexpectedHostsOf(preset, destinations),
        customDestination: template.isCustom || preset === null,
        ...(planned.tokenEndpoint
          ? { tokenEndpoint: planned.tokenEndpoint }
          : {}),
        envNames: envNamesOf(planned.contributions),
        ...(pending.connection.authKind === "github-app"
          ? { githubAppAccess: githubAppAccessOf(pending.connection) }
          : {}),
        grantedAgents: [],
        ...requestedBy,
        fields: secretFieldsFor(pending.connection.authKind),
        expiresAt,
      } satisfies SecretRequestView;
    },

    async submit({ requestId, fields, saveAnyway }) {
      const pending = await owned(requestId);
      const kind =
        pending.action === "create"
          ? pending.connection.authKind
          : (await deps.repo.get(pending.connectionId, deps.ownerId))?.auth
              .kind;
      if (!kind || !isSecretRequestAuthKind(kind)) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      let secret: Record<string, string>;
      try {
        secret = readSecretFields(kind, fields);
      } catch (err) {
        throw badRequest(err);
      }
      const claimed = await deps.pending.consume(requestId);
      if (!claimed) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This link has expired or was already used.",
        });
      }
      const requester = claimed.agentId ? { agentId: claimed.agentId } : {};
      await deps.outcomes.set(requestId, {
        ownerId: deps.ownerId,
        ...requester,
        status: "saving",
      });
      const policy = { holdUnlessPassed: saveAnyway !== true };
      let connectionId: string;
      try {
        if (claimed.action === "create") {
          connectionId = await deps.connections.createFromTemplate(
            withSecret(claimed.connection, secret),
            policy,
          );
        } else {
          await deps.connections.update(
            claimed.connectionId,
            credentialUpdateOf(kind, secret),
            policy,
          );
          connectionId = claimed.connectionId;
        }
      } catch (err) {
        if (claimed.expiresAt > now()) {
          await deps.pending.set(requestId, claimed);
        }
        await deps.outcomes.delete(requestId);
        if (err instanceof CredentialCheckNotPassed) {
          return { status: "check-not-passed", check: err.check };
        }
        throw err;
      }
      const saved = await deps.connections.getConnection(connectionId);
      const check = saved?.check;
      const granted =
        claimed.agentId && claimed.action === "create"
          ? {
              granted:
                !saved?.isParent &&
                (await grantTo(claimed.agentId, connectionId)),
            }
          : {};
      await deps.outcomes.set(requestId, {
        ownerId: deps.ownerId,
        ...requester,
        status: "saved",
        connectionId,
        ...(check ? { check } : {}),
        ...granted,
      });
      securityLog("info", "connection.secret_request_saved", {
        category: "credential",
        actor: deps.ownerId,
        actorKind: "user",
        target: connectionId,
        result: "success",
        detail: { action: claimed.action },
      });
      return {
        status: "saved",
        connectionId,
        ...(check ? { check } : {}),
        ...granted,
      };
    },

    async cancel(requestId) {
      await owned(requestId);
      const claimed = await deps.pending.consume(requestId);
      if (!claimed) return;
      await deps.outcomes.set(requestId, {
        ownerId: deps.ownerId,
        ...(claimed.agentId ? { agentId: claimed.agentId } : {}),
        status: "cancelled",
      });
    },
  };
}
