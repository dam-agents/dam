import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { match } from "ts-pattern";
import type {
  ConnectionRequestSecretInput,
  SecretlessConnectionCreateInput,
  SecretRequestState,
  SecretRequestTicket,
} from "api-server-api";
import { securityLog } from "../../../core/security-log.js";
import type { TtlStore } from "../../../core/ttl-store.js";
import type {
  ConnectionTemplate,
  ConnectionTemplateRegistry,
} from "../domain/connection-template.js";
import {
  destinationsOf,
  isSecretRequestAuthKind,
  planConnection,
  presetHostsOf,
  type PendingSecretRequest,
  type PlannedConnection,
  type SecretRequestOutcome,
} from "../domain/secret-request.js";
import type { ConnectionsRepository } from "../infrastructure/connections-repository.js";

export const SECRET_REQUEST_TTL_MS = 10 * 60 * 1000;
export const SECRET_REQUEST_PATH = "/connections/secret";

export interface SecretRequestIssuerDeps {
  ownerId: string;
  uiBaseUrl: string;
  pending: TtlStore<PendingSecretRequest>;
  outcomes: TtlStore<SecretRequestOutcome>;
  templates: ConnectionTemplateRegistry;
  repo: Pick<ConnectionsRepository, "get" | "listAgentsForConnection">;
  now: () => number;
}

export function badRequest(err: unknown): TRPCError {
  return new TRPCError({
    code: "BAD_REQUEST",
    message: err instanceof Error ? err.message : String(err),
  });
}

export async function issueSecretRequest(
  deps: SecretRequestIssuerDeps,
  input: ConnectionRequestSecretInput,
  agentId?: string,
): Promise<SecretRequestTicket> {
  if (input.action === "create") {
    const template = deps.templates.get(input.connection.templateId);
    if (!template) {
      throw badRequest(`unknown template ${input.connection.templateId}`);
    }
    let planned: PlannedConnection;
    try {
      planned = planConnection(template, input.connection);
    } catch (err) {
      throw badRequest(err);
    }
    if (
      agentId &&
      !goesToPresetHostsOnly(template, input.connection, planned)
    ) {
      throw badRequest(
        `an agent may ask only for a secret that goes to the hosts ${template.name} presets; ask your owner to connect it in Settings → Connections`,
      );
    }
  } else {
    const conn = await deps.repo.get(input.connectionId, deps.ownerId);
    if (!conn) throw new TRPCError({ code: "NOT_FOUND" });
    if (!isSecretRequestAuthKind(conn.auth.kind)) {
      throw badRequest(
        `a ${conn.auth.kind} connection takes no secret on this page`,
      );
    }
    if (
      agentId &&
      !(await deps.repo.listAgentsForConnection(conn.id)).includes(agentId)
    ) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
  }
  const requestId = randomBytes(24).toString("base64url");
  const expiresAt = deps.now() + SECRET_REQUEST_TTL_MS;
  await deps.pending.set(requestId, {
    ...input,
    ownerId: deps.ownerId,
    ...(agentId ? { agentId } : {}),
    expiresAt,
  } as PendingSecretRequest);
  securityLog("info", "connection.secret_request_created", {
    category: "credential",
    actor: agentId ?? deps.ownerId,
    actorKind: agentId ? "agent" : "user",
    result: "success",
    detail: { action: input.action },
  });
  return {
    requestId,
    url: `${deps.uiBaseUrl}${SECRET_REQUEST_PATH}?${new URLSearchParams({ request: requestId })}`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export async function secretRequestStatus(
  deps: SecretRequestIssuerDeps,
  requestId: string,
  agentId?: string,
): Promise<SecretRequestState> {
  const outcome = await deps.outcomes.peek(requestId);
  if (outcome?.ownerId === deps.ownerId && outcome.agentId === agentId) {
    return match(outcome)
      .with({ status: "saving" }, () => ({ status: "pending" as const }))
      .with({ status: "saved" }, (o) => ({
        status: "saved" as const,
        connectionId: o.connectionId,
        ...(o.check ? { check: o.check } : {}),
        ...(o.granted !== undefined ? { granted: o.granted } : {}),
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
    pending.agentId !== agentId ||
    pending.expiresAt <= deps.now()
  ) {
    return { status: "expired" };
  }
  return { status: "pending" };
}

function goesToPresetHostsOnly(
  template: ConnectionTemplate,
  connection: SecretlessConnectionCreateInput,
  planned: PlannedConnection,
): boolean {
  const preset = agentPresetHosts(template);
  if (!preset) return false;
  if (
    connection.authKind === "client-credentials" &&
    template.authKind === "client-credentials" &&
    connection.issuerUrl !== undefined &&
    connection.issuerUrl !== template.issuerUrl
  ) {
    return false;
  }
  return destinationsOf(planned.contributions).every((d) => preset.has(d.host));
}

export function agentPresetHosts(
  template: ConnectionTemplate,
): ReadonlySet<string> | null {
  if (template.isCustom) return null;
  const preset = presetHostsOf(template);
  return preset && preset.size > 0 ? preset : null;
}
