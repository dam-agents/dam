import { randomUUID } from "node:crypto";
import { CHILD_DRIVER_SOURCE } from "api-server-api";
import type { ApprovalsRepository } from "../infrastructure/approvals-repository.js";
import { securityLog } from "../../../core/security-log.js";
import { emit, EventType } from "../../../events.js";
import type {
  ChildEgressAnswered,
  EgressRuleWriter,
} from "./approvals-service.js";

export interface ChildEgressRelease {
  release(rootAgentId: string, decidedBy: string): Promise<number>;
}

// UNIT_BOUNDARY_DESCRIPTION: what turning on an Agent's switch for its children's network access does to the requests that wait for it. Every waiting request for a rule wider than its driver, asked by a driver whose launch root is that Agent, is answered at once: the rule is written on the child as its driver's own, as it would be had the switch been on when the driver set it, and the request leaves the owner's inbox. A request for a wildcard host is not touched: it waits for the owner whatever the switch says. A rule that clashes with a block the owner set on the child is not written, and its request is withdrawn.
export function createChildEgressRelease(deps: {
  repo: ApprovalsRepository;
  writer: EgressRuleWriter;
  rootOf: (agentId: string) => Promise<string | null>;
  answered?: ChildEgressAnswered;
}): ChildEgressRelease {
  return {
    async release(rootAgentId, decidedBy) {
      let released = 0;
      for (const row of await deps.repo.listPendingWiderChildEgressRequests()) {
        if (row.payload.kind !== "egress_proposal") continue;
        const { host, port, method, path, forAgentId } = row.payload;
        if (!forAgentId || (await deps.rootOf(forAgentId)) !== rootAgentId)
          continue;
        const written = await deps.writer.insert({
          id: randomUUID(),
          agentId: row.agentId,
          host,
          ...(port !== undefined ? { port } : {}),
          method,
          pathPattern: path,
          verdict: "allow",
          decidedBy: forAgentId,
          source: CHILD_DRIVER_SOURCE,
        });
        const clash = written.kind === "verdict-clash";
        const closed = clash
          ? await deps.repo.expirePending(row.id)
          : await deps.repo.resolvePending(row.id, "allow", decidedBy, {
              markDelivered: true,
            });
        if (!closed) continue;
        emit({
          type: EventType.ApprovalResolved,
          approvalId: row.id,
          agentId: row.agentId,
          ownerSub: row.ownerSub,
          resolution: clash ? "superseded" : "allow",
          forAgentId,
        });
        securityLog("info", "approval.child_egress_released", {
          category: "approval",
          actor: decidedBy,
          actorKind: "user",
          agentId: row.agentId,
          decision: clash ? "deny" : "allow",
          correlationId: row.id,
          detail: {
            host,
            port: port ?? null,
            rootAgentId,
            ruleWritten: !clash,
          },
        });
        if (!clash) {
          released += 1;
          await deps.answered?.(row.agentId, {
            host,
            ...(port !== undefined ? { port } : {}),
            method,
            path,
            verdict: "allow",
          });
        }
      }
      return released;
    },
  };
}
