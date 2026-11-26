import {
  describeApprovalPayload,
  type ApprovalStatus,
  type OwnerRoute,
} from "api-server-api";
import type { ApprovalsRepository } from "../infrastructure/approvals-repository.js";
import type { PendingApprovalRow } from "../domain/types.js";
import { emit, EventType } from "../../../events.js";
import { securityLog } from "../../../core/security-log.js";
import type { HoldWaiters } from "./held-verdict.js";

export interface OwnerRequestViewData {
  id: string;
  kind: string;
  status: ApprovalStatus;
  agentId: string;
  ownerSub: string;
  route: OwnerRoute | null;
  summary: string;
  host: string | null;
  expiresAt: string;
}

const UNREACHABLE_DECIDER = "system:owner-unreachable";

function summaryOf(row: PendingApprovalRow): string {
  const { payload } = row;
  if (payload.kind === "ext_authz") {
    const host = `${payload.host}${payload.port ? `:${payload.port}` : ""}`;
    return payload.method === "*"
      ? `HTTPS to ${host}`
      : `${payload.method} ${host}${payload.path}`;
  }
  const described = describeApprovalPayload(payload);
  return described.subtitle
    ? `${described.title}: ${described.subtitle}`
    : described.title;
}

function hostOf(row: PendingApprovalRow): string | null {
  return row.payload.kind === "ext_authz" ? row.payload.host : null;
}

// UNIT_BOUNDARY_DESCRIPTION: what the approvals module gives the Slack cards of owner requests: a view of one routed request in the platform's own words, the refusal of a `turn` request whose card cannot reach its owner (denied as the system, so the thread does not wait for a card that never comes), and whether any held request still waits for an answer.
export function createOwnerRequestPorts(deps: {
  repo: Pick<ApprovalsRepository, "getPending" | "resolvePending">;
  waiters: HoldWaiters;
}) {
  return {
    async view(id: string): Promise<OwnerRequestViewData | null> {
      const row = await deps.repo.getPending(id);
      if (!row) return null;
      return {
        id: row.id,
        kind: row.type,
        status: row.status,
        agentId: row.agentId,
        ownerSub: row.ownerSub,
        route: row.ownerRoute ?? null,
        summary: summaryOf(row),
        host: hostOf(row),
        expiresAt: row.expiresAt.toISOString(),
      };
    },

    async refuseUnreachable(id: string): Promise<boolean> {
      const row = await deps.repo.getPending(id);
      if (!row || row.status !== "pending") return false;
      const denied = await deps.repo.resolvePending(
        id,
        "deny_once",
        UNREACHABLE_DECIDER,
      );
      if (!denied) return false;
      emit({
        type: EventType.ApprovalResolved,
        approvalId: id,
        agentId: row.agentId,
        ownerSub: row.ownerSub,
        resolution: "deny_once",
        ...(row.ownerRoute ? { ownerRoute: row.ownerRoute } : {}),
      });
      securityLog("warn", "egress.decision", {
        category: "egress",
        actor: row.ownerSub,
        actorKind: "system",
        surface: "slack",
        agentId: row.agentId,
        decision: "deny",
        correlationId: id,
        reason: "owner-unreachable",
      });
      return true;
    },

    async anyoneWaits(id: string): Promise<boolean> {
      return (await deps.waiters.count(id)) > 0;
    },
  };
}

export type OwnerRequestPorts = ReturnType<typeof createOwnerRequestPorts>;
