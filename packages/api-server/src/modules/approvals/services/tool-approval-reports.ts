import type { ToolApprovalReports } from "api-server-api";
import { acpNativeRowId } from "api-server-api";
import type { ApprovalsRelayService } from "./approvals-relay-service.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The agent-runtime reports a tool approval that
 * no client can answer, so the platform records it when the agent asks and
 * not first when someone opens the session. The row is the one the ACP relay
 * writes for a watched session, under the same id, so a client that engages
 * later joins it and the row keeps the time the agent asked. The runtime
 * reports the end too: an answer resolves the row with the verdict of the
 * chosen option, and a request it dropped unanswered expires it.
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
      if (input.outcome)
        await deps.relay.resolveAcpNativeFromInSession(rowId, input.outcome);
      else await deps.relay.expireAcpNative(rowId);
    },
  };
}
