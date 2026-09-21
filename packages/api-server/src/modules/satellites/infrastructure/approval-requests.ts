import { randomUUID } from "node:crypto";
import type { ApprovalsRepository } from "../../approvals/infrastructure/approvals-repository.js";
import { emit, EventType } from "../../../events.js";

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Raises the human-in-the-loop request that holds a
 * satellite Job before it runs. It writes the pending row and announces it, as
 * every other approval path does — an approval nobody is told about would sit
 * unanswered until it expired, and the Job with it.
 */
export function createSatelliteApprovalRequester(deps: {
  approvals: Pick<ApprovalsRepository, "insertPending">;
}) {
  return async (input: {
    agentId: string;
    owner: string;
    satellite: string;
    sequence: number;
    ref: string;
    tool: string;
    args: Record<string, unknown>;
    reason: string;
  }): Promise<string> => {
    const id = randomUUID();
    await deps.approvals.insertPending({
      id,
      type: "satellite_job",
      agentId: input.agentId,
      ownerSub: input.owner,
      sessionId: null,
      payload: {
        kind: "satellite_job",
        satellite: input.satellite,
        sequence: input.sequence,
        ref: input.ref,
        tool: input.tool,
        args: input.args,
        reason: input.reason,
      },
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
    });
    emit({
      type: EventType.ApprovalRequested,
      approvalId: id,
      agentId: input.agentId,
      ownerSub: input.owner,
    });
    return id;
  };
}
