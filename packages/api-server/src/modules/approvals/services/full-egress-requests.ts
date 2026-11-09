import type { ChildEgressRuleSeed } from "api-server-api";
import type { ApprovalsRepository } from "../infrastructure/approvals-repository.js";
import { securityLog } from "../../../core/security-log.js";
import { emit, EventType } from "../../../events.js";
import { EGRESS_PROPOSAL_TTL_MS, proposalId } from "./egress-proposals.js";

export interface FullEgressRequests {
  request(input: {
    childId: string;
    driverId: string;
    rule: ChildEgressRuleSeed;
  }): Promise<{ id: string }>;
  withdraw(childId: string, keepHosts: ReadonlySet<string>): Promise<void>;
}

const anyHostOf = (host: string): string =>
  host === "*" ? "any host" : `any ${host.slice(1)} host`;

/**
 * UNIT_BOUNDARY_DESCRIPTION: a driver asking that its child with open egress
 * reach any host, or a whole top-level domain: the rule is never written by
 * the driver; it waits as an egress proposal on the child, shown on the
 * driver's page, and only the owner's verdict writes it onto the child. One
 * open request per child and host; a request the driver drops from the
 * child's rules is withdrawn, and asking again after a verdict asks anew.
 */
export function createFullEgressRequests(deps: {
  repo: ApprovalsRepository;
  ownerOf: (agentId: string) => Promise<string | null>;
  nameOf: (agentId: string) => Promise<string | null>;
  now?: () => number;
}): FullEgressRequests {
  const now = deps.now ?? (() => Date.now());

  async function pendingOf(childId: string) {
    const rows = await deps.repo.listPendingForInstance(childId, {
      status: "pending",
      limit: 500,
    });
    return rows.filter(
      (r) =>
        r.agentId === childId &&
        r.payload.kind === "egress_proposal" &&
        r.payload.forAgentId !== undefined,
    );
  }

  return {
    async request({ childId, driverId, rule }) {
      const host = rule.host.trim().toLowerCase();
      const open = (await pendingOf(childId)).find(
        (r) => r.payload.kind === "egress_proposal" && r.payload.host === host,
      );
      if (open) return { id: open.id };
      const ownerSub = await deps.ownerOf(childId);
      if (!ownerSub) throw new Error(`no owner found for ${childId}`);
      const [driverName, childName] = await Promise.all([
        deps.nameOf(driverId),
        deps.nameOf(childId),
      ]);
      const shape = {
        host,
        ...(rule.port !== undefined ? { port: rule.port } : {}),
        method: "*" as const,
        path: "*",
      };
      const id = `${proposalId(childId, { ...shape, reason: "" })}:${now()}`;
      await deps.repo.insertPending({
        id,
        type: "egress_proposal",
        agentId: childId,
        ownerSub,
        sessionId: null,
        payload: {
          kind: "egress_proposal",
          ...shape,
          reason: `${driverName ?? driverId} asks to let its ${childName ? `sub-agent ${childName}` : "child"} reach ${anyHostOf(host)}`,
          forAgentId: driverId,
        },
        expiresAt: new Date(now() + EGRESS_PROPOSAL_TTL_MS),
      });
      securityLog("info", "approval.full_egress_requested", {
        category: "approval",
        actor: driverId,
        actorKind: "agent",
        agentId: childId,
        correlationId: id,
        detail: { host, port: rule.port ?? null },
      });
      emit({
        type: EventType.ApprovalRequested,
        approvalId: id,
        agentId: childId,
        ownerSub,
        forAgentId: driverId,
      });
      return { id };
    },

    async withdraw(childId, keepHosts) {
      for (const row of await pendingOf(childId)) {
        if (row.payload.kind !== "egress_proposal") continue;
        if (keepHosts.has(row.payload.host)) continue;
        if (!(await deps.repo.expirePending(row.id))) continue;
        emit({
          type: EventType.ApprovalResolved,
          approvalId: row.id,
          agentId: childId,
          ownerSub: row.ownerSub,
          resolution: "superseded",
          ...(row.payload.forAgentId && { forAgentId: row.payload.forAgentId }),
        });
      }
    },
  };
}
