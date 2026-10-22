import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { match } from "ts-pattern";
import type {
  ConnectionsService,
  SecretRequestsService,
  SecretRequestView,
} from "api-server-api";
import { securityLog } from "../../../core/security-log.js";
import type { TtlStore } from "../../../core/ttl-store.js";
import type { ConnectionTemplateRegistry } from "../domain/connection-template.js";
import {
  credentialUpdateOf,
  destinationsOf,
  envNamesOf,
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

export const SECRET_REQUEST_TTL_MS = 10 * 60 * 1000;
export const SECRET_REQUEST_PATH = "/connections/secret";

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
 */
export function createSecretRequestsService(deps: {
  ownerId: string;
  uiBaseUrl: string;
  pending: TtlStore<PendingSecretRequest>;
  outcomes: TtlStore<SecretRequestOutcome>;
  templates: ConnectionTemplateRegistry;
  repo: Pick<ConnectionsRepository, "get" | "listAgentsForConnection">;
  connections: Pick<ConnectionsService, "createFromTemplate" | "update">;
  agentName: (agentId: string) => Promise<string | null>;
  now?: () => number;
}): SecretRequestsService {
  const now = deps.now ?? (() => Date.now());

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

  function badRequest(err: unknown): TRPCError {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  async function grantedAgents(
    connectionId: string,
  ): Promise<{ id: string; name: string }[]> {
    const ids = await deps.repo.listAgentsForConnection(connectionId);
    return Promise.all(
      ids.map(async (id) => ({ id, name: (await deps.agentName(id)) ?? id })),
    );
  }

  return {
    async request(input) {
      if (input.action === "create") {
        const template = deps.templates.get(input.connection.templateId);
        if (!template) {
          throw badRequest(`unknown template ${input.connection.templateId}`);
        }
        try {
          planConnection(template, input.connection);
        } catch (err) {
          throw badRequest(err);
        }
      } else {
        const conn = await deps.repo.get(input.connectionId, deps.ownerId);
        if (!conn) throw new TRPCError({ code: "NOT_FOUND" });
        if (!isSecretRequestAuthKind(conn.auth.kind)) {
          throw badRequest(
            `a ${conn.auth.kind} connection takes no secret on this page`,
          );
        }
      }
      const requestId = randomBytes(24).toString("base64url");
      const expiresAt = now() + SECRET_REQUEST_TTL_MS;
      await deps.pending.set(requestId, {
        ...input,
        ownerId: deps.ownerId,
        expiresAt,
      } as PendingSecretRequest);
      securityLog("info", "connection.secret_request_created", {
        category: "credential",
        actor: deps.ownerId,
        actorKind: "user",
        result: "success",
        detail: { action: input.action },
      });
      return {
        requestId,
        url: `${deps.uiBaseUrl}${SECRET_REQUEST_PATH}?${new URLSearchParams({ request: requestId })}`,
        expiresAt: new Date(expiresAt).toISOString(),
      };
    },

    async status(requestId) {
      const outcome = await deps.outcomes.peek(requestId);
      if (outcome?.ownerId === deps.ownerId) {
        return match(outcome)
          .with({ status: "saving" }, () => ({ status: "pending" as const }))
          .with({ status: "saved" }, (o) => ({
            status: "saved" as const,
            connectionId: o.connectionId,
          }))
          .with({ status: "cancelled" }, () => ({
            status: "cancelled" as const,
          }))
          .exhaustive();
      }
      const pending = await deps.pending.peek(requestId);
      if (
        !pending ||
        pending.ownerId !== deps.ownerId ||
        pending.expiresAt <= now()
      ) {
        return { status: "expired" };
      }
      return { status: "pending" };
    },

    async get(requestId) {
      const pending = await owned(requestId);
      const expiresAt = new Date(pending.expiresAt).toISOString();
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
          grantedAgents: await grantedAgents(conn.id),
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
        grantedAgents: [],
        fields: secretFieldsFor(pending.connection.authKind),
        expiresAt,
      } satisfies SecretRequestView;
    },

    async submit({ requestId, fields }) {
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
      await deps.outcomes.set(requestId, {
        ownerId: deps.ownerId,
        status: "saving",
      });
      let connectionId: string;
      try {
        if (claimed.action === "create") {
          connectionId = await deps.connections.createFromTemplate(
            withSecret(claimed.connection, secret),
          );
        } else {
          await deps.connections.update(
            claimed.connectionId,
            credentialUpdateOf(kind, secret),
          );
          connectionId = claimed.connectionId;
        }
      } catch (err) {
        if (claimed.expiresAt > now()) {
          await deps.pending.set(requestId, claimed);
        }
        await deps.outcomes.delete(requestId);
        throw err;
      }
      await deps.outcomes.set(requestId, {
        ownerId: deps.ownerId,
        status: "saved",
        connectionId,
      });
      securityLog("info", "connection.secret_request_saved", {
        category: "credential",
        actor: deps.ownerId,
        actorKind: "user",
        target: connectionId,
        result: "success",
        detail: { action: claimed.action },
      });
      return { connectionId };
    },

    async cancel(requestId) {
      await owned(requestId);
      if (!(await deps.pending.consume(requestId))) return;
      await deps.outcomes.set(requestId, {
        ownerId: deps.ownerId,
        status: "cancelled",
      });
    },
  };
}
