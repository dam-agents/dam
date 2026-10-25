import { useStore } from "../../../store.js";
import type { SpendRefusalViewer } from "../../acp/errors.js";
import { useAgent } from "../../agents/api/queries.js";
import { ownerName } from "../../agents/lib/agent-permissions.js";
import { useAgentSpendStatus } from "../../spend/api/queries.js";
import { agentLimitReached } from "../../spend/lib/agent-limit.js";

const OWNER: SpendRefusalViewer = { role: "owner" };

export function useSpendRefusalViewer(refused: boolean): SpendRefusalViewer {
  const agentId = useStore((s) => s.selectedAgent);
  const agent = useAgent(agentId);
  const editor = agent?.access.role === "editor";
  const { data: status } = useAgentSpendStatus(
    refused && editor ? agentId : null,
  );
  if (!agent || agent.access.role !== "editor") return OWNER;
  return {
    role: "editor",
    owner: ownerName(agent.access),
    agentLimitReached: agentLimitReached(status, agent.id),
  };
}
