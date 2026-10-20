import type { ToolApprovalReports } from "api-server-api";
import { acpNativeRowId } from "api-server-api";
import type { ApprovalsRelayService } from "./approvals-relay-service.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The agent-runtime reports a tool approval that
 * no client can answer, so the platform records it when the agent asks and
 * not first when someone opens the session. The row is the one the ACP relay
 * writes for a watched session, under the same id, so a client that engages
 * later joins it and the row keeps the time the agent asked. The runtime
 * reports the end too, and it is the arbiter of the answer the harness got:
 * its verdict settles the row even when another path recorded a different
 * one, so the record never claims a decision the tool did not act on. A
 * request it dropped unanswered expires the row.
 * The end may arrive before anything recorded the request: the ACP relay's
 * insert is queued behind the frame it already forwarded, and a report's own
 * attempt may commit after its deadline. Such an end leaves a settled row
 * under the same id, so the request can never become actionable after it is
 * over.
 */
export function createToolApprovalReports(deps: {
  relay: ApprovalsRelayService;
  ownerSub: string;
}): ToolApprovalReports {
  return {
    async waiting(agentId, input) {
      await deps.relay.recordAcpNativePending({
        agentId,
        sessionId: input.sessionId,
        rpcId: input.rpcId,
        ownerSub: deps.ownerSub,
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        args: input.args,
        options: input.options,
      });
    },

    async ended(agentId, input) {
      const rowId = acpNativeRowId(agentId, input.sessionId, input.rpcId);
      const settled = input.outcome
        ? await deps.relay.resolveAcpNativeFromInSession(rowId, input.outcome, {
            authoritative: true,
          })
        : await deps.relay.expireAcpNative(rowId);
      if (settled !== "absent") return;
      await deps.relay.settleAbsentAcpNative({
        agentId,
        sessionId: input.sessionId,
        rpcId: input.rpcId,
        ownerSub: deps.ownerSub,
        ...(input.outcome !== undefined && { outcome: input.outcome }),
      });
    },
  };
}
