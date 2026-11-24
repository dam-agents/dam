import type { ApprovalView, McpToolCallPayload } from "api-server-api";

import { useAgent } from "../../agents/api/queries.js";
import { ownerName } from "../../agents/lib/agent-permissions.js";
import { useAppConnections } from "../../connections/api/queries.js";

export interface ToolCallAccount {
  actor: string;
  accountLabel: string | null;
}

// UNIT_BOUNDARY_DESCRIPTION: whose account a held tool call acts as, read from data the app already loads: "you" for the owner, the owner's email for an Agent Editor of a Shared Agent, and the account label of the Connection, such as the Slack person and workspace, when the viewer's own Connections list it.
export function useToolCallAccount(
  approval: ApprovalView,
  payload: McpToolCallPayload,
): ToolCallAccount {
  const agent = useAgent(payload.forAgentId ?? approval.agentId);
  const { data: connections } = useAppConnections();
  return {
    actor: agent ? ownerName(agent.access) : "you",
    accountLabel:
      connections?.find((connection) => connection.id === payload.connectionId)
        ?.accountLabel ?? null,
  };
}
