import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type {
  AgentChangeApprovals,
  AgentChangeRequest,
  AgentChangePayload,
} from "api-server-api";
import { describeAgentChange } from "api-server-api";
import type { ApprovalsRepository } from "../infrastructure/approvals-repository.js";
import { securityLog } from "../../../core/security-log.js";

/* UNIT_BOUNDARY_DESCRIPTION: how long a change waits for its owner. A day, not
 * a week: a change is a mutation of something that exists, so a verdict given
 * long after the request was made would run against a world that moved on. */
export const AGENT_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;

export function createAgentChangeApprovals(deps: {
  repo: ApprovalsRepository;
  agentId: string | undefined;
  ownerSub: string;
  actor: string;
}): AgentChangeApprovals {
  return {
    async request(change: AgentChangeRequest) {
      const agentId = deps.agentId;
      if (agentId === undefined) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "only an assistant's own token can hold a change for approval",
        });
      }
      const id = `agentchange:${randomUUID()}`;
      const { title, detail } = describeAgentChange(
        change.procedure,
        change.input,
      );
      const payload: AgentChangePayload = {
        kind: "agent_change",
        procedure: change.procedure,
        title,
        detail,
        input: change.input,
      };
      const expiresAt = new Date(Date.now() + AGENT_CHANGE_TTL_MS);
      await deps.repo.insertPending({
        id,
        type: "agent_change",
        agentId,
        ownerSub: deps.ownerSub,
        sessionId: null,
        payload,
        expiresAt,
      });
      securityLog("info", "agent_change.filed", {
        category: "approval",
        actor: deps.actor,
        actorKind: "agent",
        agentId: deps.agentId,
        correlationId: id,
        detail: { procedure: change.procedure },
      });
      return { id, title, expiresAt: expiresAt.toISOString() };
    },
  };
}
