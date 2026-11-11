import { wildcardHostReach, type ChildEgressRuleSeed } from "api-server-api";
import type { ApprovalsRepository } from "../infrastructure/approvals-repository.js";
import { securityLog } from "../../../core/security-log.js";
import { emit, EventType } from "../../../events.js";
import { EGRESS_PROPOSAL_TTL_MS, proposalId } from "./egress-proposals.js";

// UNIT_BOUNDARY_DESCRIPTION: why a child's rule waits for the owner: it allows a wildcard host, or it lets through a request its driver's own rules do not allow, and the owner has not let the driver give its children network access of their own.
export type ChildEgressAsk = "wildcard" | "wider";

export interface ChildEgressRequests {
  request(input: {
    childId: string;
    driverId: string;
    rule: ChildEgressRuleSeed;
    ask: ChildEgressAsk;
  }): Promise<{ id: string }>;
  withdraw(
    childId: string,
    keep: (request: {
      host: string;
      port?: number;
      method: string;
      path: string;
    }) => boolean,
  ): Promise<void>;
}

const reachOf = (rule: ChildEgressRuleSeed, ask: ChildEgressAsk): string => {
  if (ask === "wildcard") {
    const reach = wildcardHostReach(rule.host);
    return rule.host === "*"
      ? reach
      : `${reach} (such as api.${rule.host.slice(2)})`;
  }
  const target =
    rule.port === undefined ? rule.host : `${rule.host}:${rule.port}`;
  const path = rule.pathPattern ?? "*";
  const method = rule.method ?? "*";
  const request = path === "*" ? target : `${target}${path}`;
  return method === "*" ? request : `${method} ${request}`;
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: a driver asking that its child with open egress
 * reach what is not the driver's to give: a wildcard host (any host, or every
 * subdomain of one domain), or a request the driver's own rules do not allow
 * while its owner has not let its children have network access of their own. The
 * rule is never written by the driver; it waits as an egress proposal on the
 * child, shown on the driver's page, and only the owner's verdict writes it
 * onto the child. One open request per child, host, port, method and path, so
 * a rule the driver changes asks again; a request the driver drops from the
 * child's rules is withdrawn, and asking again after a verdict asks anew. The
 * request carries the rule's method and path, so the owner's approval writes
 * the rule the driver asked for.
 */
export function createChildEgressRequests(deps: {
  repo: ApprovalsRepository;
  ownerOf: (agentId: string) => Promise<string | null>;
  nameOf: (agentId: string) => Promise<string | null>;
  isEnvironment: (agentId: string) => Promise<boolean>;
  now?: () => number;
}): ChildEgressRequests {
  const now = deps.now ?? (() => Date.now());

  const pendingOf = (childId: string) =>
    deps.repo.listPendingChildEgressRequests(childId);

  return {
    async request({ childId, driverId, rule, ask }) {
      const host = rule.host.trim().toLowerCase();
      const shape = {
        host,
        ...(rule.port !== undefined ? { port: rule.port } : {}),
        method: rule.method ?? "*",
        path: rule.pathPattern ?? "*",
      };
      const open = (await pendingOf(childId)).find(
        (r) =>
          r.payload.kind === "egress_proposal" &&
          r.payload.host === host &&
          r.payload.port === rule.port &&
          r.payload.method === shape.method &&
          r.payload.path === shape.path,
      );
      if (open) return { id: open.id };
      const ownerSub = await deps.ownerOf(childId);
      if (!ownerSub) throw new Error(`no owner found for ${childId}`);
      const [driverName, childName, environment] = await Promise.all([
        deps.nameOf(driverId),
        deps.nameOf(childId),
        deps.isEnvironment(childId),
      ]);
      const id = `${proposalId(childId, shape)}:${now()}`;
      const kind = environment ? "Environment" : "sub-agent";
      const child = childName ? `${kind} ${childName}` : kind;
      const reach = reachOf({ ...rule, host }, ask);
      const driver = driverName ?? driverId;
      await deps.repo.insertPending({
        id,
        type: "egress_proposal",
        agentId: childId,
        ownerSub,
        sessionId: null,
        payload: {
          kind: "egress_proposal",
          ...shape,
          reason:
            ask === "wildcard"
              ? `${driver} wants its ${child} to reach ${reach}.`
              : `${driver} wants its ${child} to reach ${reach}. ${driver}'s own network rules do not allow this.`,
          forAgentId: driverId,
          ...(driverName && { forAgentName: driverName }),
          forChild: environment ? "environment" : "sub-agent",
          ...(childName && { forChildName: childName }),
          ...(ask === "wider" && { widerThanDriver: true }),
        },
        expiresAt: new Date(now() + EGRESS_PROPOSAL_TTL_MS),
      });
      securityLog("info", "approval.child_egress_requested", {
        category: "approval",
        actor: driverId,
        actorKind: "agent",
        agentId: childId,
        correlationId: id,
        detail: { host, port: rule.port ?? null, ask },
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

    async withdraw(childId, keep) {
      for (const row of await pendingOf(childId)) {
        if (row.payload.kind !== "egress_proposal") continue;
        const { host, port, method, path } = row.payload;
        if (
          keep({ host, ...(port !== undefined ? { port } : {}), method, path })
        )
          continue;
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
